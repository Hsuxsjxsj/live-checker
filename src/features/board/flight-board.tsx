import { useState } from 'react'
import type { ReactNode, Ref } from 'react'

import { boardCounts, groupEntries, queryEntries, visibleEntries } from './board-model'
import { BoardMessage, BoardLoading } from './board-states'
import { BoardSection } from './board-section'
import { BoardToolbar } from './board-toolbar'
import type {
  BoardEntry,
  BoardFilters,
  BoardLoadState,
  BoardStatusFilter,
} from './board-types'

export interface FlightBoardProps {
  entries: BoardEntry[]
  filters: BoardFilters
  onFiltersChange: (filters: BoardFilters) => void
  state?: BoardLoadState
  errorMessage?: string
  onRetry?: (entry: BoardEntry) => void
  isRetryDisabled?: (entry: BoardEntry) => boolean
  announcement?: string
  renderActions?: (entry: BoardEntry) => ReactNode
  showSkipLink?: boolean
  onAddStreamer?: () => void
  addButtonRef?: Ref<HTMLButtonElement>
}

const SECTION_ORDER: Array<{
  status: Exclude<BoardStatusFilter, 'all'>
  id: string
  title: string
}> = [
  { status: 'live', id: 'live-board-section', title: '正在直播' },
  { status: 'looping', id: 'looping-section', title: '正在轮播' },
  { status: 'unknown', id: 'unknown-section', title: '需确认' },
  { status: 'offline', id: 'offline-section', title: '已离线' },
]

export function FlightBoard({
  entries,
  filters,
  onFiltersChange,
  state = 'ready',
  errorMessage,
  onRetry,
  isRetryDisabled,
  announcement = '',
  renderActions,
  showSkipLink = true,
  onAddStreamer,
  addButtonRef,
}: FlightBoardProps) {
  const [offlineExpanded, setOfflineExpanded] = useState(false)
  const offlineCollapsible = filters.status === 'all' && filters.query.trim() === ''
  const searched = queryEntries(entries, filters.query)
  const counts = boardCounts(searched)
  const filtered = visibleEntries(entries, filters)
  const groups = groupEntries(filtered)

  return (
    <>
      {showSkipLink ? (
        <a className="skip-link" href="#live-section">跳到正在直播</a>
      ) : null}
      <div className="board-shell">
        <BoardToolbar
          value={filters}
          counts={counts}
          onChange={onFiltersChange}
          {...(onAddStreamer === undefined ? {} : { onAddStreamer })}
          {...(addButtonRef === undefined ? {} : { addButtonRef })}
        />
        <p className="sr-only" aria-live="polite">{announcement}</p>

        <div id="live-section" className="board-content" tabIndex={-1}>
          {state === 'loading' ? <BoardLoading /> : null}
          {state === 'error' ? (
            <BoardMessage
              kind="error"
              {...(errorMessage === undefined ? {} : { message: errorMessage })}
            />
          ) : null}
          {state === 'ready' && entries.length === 0 ? (
            <BoardMessage
              kind="empty"
              {...(onAddStreamer === undefined ? {} : { onAddStreamer })}
            />
          ) : null}
          {state === 'ready' && entries.length > 0 && filtered.length === 0 ? (
            <BoardMessage kind="no-results"
              onResetFilters={() => onFiltersChange({ query: '', status: 'all' })} />
          ) : null}
          {state === 'ready' && filtered.length > 0 ? (
            <div className="board-sections" id="board-results">
            {SECTION_ORDER.filter(({ status }) =>
              filters.status === 'all' || filters.status === status)
              .map(({ status, id, title }) => (
                <BoardSection
                  key={status}
                  id={id}
                  title={title}
                  entries={groups[status]}
                  {...(onRetry === undefined ? {} : { onRetry })}
                  {...(isRetryDisabled === undefined ? {} : { isRetryDisabled })}
                  {...(renderActions === undefined ? {} : { renderActions })}
                  offline={status === 'offline' && offlineCollapsible}
                  expanded={status === 'offline' && offlineCollapsible ? offlineExpanded : true}
                  {...(status === 'offline'
                    ? { onExpandedChange: setOfflineExpanded }
                    : {})}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}

export type { BoardEntry, BoardFilters } from './board-types'
