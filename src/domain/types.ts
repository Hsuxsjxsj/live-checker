/** 平台标识，与原后端契约保持一致。 */
export type Platform = 'bilibili' | 'douyu' | 'douyin' | 'huya'

export type StreamerId = string & { readonly __brand: 'StreamerId' }

/** 已保存的主播关注记录（保存在浏览器 localStorage）。 */
export interface SavedStreamer {
  id: StreamerId
  platform: Platform
  roomId: string
  roomUrl: string
  displayName: string
  avatarUrl: string | null
  sortOrder?: number
  createdAt: string
  updatedAt: string
  revision: number
  schemaVersion: 1
}

export type CreateStreamerInput = Pick<
  SavedStreamer,
  'platform' | 'roomId' | 'roomUrl' | 'displayName' | 'avatarUrl'
>

/** 链接识别结果（对应原 /api/resolve 响应）。 */
export interface ResolvedStreamer {
  platform: Platform
  roomId: string
  roomUrl: string
  streamerName: string | null
  avatarUrl: string | null
}

/** 状态检测中的「无法确认」原因，与原后端 UnknownReason 对齐并扩展静态部署专用值。 */
export type UnknownReason =
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'ACCESS_DENIED'
  | 'MALFORMED_RESPONSE'
  | 'PLATFORM_ERROR'
  /** 当前部署没有可用的检测通道（无内置中转且未配置代理）。 */
  | 'TRANSPORT_UNAVAILABLE'
  /** 该平台必须通过内置中转检测（公共代理无法完成，如抖音）。 */
  | 'RELAY_REQUIRED'

/** 状态检测元数据，与原 /api/status 响应字段保持一致。 */
interface StatusMetadata {
  platform: Platform
  roomId: string
  roomUrl: string
  streamerName: string | null
  avatarUrl: string | null
  coverUrl: string | null
  checkedAt: string
  lastSuccessfulAt: string | null
}

export interface LiveStatus extends StatusMetadata {
  status: 'live'
  title: string | null
  startedAt: string | null
}

export interface LoopingStatus extends StatusMetadata {
  status: 'looping'
  title: string | null
  startedAt: null
}

export interface OfflineStatus extends StatusMetadata {
  status: 'offline'
  title: null
  startedAt: null
}

export interface UnknownStatus extends StatusMetadata {
  status: 'unknown'
  title: null
  startedAt: null
  reason: UnknownReason
}

export type StatusResult = LiveStatus | LoopingStatus | OfflineStatus | UnknownStatus

export const PLATFORMS: readonly Platform[] = ['bilibili', 'douyu', 'douyin', 'huya']

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value)
}
