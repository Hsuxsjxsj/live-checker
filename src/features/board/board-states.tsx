import { CircleAlert, RadioTower, SearchX } from 'lucide-react'

export function BoardLoading() {
  return (
    <section
      className="board-state loading-state"
      aria-label="正在读取主播状态"
      aria-busy="true"
    >
      <h2>正在编排直播航班</h2>
      <div className="skeleton-list" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton-row motion-reduce:animate-none" key={index}>
            <span />
            <span />
            <span />
          </div>
        ))}
      </div>
    </section>
  )
}

interface BoardMessageProps {
  kind: 'error' | 'empty' | 'no-results'
  message?: string
  onAddStreamer?: () => void
  onResetFilters?: () => void
}

export function BoardMessage({ kind, message, onAddStreamer, onResetFilters }: BoardMessageProps) {
  const content = {
    error: {
      title: '播控数据未就绪',
      body: message ?? '暂时无法读取播控数据',
      Icon: CircleAlert,
    },
    empty: {
      title: '还没有关注的主播',
      body: '粘贴直播间链接，即可在一个看板里关注开播状态。',
      Icon: RadioTower,
    },
    'no-results': {
      title: '没有匹配的主播',
      body: '请调整搜索关键词或状态筛选。',
      Icon: SearchX,
    },
  }[kind]
  return (
    <section className={`board-state ${kind}-state`}>
      <content.Icon aria-hidden="true" size={28} strokeWidth={1.8} />
      <h2>{content.title}</h2>
      <p>{content.body}</p>
      {kind === 'error' ? (
        <p className="state-note">现有本地记录不会被删除。</p>
      ) : null}
      {kind === 'no-results' && onResetFilters !== undefined ? (
        <button type="button" className="secondary-button" onClick={onResetFilters}>清除筛选</button>
      ) : null}
      {kind === 'empty' && onAddStreamer !== undefined ? (
        <button type="button" className="primary-button empty-state-action" onClick={onAddStreamer}>
          添加主播
        </button>
      ) : null}
    </section>
  )
}
