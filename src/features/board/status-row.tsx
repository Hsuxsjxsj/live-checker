import { ArrowUpRight, CircleAlert, Moon, Radio, Repeat2, RotateCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { entryStatus } from './board-model'
import type { BoardEntry } from './board-types'
import { StreamerMedia } from './streamer-media'
import { formatUnknownReason } from './unknown-reason-copy'
import { WatchTarget, toCanonicalRoomUrl } from './watch-link'

export interface StatusRowProps {
  entry: BoardEntry
  onRetry?: (entry: BoardEntry) => void
  retryDisabled?: boolean
  actions?: ReactNode
}

const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyu: '斗鱼',
  douyin: '抖音',
  huya: '虎牙',
} as const

function formatTimestamp(value: string | null) {
  if (value === null) return '暂无成功检测记录'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '时间信息不可用'
  return `上次确认 ${new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)}`
}

function formatDuration(value: string | null) {
  if (value === null) return null
  const startedAt = new Date(value).valueOf()
  const minutes = Math.floor((Date.now() - startedAt) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return hours > 0 ? `已直播 ${hours}小时 ${rest}分钟` : `已直播 ${rest}分钟`
}

function StatusMark({ status }: { status: 'live' | 'looping' | 'unknown' | 'offline' }) {
  const config = {
    live: { label: '直播中', Icon: Radio },
    looping: { label: '轮播中', Icon: Repeat2 },
    unknown: { label: '状态未知', Icon: CircleAlert },
    offline: { label: '已离线', Icon: Moon },
  }[status]
  return (
    <span className={`status-mark status-${status}`} role="img" aria-label={config.label}>
      <config.Icon aria-hidden="true" size={18} strokeWidth={1.8} />
      <span className="status-mark-label" aria-hidden="true">{config.label}</span>
    </span>
  )
}

export function StatusRow({ entry, onRetry, retryDisabled = false, actions }: StatusRowProps) {
  const status = entryStatus(entry)
  const result = entry.status
  const avatar = result?.avatarUrl ?? entry.streamer.avatarUrl
  const fallbackAvatar = result?.avatarUrl === null ? null : entry.streamer.avatarUrl
  const playable = status === 'live' || status === 'looping'
  const navigable = playable || status === 'offline'
  const statusLabel = status === 'live' ? '直播中'
    : status === 'looping' ? '轮播中'
      : status === 'offline' ? '已离线'
        : result?.status === 'unknown' ? formatUnknownReason(result.reason) : '等待状态'
  const detail = playable
    ? result?.title || (status === 'live' ? '直播标题未提供' : '轮播标题未提供')
    : formatTimestamp(result?.lastSuccessfulAt ?? null)
  const timing = status === 'live'
    ? formatDuration(result?.startedAt ?? null)
    : status === 'looping'
      ? `检测于 ${formatTimestamp(result?.checkedAt ?? null).replace('上次确认 ', '')}`
      : result === null ? '尚未获得检测结果' : `检测于 ${formatTimestamp(result.checkedAt).replace('上次确认 ', '')}`
  const watchUrl = navigable
    ? toCanonicalRoomUrl(
        entry.streamer.platform,
        entry.streamer.roomId,
        entry.streamer.roomUrl,
      )
    : null

  return (
    <li className={`status-row row-${status}`}>
      {watchUrl === null ? null : (
        <WatchTarget roomUrl={watchUrl} streamerName={entry.streamer.displayName} />
      )}
      <StatusMark status={status} />
      <StreamerMedia
        name={entry.streamer.displayName}
        avatarSrc={avatar}
        fallbackAvatarSrc={fallbackAvatar}
        coverSrc={result?.coverUrl ?? null}
      />
      <div className="streamer-identity">
        <strong title={entry.streamer.displayName}>{entry.streamer.displayName}</strong>
        <span className="platform-label">
          {PLATFORM_LABELS[entry.streamer.platform]} · 房间 ID {entry.streamer.roomId}
        </span>
      </div>
      <div className="stream-detail">
        <span className="status-copy">{statusLabel}</span>
        <span className="detail-copy" title={detail}>{detail}</span>
      </div>
      {timing === null && watchUrl === null ? null : (
        <div className="status-meta">
          {timing === null ? null : <span className="timing-copy">{timing}</span>}
          {watchUrl === null ? null : <span className="watch-cue" aria-hidden="true">
            {playable ? '去观看' : '打开直播间'}<ArrowUpRight size={14} strokeWidth={1.8} />
          </span>}
        </div>
      )}
      {actions !== undefined || (status === 'unknown' && onRetry !== undefined) ? (
        <div className="row-controls">
          {status === 'unknown' && onRetry !== undefined ? (
            <button
              type="button"
              className="row-action retry-action"
              aria-label={`重试检测${entry.streamer.displayName}`}
              disabled={retryDisabled}
              onClick={() => onRetry(entry)}
            >
              <RotateCw aria-hidden="true" size={16} strokeWidth={1.8} />
              <span>{retryDisabled ? '冷却中' : '重试'}</span>
            </button>
          ) : null}
          {actions}
        </div>
      ) : (
        <span className="row-end-label">{status === 'live' ? '直播席位' : '状态记录'}</span>
      )}
    </li>
  )
}
