import type { Platform } from './types'

export type CanonicalRoomUrl = string & { readonly __brand: 'CanonicalRoomUrl' }

const ROOM_ID = /^[A-Za-z0-9]{1,64}$/u
const DOUYIN_ROOM_ID = /^[0-9]{1,20}$/u
const HOSTS = {
  bilibili: 'live.bilibili.com',
  douyu: 'www.douyu.com',
  douyin: 'live.douyin.com',
  huya: 'www.huya.com',
} as const
const ROOM_IDS: Record<Platform, RegExp> = {
  bilibili: ROOM_ID,
  douyu: ROOM_ID,
  douyin: DOUYIN_ROOM_ID,
  huya: ROOM_ID,
}
const PLATFORM_BY_HOST = new Map<string, Platform>(Object.entries(HOSTS)
  .map(([platform, host]) => [host, platform as Platform]))

export function isCanonicalRoomUrl(candidate: string): candidate is CanonicalRoomUrl {
  try {
    const parsed = new URL(candidate)
    const platform = PLATFORM_BY_HOST.get(parsed.hostname)
    const roomId = parsed.pathname.slice(1)
    return platform !== undefined
      && ROOM_IDS[platform].test(roomId)
      && parsed.protocol === 'https:'
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && parsed.pathname === `/${roomId}`
      && candidate === `https://${HOSTS[platform]}/${roomId}`
  } catch {
    return false
  }
}

export function toCanonicalRoomUrl(
  platform: Platform,
  roomId: string,
  candidate: string,
): CanonicalRoomUrl | null {
  if (!ROOM_IDS[platform].test(roomId)) return null
  const expected = `https://${HOSTS[platform]}/${roomId}`
  if (candidate !== expected || !isCanonicalRoomUrl(candidate)) return null
  return candidate as CanonicalRoomUrl
}

/** 由平台与房间号构造规范直播间地址（房间号已通过格式校验时使用）。 */
export function buildCanonicalRoomUrl(platform: Platform, roomId: string): CanonicalRoomUrl {
  const candidate = `https://${HOSTS[platform]}/${roomId}`
  if (!isCanonicalRoomUrl(candidate)) {
    throw new Error(`INVALID_CANONICAL_ROOM_URL:${platform}:${roomId}`)
  }
  return candidate as CanonicalRoomUrl
}
