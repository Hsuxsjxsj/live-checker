import { isCanonicalRoomUrl, type CanonicalRoomUrl } from '../../domain/canonical-room-url'
export type { CanonicalRoomUrl } from '../../domain/canonical-room-url'
export { toCanonicalRoomUrl } from '../../domain/canonical-room-url'

interface WatchTargetProps {
  roomUrl: CanonicalRoomUrl
  streamerName: string
}

export function WatchTarget({ roomUrl, streamerName }: WatchTargetProps) {
  if (!isCanonicalRoomUrl(roomUrl)) return null
  return (
    <a
      className="status-row-watch-target"
      href={roomUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`在原平台打开 ${streamerName} 的直播间`}
    />
  )
}
