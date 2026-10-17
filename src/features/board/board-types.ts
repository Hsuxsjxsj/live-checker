import type { SavedStreamer, StatusResult } from '../../domain/types'

export type BoardStatusFilter = 'all' | StatusResult['status']

export interface BoardFilters {
  query: string
  status: BoardStatusFilter
}

export interface BoardEntry {
  streamer: SavedStreamer
  status: StatusResult | null
}

export interface BoardCounts {
  all: number
  live: number
  looping: number
  unknown: number
  offline: number
}

export type BoardLoadState = 'ready' | 'loading' | 'error'
