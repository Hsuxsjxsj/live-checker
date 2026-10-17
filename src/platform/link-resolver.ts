import type { Platform } from '../domain/types'
import { PlatformRequestError, type PlatformFetchOptions, type Transport } from './transport'

/** 链接不受支持（无法解析为四个平台的直播间）。 */
export class UnsupportedLinkError extends Error {
  constructor(
    readonly detail: 'unsupported' | 'invalid' | 'short-link-relay-required' = 'unsupported',
  ) {
    super('UNSUPPORTED_LINK')
    this.name = 'UnsupportedLinkError'
  }
}

export interface ResolvedTarget {
  platform: Platform
  roomId: string
  roomUrl: string
}

export interface ResolveOptions extends PlatformFetchOptions {}

const MAX_INPUT_LENGTH = 2048
const SHORT_LINK_HOST = 'b23.tv'

const URI_SCHEME_REFERENCE = /(?<![A-Za-z\d+.-])([A-Za-z][A-Za-z\d+.-]*):/gu
const PROTOCOL_RELATIVE_REFERENCE = /(?<![:\p{L}\p{N}])\/\/(?=[\p{L}\p{N}\[])/u
const URL_CANDIDATE = /https?:\/\/[A-Za-z\d._~:/?#[\]@!$&()*+,;=%-]+/giu
const TRAILING_SHARE_PUNCTUATION = /[\])}>,.!?;:。，！？；：）】》]+$/u
const ROOM_PATH = /^\/([A-Za-z0-9]{1,32})\/?$/
const DOUYIN_ROOM_ID = /^[0-9]{1,20}$/
const SHORT_PATH = /^\/[A-Za-z0-9_-]{1,64}\/?$/
const BENIGN_METADATA_LABEL = /^(?:label|title|note):[\p{L}\p{N}_-]+(?=\s|$)/iu
const RAW_DOT_SEGMENT = /(?:^|[\\/])(?:\.|%2e){1,2}(?=[\\/]|$)/iu
const RAW_HTTPS_AUTHORITY_PATH = /^https:\/\/[^/?#]+([^?#]*)/iu
const ABSOLUTE_SCHEME = /^[A-Za-z][A-Za-z\d+.-]*:/
const CONTROL_CHARACTER = /[\x00-\x1F\x7F]/

const HOST_PLATFORMS: ReadonlyMap<string, Platform> = new Map([
  ['live.bilibili.com', 'bilibili'],
  ['b23.tv', 'bilibili'],
  ['www.douyu.com', 'douyu'],
  ['m.douyu.com', 'douyu'],
  ['v.douyu.com', 'douyu'],
  ['live.douyin.com', 'douyin'],
  ['www.huya.com', 'huya'],
  ['m.huya.com', 'huya'],
])

const CANONICAL_HOSTS: ReadonlyMap<Platform, string> = new Map([
  ['bilibili', 'live.bilibili.com'],
  ['douyu', 'www.douyu.com'],
  ['douyin', 'live.douyin.com'],
  ['huya', 'www.huya.com'],
])

function isBenignMetadataLabel(input: string, index: number): boolean {
  const atBoundary = index === 0 || /\s/.test(input[index - 1] ?? '')
  return atBoundary && BENIGN_METADATA_LABEL.test(input.slice(index))
}

function extractSingleUrl(input: string): string {
  if (input.length === 0 || input.length > MAX_INPUT_LENGTH) {
    throw new UnsupportedLinkError('invalid')
  }

  const schemeIndexes: number[] = []
  for (const match of input.matchAll(URI_SCHEME_REFERENCE)) {
    if (match.index !== undefined && !isBenignMetadataLabel(input, match.index)) {
      schemeIndexes.push(match.index)
    }
  }

  if (PROTOCOL_RELATIVE_REFERENCE.test(input)) {
    throw new UnsupportedLinkError('invalid')
  }

  const candidates: Array<{ index: number; value: string }> = []
  for (const match of input.matchAll(URL_CANDIDATE)) {
    if (match.index === undefined) continue
    candidates.push({
      index: match.index,
      value: match[0].replace(TRAILING_SHARE_PUNCTUATION, ''),
    })
  }

  if (schemeIndexes.length !== 1 || candidates.length !== 1) {
    throw new UnsupportedLinkError('invalid')
  }
  const candidate = candidates[0]!
  if (candidate.value.length === 0 || schemeIndexes[0] !== candidate.index) {
    throw new UnsupportedLinkError('invalid')
  }
  return candidate.value
}

function parseAllowlistedHttpsUrl(rawUrl: string): URL | null {
  const pathMatch = RAW_HTTPS_AUTHORITY_PATH.exec(rawUrl)
  if (pathMatch === null || RAW_DOT_SEGMENT.test(pathMatch[1] ?? '')) return null
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (parsed.username !== '' || parsed.password !== '') return null
  if (parsed.port !== '') return null
  if (!HOST_PLATFORMS.has(parsed.hostname)) return null
  return parsed
}

function isShortLink(url: URL): boolean {
  return url.hostname === SHORT_LINK_HOST && SHORT_PATH.test(url.pathname)
}

function parseRoomTarget(rawUrl: string): ResolvedTarget {
  const url = parseAllowlistedHttpsUrl(rawUrl)
  if (url === null || isShortLink(url)) {
    throw new UnsupportedLinkError('unsupported')
  }
  const room = ROOM_PATH.exec(url.pathname)
  const platform = HOST_PLATFORMS.get(url.hostname)
  if (room === null || platform === undefined) {
    throw new UnsupportedLinkError('unsupported')
  }
  const roomId = room[1]!
  if (platform === 'douyin' && !DOUYIN_ROOM_ID.test(roomId)) {
    throw new UnsupportedLinkError('unsupported')
  }
  const canonicalHost = CANONICAL_HOSTS.get(platform)!
  return {
    platform,
    roomId,
    roomUrl: `https://${canonicalHost}/${roomId}`,
  }
}

/** 解析用户粘贴的直播间链接；短链接（b23.tv）通过检测通道解析重定向。 */
export async function resolveLink(
  input: string,
  transport: Transport,
  options: ResolveOptions = {},
): Promise<ResolvedTarget> {
  const candidate = extractSingleUrl(input)
  const url = parseAllowlistedHttpsUrl(candidate)
  if (url === null) {
    throw new UnsupportedLinkError('unsupported')
  }
  if (isShortLink(url)) {
    let finalUrl: string
    try {
      finalUrl = await transport.resolveShortLink(url.toString(), options)
    } catch (error) {
      if (error instanceof PlatformRequestError && error.reason === 'RELAY_REQUIRED') {
        throw new UnsupportedLinkError('short-link-relay-required')
      }
      throw new UnsupportedLinkError('invalid')
    }
    return parseRoomTarget(finalUrl)
  }
  return parseRoomTarget(candidate)
}
