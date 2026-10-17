/**
 * 直播检测中转核心 —— 同时运行在 Cloudflare Pages Function 与本地 Vite 开发服务器。
 *
 * 浏览器无法直接访问四个直播平台的接口（B 站 API 对带 Origin 的跨域请求返回 403，
 * 斗鱼/虎牙不返回 CORS 头，抖音需要先取 ttwid Cookie），因此静态页面需要一个
 * 「哑中转」：只做域名白名单转发，不包含任何业务逻辑。全部检测逻辑仍在浏览器端。
 *
 * 运行环境要求：全局 fetch（Cloudflare Workers 与 Node 18+ 均满足）。
 */

export interface RelaySuccess {
  ok: true
  /** 上游 HTTP 状态码。 */
  status: number
  /** 短链接（b23.tv）解析得到的最终规范地址。 */
  location?: string
  /** 上游响应体文本（短链接解析时为空）。 */
  body?: string
}

export type RelayError =
  | 'MISSING_URL'
  | 'INVALID_URL'
  | 'DISALLOWED_TARGET'
  | 'UPSTREAM_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'TTWID_UNAVAILABLE'

export interface RelayFailure {
  ok: false
  error: RelayError
}

export type RelayOutcome = RelaySuccess | RelayFailure

/** 允许转发的上游域名（只读公开数据，全部为直播平台官方域名）。 */
export const RELAY_ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'api.live.bilibili.com',
  'mp.huya.com',
  'www.huya.com',
  'm.douyu.com',
  'www.douyu.com',
  'live.douyin.com',
  'b23.tv',
])

const SHORT_LINK_HOST = 'b23.tv'
const DOUYIN_SESSION_URL = 'https://live.douyin.com/'
const DOUYIN_ROOM_PATH_PREFIX = '/webcast/'
const USER_AGENT = 'Mozilla/5.0'
const UPSTREAM_TIMEOUT_MS = 10_000
const MAX_BODY_CHARS = 4_000_000
const TTWID_CACHE_MS = 6 * 60 * 60 * 1000
const TTWID_PATTERN = /(?:^|[,;\s])ttwid=([A-Za-z0-9._%|~-]{1,512})(?:;|$)/

let ttwidCache: { value: string; expiresAt: number } | null = null

function failure(error: RelayError): RelayFailure {
  return { ok: false, error }
}

function upstreamTimeoutSignal(): AbortSignal | null {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    : null
}

function parseAllowedTarget(rawUrl: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.port !== '') return null
  if (!RELAY_ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) return null
  return parsed
}

function extractTtwid(response: Response): string | null {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const cookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  for (const cookie of cookies) {
    const match = TTWID_PATTERN.exec(cookie)
    if (match?.[1] !== undefined) return match[1]
  }
  return null
}

async function obtainTtwid(): Promise<string | null> {
  if (ttwidCache !== null && Date.now() < ttwidCache.expiresAt) return ttwidCache.value
  let response: Response
  try {
    response = await fetch(DOUYIN_SESSION_URL, {
      method: 'HEAD',
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: upstreamTimeoutSignal(),
    })
  } catch {
    return null
  }
  // 与 Java 适配器保持一致：匿名会话页允许 200 或 404。
  if (response.status !== 200 && response.status !== 404) return null
  const ttwid = extractTtwid(response)
  if (ttwid === null) return null
  ttwidCache = { value: ttwid, expiresAt: Date.now() + TTWID_CACHE_MS }
  return ttwid
}

async function relayShortLink(target: URL): Promise<RelayOutcome> {
  let response: Response
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
      signal: upstreamTimeoutSignal(),
    })
  } catch {
    return failure('UPSTREAM_ERROR')
  }
  // redirect:'follow' 之后 response.url 即最终地址；取消正文下载。
  try {
    await response.body?.cancel()
  } catch {
    // 取消失败不影响结果。
  }
  const finalUrl = response.url || target.toString()
  if (finalUrl === target.toString()) return failure('UPSTREAM_ERROR')
  const parsed = parseAllowedTarget(finalUrl)
  if (parsed === null || parsed.hostname.toLowerCase() === SHORT_LINK_HOST) {
    return failure('UPSTREAM_ERROR')
  }
  return { ok: true, status: response.status, location: parsed.toString() }
}

async function relayPlatform(target: URL): Promise<RelayOutcome> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept: 'application/json',
  }
  if (target.hostname.toLowerCase() === 'live.douyin.com'
    && target.pathname.startsWith(DOUYIN_ROOM_PATH_PREFIX)) {
    const ttwid = await obtainTtwid()
    if (ttwid === null) return failure('TTWID_UNAVAILABLE')
    headers.cookie = `ttwid=${ttwid}`
  }

  let response: Response
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: upstreamTimeoutSignal(),
    })
  } catch {
    return failure('UPSTREAM_ERROR')
  }

  let body: string
  try {
    body = await response.text()
  } catch {
    return failure('UPSTREAM_ERROR')
  }
  if (body.length > MAX_BODY_CHARS) return failure('PAYLOAD_TOO_LARGE')
  return { ok: true, status: response.status, body }
}

/** 中转一个上游请求。rawUrl 必须是 https 且属于平台白名单域名。 */
export async function relayRequest(rawUrl: string | null): Promise<RelayOutcome> {
  if (rawUrl === null || rawUrl === '') return failure('MISSING_URL')
  const target = parseAllowedTarget(rawUrl)
  if (target === null) return failure('INVALID_URL')
  if (target.hostname.toLowerCase() === SHORT_LINK_HOST) return relayShortLink(target)
  if (target.hostname.toLowerCase() === 'live.douyin.com'
    && !target.pathname.startsWith(DOUYIN_ROOM_PATH_PREFIX)) {
    return failure('DISALLOWED_TARGET')
  }
  return relayPlatform(target)
}
