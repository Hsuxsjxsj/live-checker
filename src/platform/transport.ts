import { useSyncExternalStore } from 'react'

import type { UnknownReason } from '../domain/types'

/** 检测通道类型：内置中转（同源 /api/relay）或用户配置的公共 CORS 代理。 */
export type TransportKind = 'relay' | 'proxy'

export type TransportMode = 'auto' | 'relay' | 'proxy'

export interface TransportConfig {
  mode: TransportMode
  proxyTemplate: string
}

export interface PlatformFetchOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

export interface PlatformResponse {
  status: number
  body: string
}

/** 平台请求失败（可映射为 unknown 状态的原因）。 */
export class PlatformRequestError extends Error {
  constructor(readonly reason: UnknownReason) {
    super(reason)
    this.name = 'PlatformRequestError'
  }
}

/** 当前部署没有任何可用检测通道。 */
export class NoTransportError extends Error {
  constructor() {
    super('NO_TRANSPORT')
    this.name = 'NoTransportError'
  }
}

/** 是否为外部取消（AbortController.abort 触发的原生 AbortError）。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export interface Transport {
  readonly kind: TransportKind
  fetchPlatform(url: string, options?: PlatformFetchOptions): Promise<PlatformResponse>
  /** 解析 b23.tv 短链接，返回最终规范地址。 */
  resolveShortLink(url: string, options?: PlatformFetchOptions): Promise<string>
}

const DEFAULT_TIMEOUT_MS = 10_000
const TRANSPORT_STORAGE_KEY = 'hsu-live-transport-v1'

function defaultConfig(): TransportConfig {
  return { mode: 'auto', proxyTemplate: '' }
}

function readStoredConfig(): TransportConfig {
  try {
    const raw = window.localStorage.getItem(TRANSPORT_STORAGE_KEY)
    if (raw === null) return defaultConfig()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return defaultConfig()
    const mode = (parsed as { mode?: unknown }).mode
    const proxyTemplate = (parsed as { proxyTemplate?: unknown }).proxyTemplate
    return {
      mode: mode === 'relay' || mode === 'proxy' ? mode : 'auto',
      proxyTemplate: typeof proxyTemplate === 'string' ? proxyTemplate : '',
    }
  } catch {
    return defaultConfig()
  }
}

function writeStoredConfig(config: TransportConfig) {
  try {
    window.localStorage.setItem(TRANSPORT_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 存储不可用时配置仅对当前页面生效。
  }
}

async function fetchWithGuards(
  url: string,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal }: PlatformFetchOptions,
): Promise<Response> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forwardAbort = () => controller.abort()
  signal?.addEventListener('abort', forwardAbort, { once: true })
  try {
    return await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timedOut) throw new PlatformRequestError('TIMEOUT')
    throw new PlatformRequestError('PLATFORM_ERROR')
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

function relayUrl(target: string): string {
  return `api/relay?u=${encodeURIComponent(target)}`
}

function mapRelayError(error: string): UnknownReason {
  if (error === 'PAYLOAD_TOO_LARGE' || error === 'TTWID_UNAVAILABLE') {
    return 'MALFORMED_RESPONSE'
  }
  return 'PLATFORM_ERROR'
}

interface RelayEnvelope {
  ok: boolean
  status?: number
  location?: string
  body?: string
  error?: string
}

async function readRelayEnvelope(response: Response): Promise<RelayEnvelope> {
  try {
    return JSON.parse(await response.text()) as RelayEnvelope
  } catch {
    throw new PlatformRequestError('PLATFORM_ERROR')
  }
}

const relayTransport: Transport = {
  kind: 'relay',

  async fetchPlatform(url, options) {
    const response = await fetchWithGuards(relayUrl(url), options ?? {})
    const payload = await readRelayEnvelope(response)
    if (!response.ok || !payload.ok || typeof payload.status !== 'number') {
      throw new PlatformRequestError(
        payload.ok === false && payload.error !== undefined
          ? mapRelayError(payload.error)
          : 'PLATFORM_ERROR',
      )
    }
    return { status: payload.status, body: payload.body ?? '' }
  },

  async resolveShortLink(url, options) {
    const response = await fetchWithGuards(relayUrl(url), options ?? {})
    const payload = await readRelayEnvelope(response)
    if (!response.ok || !payload.ok || typeof payload.location !== 'string') {
      throw new PlatformRequestError('PLATFORM_ERROR')
    }
    return payload.location
  },
}

function buildProxyUrl(template: string, target: string): string {
  const encoded = encodeURIComponent(target)
  return template.includes('{url}')
    ? template.replace('{url}', encoded)
    : `${template}${encoded}`
}

function createProxyTransport(template: string): Transport {
  const normalized = template.trim()
  return {
    kind: 'proxy',

    async fetchPlatform(url, options) {
      const response = await fetchWithGuards(buildProxyUrl(normalized, url), options ?? {})
      if (!response.ok) {
        if (response.status === 403) throw new PlatformRequestError('ACCESS_DENIED')
        if (response.status === 429) throw new PlatformRequestError('RATE_LIMITED')
      }
      return { status: response.status, body: await response.text() }
    },

    async resolveShortLink() {
      // 公共代理无法读取重定向地址，短链接必须使用内置中转。
      throw new PlatformRequestError('RELAY_REQUIRED')
    },
  }
}

export interface TransportState {
  /** 是否仍在探测内置中转。 */
  probing: boolean
  relayAvailable: boolean
  config: TransportConfig
  /** 按当前配置推导出的生效通道。 */
  active: 'relay' | 'proxy' | 'unavailable'
}

function deriveActive(
  probing: boolean,
  relayAvailable: boolean,
  config: TransportConfig,
): TransportState['active'] {
  if (config.mode === 'relay') return 'relay'
  if (config.mode === 'proxy') {
    return config.proxyTemplate.trim() === '' ? 'unavailable' : 'proxy'
  }
  if (probing) return 'unavailable'
  if (relayAvailable) return 'relay'
  return config.proxyTemplate.trim() === '' ? 'unavailable' : 'proxy'
}

let transportState: TransportState = {
  probing: true,
  relayAvailable: false,
  config: readStoredConfig(),
  active: 'unavailable',
}

const listeners = new Set<() => void>()

function updateTransportState(patch: {
  probing?: boolean
  relayAvailable?: boolean
  config?: TransportConfig
}) {
  const next: TransportState = { ...transportState, ...patch }
  next.active = deriveActive(next.probing, next.relayAvailable, next.config)
  if (next.probing === transportState.probing
    && next.relayAvailable === transportState.relayAvailable
    && next.config === transportState.config
    && next.active === transportState.active) {
    return
  }
  transportState = next
  for (const listener of listeners) listener()
}

let relayProbe: Promise<boolean> | null = null

/** 探测同源 /api/relay 是否存在（Cloudflare Pages 部署时为 true）。结果按页面生命周期缓存。 */
export function probeRelay(): Promise<boolean> {
  if (relayProbe !== null) return relayProbe
  relayProbe = (async () => {
    try {
      const response = await fetch('api/relay?probe=1', {
        headers: { accept: 'application/json' },
      })
      if (!response.ok) return false
      const contentType = response.headers.get('content-type') ?? ''
      if (!contentType.includes('application/json')) return false
      const payload = JSON.parse(await response.text()) as { probe?: unknown }
      return payload.probe === true
    } catch {
      return false
    }
  })().then((available) => {
    updateTransportState({ probing: false, relayAvailable: available })
    return available
  })
  return relayProbe
}

export function subscribeTransport(listener: () => void): () => void {
  listeners.add(listener)
  void probeRelay()
  return () => listeners.delete(listener)
}

export function getTransportState(): TransportState {
  return transportState
}

/** 保存检测通道配置并立即生效。 */
export function saveTransportConfig(config: TransportConfig) {
  const normalized: TransportConfig = {
    mode: config.mode,
    proxyTemplate: config.proxyTemplate.trim(),
  }
  writeStoredConfig(normalized)
  updateTransportState({ config: normalized })
}

/** 按当前配置挑选一个可用通道；无可用通道时抛出 NoTransportError。 */
export async function pickTransport(): Promise<Transport> {
  const config = transportState.config
  if (config.mode === 'relay') return relayTransport
  if (config.mode === 'proxy') {
    if (config.proxyTemplate.trim() === '') throw new NoTransportError()
    return createProxyTransport(config.proxyTemplate)
  }
  const relayAvailable = await probeRelay()
  if (relayAvailable) return relayTransport
  if (config.proxyTemplate.trim() !== '') return createProxyTransport(config.proxyTemplate)
  throw new NoTransportError()
}

export function useTransportState(): TransportState {
  return useSyncExternalStore(subscribeTransport, getTransportState, getTransportState)
}
