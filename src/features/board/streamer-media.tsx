import { Radio } from 'lucide-react'
import { useState } from 'react'

import { StreamerAvatar } from './streamer-avatar'

export interface StreamerMediaProps {
  name: string
  avatarSrc: string | null
  fallbackAvatarSrc?: string | null
  coverSrc: string | null
}

export function StreamerMedia({
  name,
  avatarSrc,
  fallbackAvatarSrc = null,
  coverSrc,
}: StreamerMediaProps) {
  const [failedCoverSources, setFailedCoverSources] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const activeCoverSrc = uniqueSources(coverSrc, avatarSrc, fallbackAvatarSrc)
    .find((candidate) => !failedCoverSources.has(candidate)) ?? null

  return (
    <span className="streamer-media">
      <span className="streamer-cover" aria-hidden="true">
        {activeCoverSrc === null ? (
          <span className="cover-placeholder"><Radio size={32} strokeWidth={1.2} />暂无直播封面</span>
        ) : (
          <img
            className="streamer-cover-image"
            src={activeCoverSrc}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailedCoverSources(
              (current) => new Set(current).add(activeCoverSrc),
            )}
          />
        )}
      </span>
      <StreamerAvatar
        name={name}
        src={avatarSrc}
        fallbackSrc={fallbackAvatarSrc}
      />
    </span>
  )
}

function uniqueSources(...sources: Array<string | null>) {
  return [...new Set(sources.filter((source): source is string => source !== null))]
}
