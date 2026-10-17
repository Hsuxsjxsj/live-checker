import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import { AppShell } from './components/app-shell'
import { AddStreamerDialog } from './features/add-streamer/add-streamer-dialog'
import { BoardOverview } from './features/board/board-overview'
import { entryStatus } from './features/board/board-model'
import {
  FlightBoard,
  type BoardEntry,
  type BoardFilters,
} from './features/board/flight-board'
import { OrderControls } from './features/board/order-controls'
import {
  TransportNotice,
  TransportSettingsDialog,
} from './features/settings/transport-settings'
import { StreamerActions } from './features/streamer-actions/streamer-actions'
import { useLiveStatuses } from './hooks/use-live-statuses'
import { useStreamers } from './hooks/use-streamers'
import type { LiveApi } from './platform/live-client'
import { ClientLiveApi } from './platform/live-client'
import { useTransportState } from './platform/transport'
import type { StreamerRepository } from './storage/local-streamer-repository'
import { LocalStreamerRepository } from './storage/local-streamer-repository'
import { ThemeProvider } from './theme/theme-provider'

export interface AppProps {
  repository?: StreamerRepository
  api?: LiveApi
  queryClient?: QueryClient
}

const defaultRepository = new LocalStreamerRepository()
const defaultApi = new ClientLiveApi()
const defaultQueryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

export function App({
  repository,
  api,
  queryClient = defaultQueryClient,
}: AppProps) {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <BoardPage
          repository={repository ?? defaultRepository}
          api={api ?? defaultApi}
        />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

interface BoardPageProps {
  repository: StreamerRepository
  api: LiveApi
}

function BoardPage({ repository, api }: BoardPageProps) {
  const [filters, setFilters] = useState<BoardFilters>({
    query: '',
    status: 'all',
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [reorderMessage, setReorderMessage] = useState('')
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const transport = useTransportState()
  const { streamers, state, errorMessage, refresh } = useStreamers(repository)
  const liveStatuses = useLiveStatuses(streamers, api)

  const statusesByIdentity = useMemo(() => new Map(liveStatuses.entries.map((status) => [
    `${status.platform}:${status.roomId}`,
    status,
  ])), [liveStatuses.entries])
  const entries = useMemo<BoardEntry[]>(() => streamers.map((streamer) => ({
    streamer,
    status: statusesByIdentity.get(`${streamer.platform}:${streamer.roomId}`) ?? null,
  })), [statusesByIdentity, streamers])
  function restoreAddFocus() {
    queueMicrotask(() => addButtonRef.current?.focus())
  }

  async function handleSaved() {
    setDialogOpen(false)
    await refresh()
    restoreAddFocus()
  }

  async function handleStreamerChanged() {
    await refresh()
    restoreAddFocus()
  }

  async function moveStreamer(entry: BoardEntry, direction: -1 | 1) {
    if (repository.reorder === undefined || reorderSaving) return
    const group = entries.filter((candidate) => entryStatus(candidate) === entryStatus(entry))
    const currentIndex = group.findIndex((candidate) => candidate.streamer.id === entry.streamer.id)
    const other = group[currentIndex + direction]
    if (other === undefined) return
    const ids = streamers.map((streamer) => streamer.id)
    const sourceIndex = ids.indexOf(entry.streamer.id)
    const targetIndex = ids.indexOf(other.streamer.id)
    ;[ids[sourceIndex], ids[targetIndex]] = [ids[targetIndex]!, ids[sourceIndex]!]
    setReorderSaving(true)
    setReorderMessage('')
    try {
      await repository.reorder(ids)
      await refresh()
      setReorderMessage('主播顺序已保存')
    } catch {
      setReorderMessage('排序保存失败，原顺序没有改变，请刷新后重试')
    } finally {
      setReorderSaving(false)
    }
  }

  function dismissDialog() {
    setDialogOpen(false)
    restoreAddFocus()
  }

  return (
    <AppShell onOpenSettings={() => setSettingsOpen(true)}>
      <main id="main-content" className="board-page" tabIndex={-1}>
        <BoardOverview entries={entries} freshness={liveStatuses.freshness}
          lastUpdatedAt={liveStatuses.lastUpdatedAt}
          refreshDisabled={liveStatuses.isBoardRetryDisabled}
          onRefresh={() => void liveStatuses.retryAll()} />
        {!transport.probing && transport.active === 'unavailable' ? (
          <TransportNotice onOpenSettings={() => setSettingsOpen(true)} />
        ) : null}
        {state === 'error' ? (
          <button type="button" className="secondary-button" onClick={() => void refresh()}>重试读取</button>
        ) : null}

        <div className="board-body">
          {reorderMessage ? (
            <p className="reorder-feedback" role="status" aria-live="polite">
              {reorderMessage}
            </p>
          ) : null}
          <FlightBoard
            entries={entries}
            filters={filters}
            onFiltersChange={setFilters}
            onAddStreamer={() => setDialogOpen(true)}
            addButtonRef={addButtonRef}
            announcement={liveStatuses.announcement}
            onRetry={(entry) => void liveStatuses.retryOne(entry.streamer)}
            isRetryDisabled={(entry) => liveStatuses.isRowRetryDisabled(entry.streamer)}
            state={state}
            {...(errorMessage === undefined ? {} : { errorMessage })}
            renderActions={(entry) => {
              const group = entries.filter((candidate) =>
                entryStatus(candidate) === entryStatus(entry))
              const index = group.findIndex((candidate) =>
                candidate.streamer.id === entry.streamer.id)
              return <div className="row-composed-actions">
                <OrderControls
                  name={entry.streamer.displayName}
                  canMoveUp={index > 0}
                  canMoveDown={index >= 0 && index < group.length - 1}
                  disabled={repository.reorder === undefined || reorderSaving}
                  onMoveUp={() => void moveStreamer(entry, -1)}
                  onMoveDown={() => void moveStreamer(entry, 1)}
                />
                <StreamerActions
                  streamer={entry.streamer}
                  repository={repository}
                  api={api}
                  onChanged={handleStreamerChanged}
                />
              </div>
            }}
            showSkipLink={false}
          />
        </div>

        {dialogOpen ? (
          <AddStreamerDialog
            repository={repository}
            api={api}
            onSaved={handleSaved}
            onDismiss={dismissDialog}
          />
        ) : null}
        {settingsOpen ? (
          <TransportSettingsDialog onDismiss={() => setSettingsOpen(false)} />
        ) : null}
      </main>
    </AppShell>
  )
}
