import { CircleAlert, Heart, Radio, RefreshCw } from 'lucide-react'
import type { StatusFreshness } from '../../hooks/use-live-statuses'
import { STATUS_POLL_INTERVAL } from '../../hooks/use-live-statuses'
import { boardCounts } from './board-model'
import type { BoardEntry } from './board-types'

interface BoardOverviewProps {
  entries: BoardEntry[]
  freshness: StatusFreshness
  lastUpdatedAt: number | null
  refreshDisabled: boolean
  onRefresh(): void
}

const FRESHNESS_COPY: Record<StatusFreshness, string> = {
  idle: '尚无状态检测',
  loading: '正在检测直播状态',
  fresh: '直播状态已更新',
  refreshing: '正在刷新直播状态',
  stale: '检测失败，正在显示上次结果',
  unavailable: '直播状态暂不可用，暂无历史结果',
}

export function BoardOverview({ entries, freshness, lastUpdatedAt, refreshDisabled, onRefresh }: BoardOverviewProps) {
  const counts = boardCounts(entries)
  const updating = freshness === 'loading' || freshness === 'refreshing'
  const metrics = [
    { label: '正在直播', value: counts.live, Icon: Radio, tone: 'live' },
    { label: '全部关注', value: counts.all, Icon: Heart, tone: 'all' },
    { label: '需要确认', value: counts.unknown, Icon: CircleAlert, tone: 'unknown' },
  ]
  return (<>
    <section className="board-overview" aria-labelledby="board-page-title">
      <div className="page-heading">
        <p className="eyebrow">YOUR DAILY LIVE</p>
        <h1 id="board-page-title">直播航班板</h1>
        <p>把喜欢的直播，放在一起。<span className="heading-aside"> 此刻的精彩，一眼就知道。</span></p>
      </div>
      <dl className="signal-overview" role="region" aria-label="实时信号概览">
        {metrics.map(({ label, value, Icon, tone }) => (
          <div key={tone} className={`overview-metric metric-${tone}`}>
            <dt><Icon aria-hidden="true" size={16} strokeWidth={1.8} />{label}</dt>
            <dd>{String(value).padStart(2, '0')}<span>位</span></dd>
          </div>
        ))}
      </dl>
    </section>
    <div className="freshness-bar" data-freshness={freshness}>
      <div className="freshness-copy">
        <span className="freshness-dot" aria-hidden="true" />
        <strong>{FRESHNESS_COPY[freshness]}</strong>
        {lastUpdatedAt === null ? null : <span className="last-updated">最后更新{' '}
          <time dateTime={new Date(lastUpdatedAt).toISOString()}>
            {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(lastUpdatedAt)}
          </time>
        </span>}
      </div>
      <div className="freshness-actions">
        <span className="refresh-interval">每 {STATUS_POLL_INTERVAL / 60_000} 分钟自动更新</span>
        <button type="button" className="quiet-button status-refresh" aria-label="刷新状态"
          title="刷新状态" disabled={refreshDisabled} onClick={onRefresh}>
          <RefreshCw aria-hidden="true" className={updating ? 'spin' : undefined} size={16} strokeWidth={1.8} />
          <span>{updating ? '更新中' : '刷新'}</span>
        </button>
      </div>
    </div>
  </>)
}
