import type { SavedStreamer } from '../domain/types'
import type { StreamerRepository } from '../storage/local-streamer-repository'
import { useCallback, useEffect, useRef, useState } from 'react'

export type StreamerListState = 'loading' | 'ready' | 'error'

export interface StreamerListResult {
  streamers: SavedStreamer[]
  state: StreamerListState
  errorMessage?: string
  refresh: () => Promise<void>
}

export function useStreamers(repository: StreamerRepository): StreamerListResult {
  const [streamers, setStreamers] = useState<SavedStreamer[]>([])
  const [state, setState] = useState<StreamerListState>('loading')
  const [errorMessage, setErrorMessage] = useState<string>()
  const requestSequence = useRef(0)
  const mounted = useRef(true)

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current
    setState('loading')
    setErrorMessage(undefined)
    try {
      const next = await repository.list()
      if (!mounted.current || requestId !== requestSequence.current) return
      setStreamers(next)
      setState('ready')
    } catch {
      if (!mounted.current || requestId !== requestSequence.current) return
      setState('error')
      setErrorMessage('暂时无法读取本地保存的关注列表')
    }
  }, [repository])

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => {
      mounted.current = false
      requestSequence.current += 1
    }
  }, [refresh])

  return {
    streamers,
    state,
    ...(errorMessage === undefined ? {} : { errorMessage }),
    refresh,
  }
}
