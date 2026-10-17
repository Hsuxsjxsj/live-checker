import { buildCanonicalRoomUrl } from '../domain/canonical-room-url'
import type { Platform, ResolvedStreamer, StatusResult, UnknownReason } from '../domain/types'
import { PLATFORM_ADAPTERS, type AdapterStatus } from './adapters'
import { resolveLink, UnsupportedLinkError } from './link-resolver'
import {
  isAbortError,
  NoTransportError,
  pickTransport,
  PlatformRequestError,
} from './transport'

export type LiveApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'TEMPORARY_FAILURE'
  | 'TRANSPORT_UNAVAILABLE'
  | 'RELAY_REQUIRED'

export class LiveApiError extends Error {
  constructor(readonly code: LiveApiErrorCode) {
    super(code)
    this.name = 'LiveApiError'
  }
}

export interface ResolveOptions {
  signal?: AbortSignal
}

export interface StatusTarget {
  platform: Platform
  roomId: string
}

export interface StatusOptions {
  force?: boolean
  signal?: AbortSignal
}

export interface BatchStatusResponse {
  data: StatusResult[]
}

export interface LiveApi {
  resolve(url: string, options?: ResolveOptions): Promise<ResolvedStreamer>
  status(targets: StatusTarget[], options?: StatusOptions): Promise<BatchStatusResponse>
}

/** 与看板轮询周期一致的客户端缓存 TTL。 */
const STATUS_CACHE_TTL_MS = 120_000
const MAX_STATUS_BATCH = 100
const STATUS_CONCURRENCY = 4
const INSPECT_TIMEOUT_MS = 10_000

const CANONICAL_HOSTS: Record<Platform, string> = {
  bilibili: 'live.bilibili.com',
  douyu: 'www.douyu.com',
  douyin: 'live.douyin.com',
  huya: 'www.huya.com',
}

const statusCache = new Map<string, { result: StatusResult; storedAt: number }>()
const inFlight = new Map<string, Promise<StatusResult>>()
const lastSuccessfulAt = new Map<string, string>()

function statusIdentity(target: StatusTarget): string {
  return `${target.platform}:${target.roomId}`
}

function safeRoomUrl(platform: Platform, roomId: string): string {
  try {
    return buildCanonicalRoomUrl(platform, roomId)
  } catch {
    // 房间号异常时退化为拼接地址；前端会拒绝非规范地址的跳转。
    return `https://${CANONICAL_HOSTS[platform]}/${encodeURIComponent(roomId)}`
  }
}

function safeHttpsUrl(value: string | null): string | null {
  if (value === null) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username === '' && url.password === ''
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function toStatusResult(
  target: StatusTarget,
  adapterStatus: AdapterStatus,
  checkedAt: string,
  lastSuccess: string | null,
): StatusResult {
  const media = adapterStatus.kind === 'unknown'
    ? { streamerName: null, avatarUrl: null, coverUrl: null }
    : adapterStatus.media
  const base = {
    platform: target.platform,
    roomId: target.roomId,
    roomUrl: safeRoomUrl(target.platform, target.roomId),
    streamerName: media.streamerName,
    avatarUrl: safeHttpsUrl(media.avatarUrl),
    coverUrl: safeHttpsUrl(media.coverUrl),
    checkedAt,
    lastSuccessfulAt: lastSuccess,
  }
  switch (adapterStatus.kind) {
    case 'live':
      return { ...base, status: 'live', title: adapterStatus.title, startedAt: adapterStatus.startedAt }
    case 'looping':
      return { ...base, status: 'looping', title: adapterStatus.title, startedAt: null }
    case 'offline':
      return { ...base, status: 'offline', title: null, startedAt: null }
    case 'unknown':
      return { ...base, status: 'unknown', title: null, startedAt: null, reason: adapterStatus.reason }
  }
}

function unknownResult(
  target: StatusTarget,
  checkedAt: string,
  lastSuccess: string | null,
  reason: UnknownReason,
): StatusResult {
  return {
    platform: target.platform,
    roomId: target.roomId,
    roomUrl: safeRoomUrl(target.platform, target.roomId),
    streamerName: null,
    avatarUrl: null,
    coverUrl: null,
    checkedAt,
    lastSuccessfulAt: lastSuccess,
    status: 'unknown',
    title: null,
    startedAt: null,
    reason,
  }
}

async function inspectOne(
  target: StatusTarget,
  force: boolean,
  signal: AbortSignal | undefined,
): Promise<StatusResult> {
  const identity = statusIdentity(target)
  if (!force) {
    const cached = statusCache.get(identity)
    if (cached !== undefined && Date.now() - cached.storedAt < STATUS_CACHE_TTL_MS) {
      return cached.result
    }
  }
  const pending = inFlight.get(identity)
  if (pending !== undefined) return pending

  const request = (async (): Promise<StatusResult> => {
    const checkedAt = new Date().toISOString()
    let adapterStatus: AdapterStatus
    try {
      const transport = await pickTransport()
      const adapter = PLATFORM_ADAPTERS.get(target.platform)
      adapterStatus = adapter === undefined
        ? { kind: 'unknown', reason: 'PLATFORM_ERROR' }
        : await adapter.inspect(target.roomId, {
          transport,
          timeoutMs: INSPECT_TIMEOUT_MS,
          ...(signal === undefined ? {} : { signal }),
        })
    } catch (error) {
      if (isAbortError(error)) throw error
      adapterStatus = error instanceof NoTransportError
        ? { kind: 'unknown', reason: 'TRANSPORT_UNAVAILABLE' }
        : error instanceof PlatformRequestError
          ? { kind: 'unknown', reason: error.reason }
          : { kind: 'unknown', reason: 'PLATFORM_ERROR' }
    }

    const determined = adapterStatus.kind !== 'unknown'
    const lastSuccess = determined ? checkedAt : lastSuccessfulAt.get(identity) ?? null
    if (determined) lastSuccessfulAt.set(identity, checkedAt)

    const result = toStatusResult(target, adapterStatus, checkedAt, lastSuccess)
    if (adapterStatus.kind !== 'unknown' || adapterStatus.reason !== 'TRANSPORT_UNAVAILABLE') {
      statusCache.set(identity, { result, storedAt: Date.now() })
    }
    return result
  })()

  inFlight.set(identity, request)
  try {
    return await request
  } finally {
    inFlight.delete(identity)
  }
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function run(): Promise<void> {
    for (;;) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(limit, items.length) },
    () => run(),
  ))
  return results
}

/** 全部检测逻辑都在浏览器端运行的 LiveApi 实现。 */
export class ClientLiveApi implements LiveApi {
  async resolve(url: string, options: ResolveOptions = {}): Promise<ResolvedStreamer> {
    let transport
    try {
      transport = await pickTransport()
    } catch (error) {
      if (error instanceof NoTransportError) throw new LiveApiError('TRANSPORT_UNAVAILABLE')
      throw error
    }

    let target
    try {
      target = await resolveLink(url, transport, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof UnsupportedLinkError) throw new LiveApiError('VALIDATION_ERROR')
      if (error instanceof PlatformRequestError && error.reason === 'RELAY_REQUIRED') {
        throw new LiveApiError('RELAY_REQUIRED')
      }
      throw new LiveApiError('TEMPORARY_FAILURE')
    }

    const adapter = PLATFORM_ADAPTERS.get(target.platform)
    if (adapter === undefined) throw new LiveApiError('TEMPORARY_FAILURE')
    try {
      const metadata = await adapter.describe(target.roomId, {
        transport,
        timeoutMs: INSPECT_TIMEOUT_MS,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      return {
        platform: target.platform,
        roomId: metadata.canonicalRoomId,
        roomUrl: metadata.roomUrl,
        streamerName: metadata.streamerName,
        avatarUrl: safeHttpsUrl(metadata.avatarUrl),
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof PlatformRequestError && error.reason === 'RELAY_REQUIRED') {
        throw new LiveApiError('RELAY_REQUIRED')
      }
      throw new LiveApiError('TEMPORARY_FAILURE')
    }
  }

  async status(
    targets: StatusTarget[],
    options: StatusOptions = {},
  ): Promise<BatchStatusResponse> {
    if (targets.length === 0) return { data: [] }
    if (targets.length > MAX_STATUS_BATCH) {
      throw new LiveApiError('VALIDATION_ERROR')
    }
    const force = options.force ?? false
    const unique = new Map<string, StatusTarget>()
    for (const target of targets) unique.set(statusIdentity(target), target)
    const uniqueTargets = [...unique.values()]
    const results = await mapWithConcurrency(uniqueTargets, STATUS_CONCURRENCY, (target) =>
      inspectOne(target, force, options.signal))
    const byIdentity = new Map(uniqueTargets.map((target, index) => [
      statusIdentity(target),
      results[index] ?? unknownResult(target, new Date().toISOString(), null, 'PLATFORM_ERROR'),
    ]))
    return { data: targets.map((target) => byIdentity.get(statusIdentity(target))!) }
  }
}
