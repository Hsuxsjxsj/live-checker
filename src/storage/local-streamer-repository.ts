import type { CreateStreamerInput, SavedStreamer, StreamerId } from '../domain/types'
import { isPlatform } from '../domain/types'

export interface StreamerRepository {
  list(): Promise<SavedStreamer[]>
  create(input: CreateStreamerInput): Promise<SavedStreamer>
  update(
    id: StreamerId,
    patch: Partial<Pick<
      SavedStreamer,
      'platform' | 'roomId' | 'roomUrl' | 'displayName' | 'avatarUrl'
    >>,
  ): Promise<SavedStreamer>
  remove(id: StreamerId): Promise<void>
  reorder?(ids: readonly StreamerId[]): Promise<SavedStreamer[]>
}

const STORAGE_KEY = 'hsu-live-streamers-v1'
const MAX_STREAMERS = 500
const MAX_DISPLAY_NAME_LENGTH = 80

interface StoredPayload {
  schemaVersion: 1
  streamers: SavedStreamer[]
}

function isSavedStreamer(value: unknown): value is SavedStreamer {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id.length > 0
    && isPlatform(candidate.platform)
    && typeof candidate.roomId === 'string' && candidate.roomId.length > 0
    && typeof candidate.roomUrl === 'string'
    && typeof candidate.displayName === 'string' && candidate.displayName.length > 0
    && (candidate.avatarUrl === null || typeof candidate.avatarUrl === 'string')
    && typeof candidate.createdAt === 'string'
    && typeof candidate.updatedAt === 'string'
    && typeof candidate.revision === 'number'
    && candidate.schemaVersion === 1
}

function readAll(): SavedStreamer[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return []
    const payload = parsed as { schemaVersion?: unknown; streamers?: unknown }
    if (payload.schemaVersion !== 1 || !Array.isArray(payload.streamers)) return []
    return payload.streamers.filter(isSavedStreamer)
  } catch {
    return []
  }
}

function writeAll(streamers: SavedStreamer[]) {
  const payload: StoredPayload = { schemaVersion: 1, streamers }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    throw new Error('STORAGE_UNAVAILABLE')
  }
}

function randomId(): StreamerId {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID() as StreamerId
  }
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` as StreamerId
}

function identity(streamer: Pick<SavedStreamer, 'platform' | 'roomId'>): string {
  return `${streamer.platform}:${streamer.roomId}`
}

function normalizeDisplayName(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error('DISPLAY_NAME_REQUIRED')
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) throw new Error('DISPLAY_NAME_TOO_LONG')
  return trimmed
}

/** 关注列表保存在浏览器 localStorage 的仓库实现（无后端部署的数据层）。 */
export class LocalStreamerRepository implements StreamerRepository {
  async list(): Promise<SavedStreamer[]> {
    return readAll().map((streamer) => ({ ...streamer }))
  }

  async create(input: CreateStreamerInput): Promise<SavedStreamer> {
    const displayName = normalizeDisplayName(input.displayName)
    const streamers = readAll()
    if (streamers.length >= MAX_STREAMERS) {
      throw new Error('STREAMER_LIMIT_REACHED')
    }
    if (streamers.some((streamer) => identity(streamer) === identity(input))) {
      throw new Error('STREAMER_ALREADY_EXISTS')
    }
    const now = new Date().toISOString()
    const saved: SavedStreamer = {
      id: randomId(),
      platform: input.platform,
      roomId: input.roomId,
      roomUrl: input.roomUrl,
      displayName,
      avatarUrl: input.avatarUrl,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      schemaVersion: 1,
    }
    streamers.push(saved)
    writeAll(streamers)
    return { ...saved }
  }

  async update(
    id: StreamerId,
    patch: Partial<Pick<
      SavedStreamer,
      'platform' | 'roomId' | 'roomUrl' | 'displayName' | 'avatarUrl'
    >>,
  ): Promise<SavedStreamer> {
    const streamers = readAll()
    const index = streamers.findIndex((streamer) => streamer.id === id)
    if (index < 0) throw new Error('STREAMER_NOT_FOUND')
    const current = streamers[index]!

    const nextPlatform = patch.platform ?? current.platform
    const nextRoomId = patch.roomId ?? current.roomId
    const nextRoomUrl = patch.roomUrl ?? current.roomUrl
    const nextDisplayName = patch.displayName === undefined
      ? current.displayName
      : normalizeDisplayName(patch.displayName)
    const nextAvatarUrl = patch.avatarUrl === undefined ? current.avatarUrl : patch.avatarUrl

    if ((nextPlatform !== current.platform || nextRoomId !== current.roomId)
      && streamers.some((streamer) =>
        streamer.id !== id && identity(streamer) === `${nextPlatform}:${nextRoomId}`)) {
      throw new Error('STREAMER_ALREADY_EXISTS')
    }

    const updated: SavedStreamer = {
      ...current,
      platform: nextPlatform,
      roomId: nextRoomId,
      roomUrl: nextRoomUrl,
      displayName: nextDisplayName,
      avatarUrl: nextAvatarUrl,
      updatedAt: new Date().toISOString(),
      revision: current.revision + 1,
    }
    streamers[index] = updated
    writeAll(streamers)
    return { ...updated }
  }

  async remove(id: StreamerId): Promise<void> {
    const streamers = readAll()
    const next = streamers.filter((streamer) => streamer.id !== id)
    if (next.length === streamers.length) throw new Error('STREAMER_NOT_FOUND')
    writeAll(next)
  }

  async reorder(ids: readonly StreamerId[]): Promise<SavedStreamer[]> {
    const streamers = readAll()
    const byId = new Map(streamers.map((streamer) => [streamer.id as string, streamer]))
    const reordered: SavedStreamer[] = []
    for (const id of ids) {
      const streamer = byId.get(id)
      if (streamer === undefined) throw new Error('REORDER_MISMATCH')
      byId.delete(id)
      reordered.push(streamer)
    }
    if (byId.size !== 0) throw new Error('REORDER_MISMATCH')
    writeAll(reordered)
    return reordered.map((streamer) => ({ ...streamer }))
  }
}
