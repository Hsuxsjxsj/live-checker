import { useState } from 'react'

export interface StreamerAvatarProps {
  name: string
  src: string | null
  fallbackSrc?: string | null
}

export function StreamerAvatar({ name, src, fallbackSrc = null }: StreamerAvatarProps) {
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set())
  const initial = Array.from(name.trim())[0] ?? '?'
  const activeSrc = uniqueSources(src, fallbackSrc)
    .find((candidate) => !failedSources.has(candidate)) ?? null

  return (
    <span className="streamer-avatar" aria-hidden="true">
      <span>{initial}</span>
      {activeSrc !== null ? (
        <img
          src={activeSrc}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSources((current) => new Set(current).add(activeSrc))}
        />
      ) : null}
    </span>
  )
}

function uniqueSources(...sources: Array<string | null>) {
  return [...new Set(sources.filter((source): source is string => source !== null))]
}
