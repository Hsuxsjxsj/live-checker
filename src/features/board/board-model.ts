import type {
  BoardCounts,
  BoardEntry,
  BoardFilters,
  BoardStatusFilter,
} from './board-types'

export type EntryStatus = Exclude<BoardStatusFilter, 'all'>

export function entryStatus(entry: BoardEntry): EntryStatus {
  return entry.status?.status ?? 'unknown'
}

function matchesQuery(entry: BoardEntry, query: string) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (normalized.length === 0) return true
  return [
    entry.streamer.displayName,
    entry.status?.streamerName,
    entry.status?.title,
  ].some((value) => value?.toLocaleLowerCase('zh-CN').includes(normalized))
}

export function queryEntries(entries: BoardEntry[], query: string) {
  return entries.filter((entry) => matchesQuery(entry, query))
}

export function visibleEntries(entries: BoardEntry[], filters: BoardFilters) {
  return queryEntries(entries, filters.query).filter((entry) =>
    filters.status === 'all' || entryStatus(entry) === filters.status)
}

export function boardCounts(entries: BoardEntry[]): BoardCounts {
  const counts: BoardCounts = {
    all: entries.length,
    live: 0,
    looping: 0,
    unknown: 0,
    offline: 0,
  }
  for (const entry of entries) counts[entryStatus(entry)] += 1
  return counts
}

export function groupEntries(entries: BoardEntry[]) {
  return {
    live: entries.filter((entry) => entryStatus(entry) === 'live'),
    looping: entries.filter((entry) => entryStatus(entry) === 'looping'),
    unknown: entries.filter((entry) => entryStatus(entry) === 'unknown'),
    offline: entries.filter((entry) => entryStatus(entry) === 'offline'),
  }
}
