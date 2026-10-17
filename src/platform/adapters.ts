import type { Platform, UnknownReason } from '../domain/types'
import {
  isAbortError,
  PlatformRequestError,
  type PlatformFetchOptions,
  type Transport,
} from './transport'

export interface AdapterMedia {
  streamerName: string | null
  avatarUrl: string | null
  coverUrl: string | null
}

const EMPTY_MEDIA: AdapterMedia = { streamerName: null, avatarUrl: null, coverUrl: null }

export type AdapterStatus =
  | { kind: 'live'; title: string | null; startedAt: string | null; media: AdapterMedia }
  | { kind: 'looping'; title: string | null; media: AdapterMedia }
  | { kind: 'offline'; media: AdapterMedia }
  | { kind: 'unknown'; reason: UnknownReason }

export interface ResolvedMetadata {
  canonicalRoomId: string
  roomUrl: string
  streamerName: string | null
  avatarUrl: string | null
}

export interface AdapterContext extends PlatformFetchOptions {
  transport: Transport
}

export interface PlatformAdapter {
  platform: Platform
  describe(roomId: string, ctx: AdapterContext): Promise<ResolvedMetadata>
  inspect(roomId: string, ctx: AdapterContext): Promise<AdapterStatus>
}

// ---------------------------------------------------------------------------
// 通用工具（与 Java 端 Jackson 校验语义对齐）
// ---------------------------------------------------------------------------

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 必须是文本或 null/缺失；其他类型视为平台响应异常。 */
function optionalText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new PlatformRequestError('MALFORMED_RESPONSE')
  return value
}

/** 宽松文本：非文本或空串一律视为缺失，不抛错（用于可选媒体字段）。 */
function lenientText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function boundedText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  return value.trim().length === 0 || value.length > maxLength ? null : value
}

function exactInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function positiveRoomId(value: unknown): string {
  const parsed = exactInt(value)
  if (parsed === null || parsed < 1 || !Number.isSafeInteger(parsed)) {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  return String(parsed)
}

function httpReason(status: number): UnknownReason {
  if (status === 403) return 'ACCESS_DENIED'
  // B站对机房 IP（含 Cloudflare）返回 412（-412 request was banned），
  // 属于平台限制访问，与 403 同类；否则会被误报为「平台服务异常」。
  if (status === 412) return 'ACCESS_DENIED'
  if (status === 429) return 'RATE_LIMITED'
  return 'PLATFORM_ERROR'
}

async function fetchJsonPayload(
  transport: Transport,
  url: string,
  ctx: AdapterContext,
  timeoutMs?: number,
): Promise<Record<string, unknown>> {
  const response = await transport.fetchPlatform(url, {
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new PlatformRequestError(httpReason(response.status))
  }
  let payload: unknown
  try {
    payload = JSON.parse(response.body)
  } catch {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  if (!isJsonObject(payload)) throw new PlatformRequestError('MALFORMED_RESPONSE')
  return payload
}

async function fetchHtmlDocument(
  transport: Transport,
  url: string,
  ctx: AdapterContext,
): Promise<Document> {
  const response = await transport.fetchPlatform(url, {
    ...(ctx.timeoutMs === undefined ? {} : { timeoutMs: ctx.timeoutMs }),
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
  })
  if (response.status < 200 || response.status >= 300) {
    throw new PlatformRequestError(httpReason(response.status))
  }
  const document = new DOMParser().parseFromString(response.body, 'text/html')
  if (document === null) throw new PlatformRequestError('MALFORMED_RESPONSE')
  return document
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname !== ''
      && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value)
}

// ---------------------------------------------------------------------------
// 哔哩哔哩直播
// ---------------------------------------------------------------------------

const BILIBILI_ROOM_INFO_ENDPOINT = 'https://api.live.bilibili.com/room/v1/Room/get_info?room_id='
const BILIBILI_ANCHOR_INFO_ENDPOINT =
  'https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room?roomid='
const BILIBILI_MEDIA_TIMEOUT_MS = 4_000

interface BilibiliRoomData {
  liveStatus: number
  roomId: number | null
  title: string | null
  cover: string | null
  keyframe: string | null
}

async function loadBilibiliRoomData(
  roomId: string,
  ctx: AdapterContext,
): Promise<BilibiliRoomData> {
  const normalized = roomId.trim()
  if (normalized.length === 0) throw new PlatformRequestError('MALFORMED_RESPONSE')
  const payload = await fetchJsonPayload(
    ctx.transport,
    `${BILIBILI_ROOM_INFO_ENDPOINT}${encodeURIComponent(normalized)}`,
    ctx,
  )

  const code = payload.code
  if (typeof code !== 'number') throw new PlatformRequestError('MALFORMED_RESPONSE')
  if (code !== 0) throw new PlatformRequestError('PLATFORM_ERROR')

  const data = payload.data
  if (!isJsonObject(data)) throw new PlatformRequestError('MALFORMED_RESPONSE')

  const liveStatus = data.live_status
  if (typeof liveStatus !== 'number' || !Number.isFinite(liveStatus)) {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }

  let canonicalRoomId: number | null = null
  if (data.room_id !== undefined && data.room_id !== null) {
    const parsed = data.room_id
    if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1
      || !Number.isSafeInteger(parsed)) {
      throw new PlatformRequestError('MALFORMED_RESPONSE')
    }
    canonicalRoomId = parsed
  }

  return {
    liveStatus,
    roomId: canonicalRoomId,
    title: optionalText(data.title),
    cover: lenientText(data.user_cover),
    keyframe: lenientText(data.keyframe),
  }
}

async function loadBilibiliAnchorMedia(
  roomId: string,
  ctx: AdapterContext,
): Promise<AdapterMedia> {
  try {
    const payload = await fetchJsonPayload(
      ctx.transport,
      `${BILIBILI_ANCHOR_INFO_ENDPOINT}${encodeURIComponent(roomId)}`,
      ctx,
      BILIBILI_MEDIA_TIMEOUT_MS,
    )
    if (payload.code !== 0) return EMPTY_MEDIA
    const info = isJsonObject(payload.data) ? payload.data.info : undefined
    if (!isJsonObject(info)) return EMPTY_MEDIA
    return {
      streamerName: lenientText(info.uname),
      avatarUrl: lenientText(info.face),
      coverUrl: null,
    }
  } catch {
    return EMPTY_MEDIA
  }
}

function firstPresent(preferred: string | null, fallback: string | null): string | null {
  return preferred !== null ? preferred : fallback
}

const bilibiliAdapter: PlatformAdapter = {
  platform: 'bilibili',

  async describe(roomId, ctx) {
    const data = await loadBilibiliRoomData(roomId, ctx)
    if (data.roomId === null) throw new PlatformRequestError('MALFORMED_RESPONSE')
    const canonicalRoomId = String(data.roomId)
    const anchor = await loadBilibiliAnchorMedia(canonicalRoomId, ctx)
    return {
      canonicalRoomId,
      roomUrl: `https://live.bilibili.com/${canonicalRoomId}`,
      streamerName: anchor.streamerName,
      avatarUrl: anchor.avatarUrl,
    }
  },

  async inspect(roomId, ctx) {
    try {
      const data = await loadBilibiliRoomData(roomId, ctx)
      const anchorRoomId = data.roomId === null ? roomId : String(data.roomId)
      const anchor = await loadBilibiliAnchorMedia(anchorRoomId, ctx)
      if (data.liveStatus === 1) {
        return {
          kind: 'live',
          title: data.title,
          startedAt: null,
          media: {
            streamerName: anchor.streamerName,
            avatarUrl: anchor.avatarUrl,
            coverUrl: firstPresent(data.keyframe, data.cover),
          },
        }
      }
      if (data.liveStatus === 0) {
        return {
          kind: 'offline',
          media: {
            streamerName: anchor.streamerName,
            avatarUrl: anchor.avatarUrl,
            coverUrl: data.cover,
          },
        }
      }
      return { kind: 'unknown', reason: 'MALFORMED_RESPONSE' }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof PlatformRequestError) return { kind: 'unknown', reason: error.reason }
      return { kind: 'unknown', reason: 'PLATFORM_ERROR' }
    }
  },
}

// ---------------------------------------------------------------------------
// 斗鱼
// ---------------------------------------------------------------------------

const DOUYU_BETARD_ENDPOINT = 'https://www.douyu.com/betard/'
const DOUYU_MOBILE_ROOM_ENDPOINT = 'https://m.douyu.com/'

function requireSafeRoomId(roomId: string): string {
  const normalized = roomId.trim()
  if (normalized.length === 0 || normalized === '.' || normalized === '..') {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  return normalized
}

async function loadDouyuRoom(
  roomId: string,
  ctx: AdapterContext,
): Promise<Record<string, unknown>> {
  const normalized = requireSafeRoomId(roomId)
  const payload = await fetchJsonPayload(
    ctx.transport,
    `${DOUYU_BETARD_ENDPOINT}${encodePathSegment(normalized)}`,
    ctx,
  )
  const room = payload.room
  if (!isJsonObject(room)) throw new PlatformRequestError('MALFORMED_RESPONSE')
  return room
}

function douyuAvatarUrl(value: unknown): string | null {
  const legacyText = lenientText(value)
  if (legacyText !== null) return legacyText
  if (!isJsonObject(value)) return null
  for (const size of ['middle', 'big', 'small'] as const) {
    const candidate = lenientText(value[size])
    if (candidate !== null) return candidate
  }
  return null
}

function douyuMedia(room: Record<string, unknown>): AdapterMedia {
  return {
    streamerName: lenientText(room.nickname),
    avatarUrl: douyuAvatarUrl(room.avatar),
    coverUrl: lenientText(room.room_pic),
  }
}

async function resolveDouyuAlias(
  roomId: string,
  ctx: AdapterContext,
): Promise<ResolvedMetadata> {
  const normalized = requireSafeRoomId(roomId)
  const document = await fetchHtmlDocument(
    ctx.transport,
    `${DOUYU_MOBILE_ROOM_ENDPOINT}${encodePathSegment(normalized)}`,
    ctx,
  )
  const scripts = [...document.querySelectorAll('script#vike_pageContext')]
    .filter((script) => script.getAttribute('type') === 'application/json')
  if (scripts.length !== 1) throw new PlatformRequestError('MALFORMED_RESPONSE')

  let payload: unknown
  try {
    payload = JSON.parse(scripts[0]!.textContent ?? '')
  } catch {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  let current: unknown = payload
  for (const field of ['pageProps', 'room', 'roomInfo', 'roomInfo']) {
    if (!isJsonObject(current)) throw new PlatformRequestError('MALFORMED_RESPONSE')
    current = current[field]
  }
  if (!isJsonObject(current)) throw new PlatformRequestError('MALFORMED_RESPONSE')
  const room = current
  const canonicalRoomId = positiveRoomId(room.rid)
  return {
    canonicalRoomId,
    roomUrl: `https://www.douyu.com/${canonicalRoomId}`,
    streamerName: lenientText(room.nickname),
    avatarUrl: lenientText(room.avatar),
  }
}

const douyuAdapter: PlatformAdapter = {
  platform: 'douyu',

  async describe(roomId, ctx) {
    try {
      const room = await loadDouyuRoom(roomId, ctx)
      const canonicalRoomId = positiveRoomId(room.room_id)
      return {
        canonicalRoomId,
        roomUrl: `https://www.douyu.com/${canonicalRoomId}`,
        streamerName: lenientText(room.nickname),
        avatarUrl: douyuAvatarUrl(room.avatar),
      }
    } catch (error) {
      if (error instanceof PlatformRequestError
        && error.reason === 'MALFORMED_RESPONSE') {
        return resolveDouyuAlias(roomId, ctx)
      }
      throw error
    }
  },

  async inspect(roomId, ctx) {
    try {
      const room = await loadDouyuRoom(roomId, ctx)
      const showStatus = exactInt(room.show_status)
      const videoLoop = exactInt(room.videoLoop)
      const media = douyuMedia(room)
      if (showStatus === 1 && videoLoop === 0) {
        return { kind: 'live', title: lenientText(room.room_name), startedAt: null, media }
      }
      if (showStatus === 1 && videoLoop === 1) {
        return { kind: 'looping', title: lenientText(room.room_name), media }
      }
      if (showStatus === 2 && videoLoop === 0) {
        return { kind: 'offline', media }
      }
      return { kind: 'unknown', reason: 'MALFORMED_RESPONSE' }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof PlatformRequestError) return { kind: 'unknown', reason: error.reason }
      return { kind: 'unknown', reason: 'PLATFORM_ERROR' }
    }
  },
}

// ---------------------------------------------------------------------------
// 虎牙
// ---------------------------------------------------------------------------

const HUYA_PROFILE_ROOM_ENDPOINT = 'https://mp.huya.com/cache.php?m=Live&do=profileRoom'
const HUYA_ROOM_ENDPOINT = 'https://www.huya.com/'
const HUYA_ROOM_ALIAS = /^(?=.*[A-Za-z])[A-Za-z0-9]{1,32}$/
const HUYA_CANONICAL_ROOM = /^https:\/\/www\.huya\.com\/([0-9]{1,32})$/

interface HuyaRoomData {
  liveStatus: string
  realLiveStatus: string
  profileInfo: Record<string, unknown> | null
  liveData: Record<string, unknown> | null
}

function normalizeHuyaImageUrl(value: string | null): string | null {
  if (value === null) return null
  const normalized = value.startsWith('//') ? `https:${value}` : value
  try {
    const url = new URL(normalized)
    if (url.username !== '' || url.password !== '') return null
    if (url.protocol === 'https:') return url.toString()
    if (url.protocol !== 'http:' || !isTrustedHuyaImageHost(url.hostname)) return null
    return `https:${normalized.slice(normalized.indexOf(':'))}`
  } catch {
    return null
  }
}

function isTrustedHuyaImageHost(host: string): boolean {
  const normalized = host.toLowerCase()
  return normalized === 'huya.com' || normalized.endsWith('.huya.com')
    || normalized === 'msstatic.com' || normalized.endsWith('.msstatic.com')
}

async function resolveHuyaAlias(roomId: string, ctx: AdapterContext): Promise<string> {
  const normalized = roomId.trim()
  if (normalized.length === 0) throw new PlatformRequestError('MALFORMED_RESPONSE')
  const document = await fetchHtmlDocument(
    ctx.transport,
    `${HUYA_ROOM_ENDPOINT}${encodePathSegment(normalized)}`,
    ctx,
  )
  const canonicalUrls: string[] = []
  for (const link of [...document.querySelectorAll('link[href]')]) {
    const relations = (link.getAttribute('rel') ?? '').split(/\s+/)
    if (relations.some((relation) => relation.toLowerCase() === 'canonical')) {
      canonicalUrls.push(link.getAttribute('href') ?? '')
    }
  }
  if (canonicalUrls.length !== 1) throw new PlatformRequestError('MALFORMED_RESPONSE')
  const match = HUYA_CANONICAL_ROOM.exec(canonicalUrls[0]!)
  if (match === null) throw new PlatformRequestError('MALFORMED_RESPONSE')
  return match[1]!
}

async function loadHuyaRoomData(roomId: string, ctx: AdapterContext): Promise<HuyaRoomData> {
  const payload = await fetchJsonPayload(
    ctx.transport,
    `${HUYA_PROFILE_ROOM_ENDPOINT}&roomid=${encodeURIComponent(roomId)}`,
    ctx,
  )
  const status = payload.status
  if (typeof status !== 'number') throw new PlatformRequestError('MALFORMED_RESPONSE')
  if (status !== 200) throw new PlatformRequestError('PLATFORM_ERROR')
  const data = payload.data
  if (!isJsonObject(data)) throw new PlatformRequestError('MALFORMED_RESPONSE')
  const liveStatus = data.liveStatus
  const realLiveStatus = data.realLiveStatus
  if (typeof liveStatus !== 'string' || typeof realLiveStatus !== 'string') {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  const profileInfo = data.profileInfo
  const liveData = data.liveData
  return {
    liveStatus,
    realLiveStatus,
    profileInfo: profileInfo === undefined || profileInfo === null
      ? null
      : isJsonObject(profileInfo) ? profileInfo : null,
    liveData: liveData === undefined || liveData === null
      ? null
      : isJsonObject(liveData) ? liveData : null,
  }
}

function huyaOptionalText(
  object: Record<string, unknown> | null,
  field: string,
): string | null {
  if (object === null) return null
  return lenientText(object[field])
}

function huyaAvatarUrl(profileInfo: Record<string, unknown> | null): string | null {
  const avatar = huyaOptionalText(profileInfo, 'avatar180')
  return normalizeHuyaImageUrl(
    avatar === null ? huyaOptionalText(profileInfo, 'avatar') : avatar,
  )
}

function huyaMedia(data: HuyaRoomData): AdapterMedia {
  return {
    streamerName: huyaOptionalText(data.profileInfo, 'nick'),
    avatarUrl: huyaAvatarUrl(data.profileInfo),
    coverUrl: normalizeHuyaImageUrl(huyaOptionalText(data.liveData, 'screenshot')),
  }
}

async function huyaCanonicalRoomId(roomId: string, ctx: AdapterContext): Promise<string> {
  const normalized = roomId.trim()
  if (normalized.length === 0) throw new PlatformRequestError('MALFORMED_RESPONSE')
  return HUYA_ROOM_ALIAS.test(normalized)
    ? resolveHuyaAlias(normalized, ctx)
    : normalized
}

const huyaAdapter: PlatformAdapter = {
  platform: 'huya',

  async describe(roomId, ctx) {
    const canonicalRoomId = await huyaCanonicalRoomId(roomId, ctx)
    const data = await loadHuyaRoomData(canonicalRoomId, ctx)
    return {
      canonicalRoomId,
      roomUrl: `https://www.huya.com/${encodePathSegment(canonicalRoomId)}`,
      streamerName: huyaOptionalText(data.profileInfo, 'nick'),
      avatarUrl: huyaAvatarUrl(data.profileInfo),
    }
  },

  async inspect(roomId, ctx) {
    try {
      const canonicalRoomId = await huyaCanonicalRoomId(roomId, ctx)
      const data = await loadHuyaRoomData(canonicalRoomId, ctx)
      const media = huyaMedia(data)
      if (data.liveStatus.toUpperCase() === 'ON'
        && data.realLiveStatus.toUpperCase() === 'ON') {
        return {
          kind: 'live',
          title: huyaOptionalText(data.liveData, 'introduction'),
          startedAt: null,
          media,
        }
      }
      if (data.liveStatus.toUpperCase() === 'REPLAY'
        && data.realLiveStatus.toUpperCase() === 'REPLAY') {
        return {
          kind: 'looping',
          title: huyaOptionalText(data.liveData, 'introduction'),
          media,
        }
      }
      if (data.liveStatus.toUpperCase() === 'OFF'
        && data.realLiveStatus.toUpperCase() === 'OFF') {
        return { kind: 'offline', media }
      }
      return { kind: 'unknown', reason: 'MALFORMED_RESPONSE' }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof PlatformRequestError) return { kind: 'unknown', reason: error.reason }
      return { kind: 'unknown', reason: 'PLATFORM_ERROR' }
    }
  },
}

// ---------------------------------------------------------------------------
// 抖音直播
// ---------------------------------------------------------------------------

const DOUYIN_ROOM_ENDPOINT =
  'https://live.douyin.com/webcast/room/web/enter/'
  + '?aid=6383'
  + '&app_name=douyin_web'
  + '&live_id=1'
  + '&device_platform=web'
  + '&language=zh-CN'
  + '&enter_from=web_live'
  + '&cookie_enabled=true'
  + '&screen_width=1920'
  + '&screen_height=1080'
  + '&browser_language=zh-CN'
  + '&browser_platform=Win32'
  + '&browser_name=Chrome'
  + '&browser_version=138.0.0.0'
  + '&web_rid='
const DOUYIN_ROOM_ENDPOINT_SUFFIX =
  '&room_id_str='
  + '&enter_source='
  + '&is_need_double_stream=false'
  + '&insert_task_id='
  + '&live_reason='
const DOUYIN_ROOM_ID = /^[0-9]{1,20}$/

function douyinSafeImageUrl(image: unknown, maxLength: number): string | null {
  if (!isJsonObject(image)) return null
  const urls = image.url_list
  if (!Array.isArray(urls)) return null
  for (const value of urls) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) continue
    if (isSafeHttpsUrl(value)) return value
  }
  return null
}

function douyinStreamerName(room: Record<string, unknown>): string | null {
  const owner = room.owner
  if (!isJsonObject(owner)) return null
  return boundedText(owner.nickname, 128)
}

function douyinAvatarUrl(room: Record<string, unknown>): string | null {
  const owner = room.owner
  if (!isJsonObject(owner)) return null
  return douyinSafeImageUrl(owner.avatar_thumb, 1024)
}

async function loadDouyinRoom(
  roomId: string,
  ctx: AdapterContext,
): Promise<Record<string, unknown>> {
  if (!DOUYIN_ROOM_ID.test(roomId)) throw new PlatformRequestError('MALFORMED_RESPONSE')
  // 抖音匿名接口需要先在服务端获取 ttwid Cookie，公共 CORS 代理无法完成，
  // 因此只有内置中转（Cloudflare Pages Function / 本地开发中间件）支持抖音。
  if (ctx.transport.kind !== 'relay') throw new PlatformRequestError('RELAY_REQUIRED')

  const payload = await fetchJsonPayload(
    ctx.transport,
    `${DOUYIN_ROOM_ENDPOINT}${encodeURIComponent(roomId)}${DOUYIN_ROOM_ENDPOINT_SUFFIX}`,
    ctx,
  )
  const statusCode = exactInt(payload.status_code)
  if (statusCode === null) throw new PlatformRequestError('MALFORMED_RESPONSE')
  if (statusCode !== 0) throw new PlatformRequestError('PLATFORM_ERROR')

  const data = payload.data
  const rooms = isJsonObject(data) ? data.data : undefined
  if (!Array.isArray(rooms) || rooms.length !== 1 || !isJsonObject(rooms[0])) {
    throw new PlatformRequestError('MALFORMED_RESPONSE')
  }
  return rooms[0]
}

const douyinAdapter: PlatformAdapter = {
  platform: 'douyin',

  async describe(roomId, ctx) {
    const room = await loadDouyinRoom(roomId, ctx)
    return {
      canonicalRoomId: roomId,
      roomUrl: `https://live.douyin.com/${roomId}`,
      streamerName: douyinStreamerName(room),
      avatarUrl: douyinAvatarUrl(room),
    }
  },

  async inspect(roomId, ctx) {
    try {
      const room = await loadDouyinRoom(roomId, ctx)
      const status = exactInt(room.status)
      const media: AdapterMedia = {
        streamerName: douyinStreamerName(room),
        avatarUrl: douyinAvatarUrl(room),
        coverUrl: douyinSafeImageUrl(room.cover, 2048),
      }
      if (status === 2) {
        return { kind: 'live', title: boundedText(room.title, 512), startedAt: null, media }
      }
      if (status === 4) {
        return { kind: 'offline', media }
      }
      return { kind: 'unknown', reason: 'MALFORMED_RESPONSE' }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof PlatformRequestError) return { kind: 'unknown', reason: error.reason }
      return { kind: 'unknown', reason: 'PLATFORM_ERROR' }
    }
  },
}

export const PLATFORM_ADAPTERS: ReadonlyMap<Platform, PlatformAdapter> = new Map([
  ['bilibili', bilibiliAdapter],
  ['douyu', douyuAdapter],
  ['douyin', douyinAdapter],
  ['huya', huyaAdapter],
])
