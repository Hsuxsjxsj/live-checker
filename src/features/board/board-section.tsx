import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BoardEntry } from './board-types'
import { StatusRow } from './status-row'

interface BoardSectionProps {
  id: string
  title: string
  entries: BoardEntry[]
  onRetry?: (entry: BoardEntry) => void
  isRetryDisabled?: (entry: BoardEntry) => boolean
  renderActions?: (entry: BoardEntry) => ReactNode
  offline?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function BoardSection({
  id,
  title,
  entries,
  onRetry,
  isRetryDisabled,
  renderActions,
  offline = false,
  expanded = true,
  onExpandedChange,
}: BoardSectionProps) {
  const listId = `${id}-list`
  const showRows = !offline || expanded
  return (
    <section id={id} className="board-section" tabIndex={id === 'live-section' ? -1 : undefined}>
      <header className="section-header">
        <div>
          <h2>{title}</h2>
          <span>{entries.length} 位主播</span>
        </div>
        {offline ? (
          <button
            type="button"
            className="disclosure-button"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-label={`${expanded ? '收起' : '展开'}已离线主播`}
            onClick={() => onExpandedChange?.(!expanded)}
          >
            <span>{expanded ? '收起' : '展开'}</span>
            <ChevronDown
              aria-hidden="true"
              className={expanded ? 'is-expanded' : ''}
              size={18}
              strokeWidth={1.8}
            />
          </button>
        ) : null}
      </header>
      {showRows ? (
        entries.length > 0 ? (
          <>
            <ul id={listId} className="status-list" aria-label={`${title}主播`}>
              {entries.map((entry) => (
                <StatusRow
                  key={entry.streamer.id}
                  entry={entry}
                  {...(onRetry === undefined ? {} : { onRetry })}
                  {...(isRetryDisabled === undefined
                    ? {}
                    : { retryDisabled: isRetryDisabled(entry) })}
                  {...(renderActions === undefined ? {} : { actions: renderActions(entry) })}
                />
              ))}
            </ul>
          </>
        ) : (
          <p id={listId} className="section-empty">当前分区没有主播。</p>
        )
      ) : null}
    </section>
  )
}
