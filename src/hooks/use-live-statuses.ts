import type { SavedStreamer, StatusResult } from '../domain/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import type { LiveApi, StatusTarget } from '../platform/live-client'

export const STATUS_POLL_INTERVAL = 120_000
export const MANUAL_RETRY_COOLDOWN = 10_000
const MAX_BATCH_SIZE = 100

export type StatusFreshness =
  | 'idle'
  | 'loading'
  | 'fresh'
  | 'refreshing'
  | 'stale'
  | 'unavailable'

export interface LiveStatuses {
  entries: StatusResult[]
  freshness: StatusFreshness
  lastUpdatedAt: number | null
  announcement: string
  isForceRefreshing: boolean
  isBoardRetryDisabled: boolean
  isRowRetryDisabled: (streamer: SavedStreamer) => boolean
  retryAll: () => Promise<boolean>
  retryOne: (streamer: SavedStreamer) => Promise<boolean>
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}

function readVisibility() {
  return document.visibilityState === 'visible'
}

function serverVisibility() {
  return true
}

function statusIdentity(target: StatusTarget) {
  return `${target.platform}:${target.roomId}`
}

export function sortedUniqueTargets(streamers: SavedStreamer[]): StatusTarget[] {
  const unique = new Map<string, StatusTarget>()
  for (const { platform, roomId } of streamers) {
    const target = { platform, roomId }
    unique.set(statusIdentity(target), target)
  }
  return [...unique.values()].sort((left, right) =>
    statusIdentity(left).localeCompare(statusIdentity(right)))
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function fetchTargets(
  api: LiveApi,
  targets: StatusTarget[],
  force: boolean,
  signal?: AbortSignal,
) {
  const responses = await Promise.all(chunks(targets, MAX_BATCH_SIZE).map((batch) =>
    api.status(batch, {
      force,
      ...(signal === undefined ? {} : { signal }),
    })))
  return responses.flatMap(({ data }) => data)
}

function addPending(
  pending: Map<string, Set<number>>,
  targets: StatusTarget[],
  generation: number,
) {
  for (const target of targets) {
    const identity = statusIdentity(target)
    const generations = pending.get(identity) ?? new Set<number>()
    generations.add(generation)
    pending.set(identity, generations)
  }
}

function removePending(
  pending: Map<string, Set<number>>,
  targets: StatusTarget[],
  generation: number,
) {
  for (const target of targets) {
    const identity = statusIdentity(target)
    const generations = pending.get(identity)
    generations?.delete(generation)
    if (generations?.size === 0) pending.delete(identity)
  }
}

function highest(values: Iterable<number>) {
  let result = 0
  for (const value of values) result = Math.max(result, value)
  return result
}

export function useLiveStatuses(
  streamers: SavedStreamer[],
  api: LiveApi,
): LiveStatuses {
  const visible = useSyncExternalStore(
    subscribeVisibility,
    readVisibility,
    serverVisibility,
  )
  const targets = sortedUniqueTargets(streamers)
  const identities = targets.map(statusIdentity)
  const identityKey = identities.join('|')
  const stableTargets = useMemo(() => targets, [identityKey])
  const queryKey = useMemo(() => ['live-statuses', identities] as const, [identityKey])
  const queryClient = useQueryClient()
  const cachedForQuery = queryClient.getQueryData<StatusResult[]>(queryKey)
  const cachedIdentities = new Set(Array.isArray(cachedForQuery)
    ? cachedForQuery.map(statusIdentity)
    : [])
  const cachedState = queryClient.getQueryState(queryKey)
  const canReuseCachedQuery = stableTargets.every((target) =>
    cachedIdentities.has(statusIdentity(target)))
    && cachedState !== undefined
    && Date.now() - cachedState.dataUpdatedAt < STATUS_POLL_INTERVAL
  const generation = useRef(0)
  const statuses = useRef(new Map<string, StatusResult>())
  const pending = useRef(new Map<string, Set<number>>())
  const candidates = useRef(new Map<string, Map<number, StatusResult>>())
  const lastSuccess = useRef(new Map<string, number>())
  const lastFailure = useRef(new Map<string, number>())
  const hydratedKeys = useRef(new Set<string>())
  const cooldowns = useRef(new Map<string, number>())
  const previousLive = useRef<Set<string> | null>(null)
  const announcementKey = useRef(identityKey)
  const announcementBaselineReady = useRef(false)
  const mounted = useRef(true)
  const manualControllers = useRef(new Set<AbortController>())
  const cooldownTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [announcement, setAnnouncement] = useState('')
  const [statusRevision, setStatusRevision] = useState(0)
  const [forceRequests, setForceRequests] = useState(0)
  const [pendingControls, setPendingControls] = useState<ReadonlySet<string>>(new Set())
  const [cooldownRevision, setCooldownRevision] = useState(0)

  function project(requestedTargets: StatusTarget[]) {
    return requestedTargets.flatMap((target) => {
      const entry = statuses.current.get(statusIdentity(target))
      return entry === undefined ? [] : [entry]
    })
  }

  function applyBestCandidate(identity: string) {
    const available = candidates.current.get(identity)
    if (available === undefined) return false
    const highestPending = highest(pending.current.get(identity) ?? [])
    const applied = lastSuccess.current.get(identity) ?? 0
    for (const candidateGeneration of available.keys()) {
      if (candidateGeneration <= applied) available.delete(candidateGeneration)
    }
    if (available.size === 0) {
      candidates.current.delete(identity)
      return false
    }
    let selectedGeneration = 0
    let selected: StatusResult | undefined
    for (const [candidateGeneration, candidate] of available) {
      if (candidateGeneration > highestPending
        && candidateGeneration > applied
        && candidateGeneration > selectedGeneration) {
        selectedGeneration = candidateGeneration
        selected = candidate
      }
    }
    if (selected === undefined) return false

    statuses.current.set(identity, selected)
    lastSuccess.current.set(identity, selectedGeneration)
    for (const candidateGeneration of available.keys()) {
      if (candidateGeneration <= selectedGeneration) available.delete(candidateGeneration)
    }
    if (available.size === 0) candidates.current.delete(identity)
    return true
  }

  function acceptSuccess(
    requestedTargets: StatusTarget[],
    requestGeneration: number,
    response: StatusResult[],
  ) {
    removePending(pending.current, requestedTargets, requestGeneration)
    for (const entry of response) {
      const identity = statusIdentity(entry)
      const available = candidates.current.get(identity) ?? new Map<number, StatusResult>()
      available.set(requestGeneration, entry)
      candidates.current.set(identity, available)
    }
    let changed = false
    for (const target of requestedTargets) {
      const identity = statusIdentity(target)
      changed = applyBestCandidate(identity) || changed
    }
    if (changed && mounted.current) setStatusRevision((value) => value + 1)
  }

  function acceptFailure(requestedTargets: StatusTarget[], requestGeneration: number) {
    removePending(pending.current, requestedTargets, requestGeneration)
    let changed = false
    for (const target of requestedTargets) {
      const identity = statusIdentity(target)
      lastFailure.current.set(
        identity,
        Math.max(lastFailure.current.get(identity) ?? 0, requestGeneration),
      )
      changed = applyBestCandidate(identity) || changed
    }
    if ((changed || requestedTargets.length > 0) && mounted.current) {
      setStatusRevision((value) => value + 1)
    }
  }

  function cancelPending(requestedTargets: StatusTarget[], requestGeneration: number) {
    removePending(pending.current, requestedTargets, requestGeneration)
    let changed = false
    for (const target of requestedTargets) {
      changed = applyBestCandidate(statusIdentity(target)) || changed
    }
    if (changed && mounted.current) setStatusRevision((value) => value + 1)
  }

  function beginRequest(requestedTargets: StatusTarget[]) {
    const requestGeneration = ++generation.current
    addPending(pending.current, requestedTargets, requestGeneration)
    return requestGeneration
  }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      for (const controller of manualControllers.current) controller.abort()
      manualControllers.current.clear()
      for (const timer of cooldownTimers.current.values()) clearTimeout(timer)
      cooldownTimers.current.clear()
    }
  }, [])

  if (!hydratedKeys.current.has(identityKey)) {
    hydratedKeys.current.add(identityKey)
    const cached = cachedForQuery
    if (Array.isArray(cached) && cached.length > 0) {
      const baselineGeneration = ++generation.current
      const requested = new Set(identities)
      for (const entry of cached) {
        const identity = statusIdentity(entry)
        if (requested.has(identity) && !statuses.current.has(identity)) {
          statuses.current.set(identity, entry)
          lastSuccess.current.set(identity, baselineGeneration)
        }
      }
    }
  }

  const { dataUpdatedAt, refetch } = useQuery({
    queryKey,
    enabled: stableTargets.length > 0,
    retry: false,
    staleTime: STATUS_POLL_INTERVAL,
    refetchOnMount: canReuseCachedQuery ? false : 'always',
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: visible && stableTargets.length > 0
      ? STATUS_POLL_INTERVAL
      : false,
    queryFn: async ({ signal }) => {
      const requestGeneration = beginRequest(stableTargets)
      try {
        const response = await fetchTargets(api, stableTargets, false, signal)
        if (mounted.current) {
          acceptSuccess(stableTargets, requestGeneration, response)
          queryClient.setQueryData(queryKey, project(stableTargets))
        } else {
          cancelPending(stableTargets, requestGeneration)
        }
        return project(stableTargets)
      } catch (error) {
        if (!signal.aborted && mounted.current) {
          acceptFailure(stableTargets, requestGeneration)
        } else {
          cancelPending(stableTargets, requestGeneration)
        }
        throw error
      }
    },
  })

  const previouslyVisible = useRef(visible)
  useEffect(() => {
    const becameVisible = visible && !previouslyVisible.current
    previouslyVisible.current = visible
    if (becameVisible && stableTargets.length > 0) {
      void refetch({ cancelRefetch: false })
    }
  }, [refetch, stableTargets.length, visible])

  const entries = useMemo(() => project(stableTargets), [identityKey, statusRevision])

  useEffect(() => {
    if (announcementKey.current !== identityKey) {
      announcementKey.current = identityKey
      previousLive.current = null
      announcementBaselineReady.current = false
      setAnnouncement('')
    }
    const live = new Set(entries
      .filter(({ status }) => status === 'live')
      .map(statusIdentity))
    if (!announcementBaselineReady.current) {
      if (entries.length === 0) return
      announcementBaselineReady.current = true
      previousLive.current = live
      return
    }
    const newlyLive = [...live].filter((identity) => !previousLive.current?.has(identity)).length
    previousLive.current = live
    setAnnouncement(newlyLive > 0 ? `新增${newlyLive}位主播开播` : '')
  }, [entries, identityKey])

  const force = useCallback(async (
    controlKey: string,
    requestedTargets: StatusTarget[],
  ) => {
    const now = Date.now()
    const lastRequestedAt = cooldowns.current.get(controlKey)
    if (lastRequestedAt !== undefined && now - lastRequestedAt < MANUAL_RETRY_COOLDOWN) {
      return false
    }
    cooldowns.current.set(controlKey, now)
    const existingTimer = cooldownTimers.current.get(controlKey)
    if (existingTimer !== undefined) clearTimeout(existingTimer)
    cooldownTimers.current.set(controlKey, setTimeout(() => {
      cooldowns.current.delete(controlKey)
      if (mounted.current) setCooldownRevision((value) => value + 1)
    }, MANUAL_RETRY_COOLDOWN))
    const requestGeneration = beginRequest(requestedTargets)
    const controller = new AbortController()
    manualControllers.current.add(controller)
    setForceRequests((count) => count + 1)
    setPendingControls((current) => new Set(current).add(controlKey))
    try {
      const response = await fetchTargets(api, requestedTargets, true, controller.signal)
      if (!controller.signal.aborted && mounted.current) {
        acceptSuccess(requestedTargets, requestGeneration, response)
        queryClient.setQueryData(queryKey, project(stableTargets))
      }
    } catch {
      if (!controller.signal.aborted && mounted.current) {
        acceptFailure(requestedTargets, requestGeneration)
      } else {
        cancelPending(requestedTargets, requestGeneration)
      }
    } finally {
      manualControllers.current.delete(controller)
      if (mounted.current) {
        setForceRequests((count) => Math.max(0, count - 1))
        setPendingControls((current) => {
          const next = new Set(current)
          next.delete(controlKey)
          return next
        })
      }
    }
    return true
  }, [api, queryClient, queryKey, stableTargets])

  const retryAll = useCallback(() => {
    if (stableTargets.length === 0) return Promise.resolve(false)
    return force('board', stableTargets)
  }, [force, stableTargets])

  const retryOne = useCallback((streamer: SavedStreamer) => {
    const target = { platform: streamer.platform, roomId: streamer.roomId }
    if (!identities.includes(statusIdentity(target))) return Promise.resolve(false)
    return force(`row:${statusIdentity(target)}`, [target])
  }, [force, identities])

  const isCoolingDown = useCallback((controlKey: string) => {
    void cooldownRevision
    const startedAt = cooldowns.current.get(controlKey)
    return startedAt !== undefined && Date.now() - startedAt < MANUAL_RETRY_COOLDOWN
  }, [cooldownRevision])

  const isRowRetryDisabled = useCallback((streamer: SavedStreamer) => {
    const identity = statusIdentity(streamer)
    const controlKey = `row:${identity}`
    return !identities.includes(identity)
      || pendingControls.has(controlKey)
      || isCoolingDown(controlKey)
  }, [identities, isCoolingDown, pendingControls])

  const failed = stableTargets.some((target) => {
    const identity = statusIdentity(target)
    return (lastFailure.current.get(identity) ?? 0) > (lastSuccess.current.get(identity) ?? 0)
  })
  const relevantPending = stableTargets.some((target) => {
    const identity = statusIdentity(target)
    const applied = lastSuccess.current.get(identity) ?? 0
    return [...(pending.current.get(identity) ?? [])].some((value) => value > applied)
  })
  let freshness: StatusFreshness = 'idle'
  if (stableTargets.length > 0) {
    if (failed) freshness = entries.length > 0 ? 'stale' : 'unavailable'
    else if (relevantPending || forceRequests > 0) {
      freshness = entries.length > 0 ? 'refreshing' : 'loading'
    } else if (entries.length < stableTargets.length) freshness = 'loading'
    else freshness = 'fresh'
  }

  return {
    entries,
    freshness,
    lastUpdatedAt: dataUpdatedAt === 0 ? null : dataUpdatedAt,
    announcement,
    isForceRefreshing: forceRequests > 0,
    isBoardRetryDisabled: stableTargets.length === 0
      || pendingControls.has('board')
      || isCoolingDown('board'),
    isRowRetryDisabled,
    retryAll,
    retryOne,
  }
}
