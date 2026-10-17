import type { SavedStreamer } from '../../domain/types'
import type { StreamerRepository } from '../../storage/local-streamer-repository'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { LiveApi } from '../../platform/live-client'
import { useAnchoredPopover } from '../../components/use-anchored-popover'

export interface StreamerActionsProps {
  streamer: SavedStreamer
  repository: StreamerRepository
  api: LiveApi
  onChanged: () => void | Promise<void>
}

type ActionMode = 'closed' | 'menu' | 'edit' | 'delete'

export function StreamerActions({
  streamer,
  repository,
  api,
  onChanged,
}: StreamerActionsProps) {
  const [mode, setMode] = useState<ActionMode>('closed')
  const [name, setName] = useState(streamer.displayName)
  const [roomUrl, setRoomUrl] = useState(streamer.roomUrl)
  const [pending, setPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()
  const actionsRef = useRef<HTMLDivElement>(null)
  const manageRef = useRef<HTMLButtonElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)
  const activeResolve = useRef<AbortController | undefined>(undefined)
  const menuId = `streamer-actions-${streamer.id}`
  const { popoverRef, popoverStyle } = useAnchoredPopover(manageRef, mode !== 'closed', mode)

  useEffect(() => {
    if (mode !== 'menu') return
    function dismissMenu(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) setMode('closed')
    }
    document.addEventListener('pointerdown', dismissMenu)
    return () => document.removeEventListener('pointerdown', dismissMenu)
  }, [mode])

  useEffect(() => {
    if (mode === 'edit') editInputRef.current?.focus()
    if (mode === 'delete') cancelDeleteRef.current?.focus()
  }, [mode])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (mode === 'closed') {
      setName(streamer.displayName)
      setRoomUrl(streamer.roomUrl)
    }
  }, [mode, streamer.displayName, streamer.roomUrl])

  useEffect(() => () => activeResolve.current?.abort(), [])

  function close() {
    setMode('closed')
    setErrorMessage(undefined)
    queueMicrotask(() => manageRef.current?.focus())
  }

  async function saveChanges() {
    const displayName = name.trim()
    if (displayName.length === 0) {
      setErrorMessage('请填写主播名称')
      return
    }
    if (displayName.length > 80) {
      setErrorMessage('主播名称不能超过 80 个字符')
      return
    }
    setErrorMessage(undefined)
    let roomPatch: Pick<SavedStreamer, 'platform' | 'roomId' | 'roomUrl'> | undefined
    const nextRoomUrl = roomUrl.trim()
    if (nextRoomUrl !== streamer.roomUrl) {
      const controller = new AbortController()
      activeResolve.current?.abort()
      activeResolve.current = controller
      setPending(true)
      try {
        const resolved = await api.resolve(nextRoomUrl, { signal: controller.signal })
        roomPatch = {
          platform: resolved.platform,
          roomId: resolved.roomId,
          roomUrl: resolved.roomUrl,
        }
      } catch {
        if (mounted.current && !controller.signal.aborted) {
          setErrorMessage('直播间链接无法识别')
        }
        if (mounted.current) setPending(false)
        return
      }
    }

    setPending(true)
    try {
      await repository.update(streamer.id, {
        displayName,
        ...(roomPatch === undefined ? {} : roomPatch),
      })
      await onChanged()
      if (mounted.current) close()
    } catch {
      if (mounted.current) setErrorMessage('保存失败，请稍后重试')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  async function remove() {
    setPending(true)
    setErrorMessage(undefined)
    try {
      await repository.remove(streamer.id)
      await onChanged()
      if (mounted.current) close()
    } catch {
      if (mounted.current) setErrorMessage('删除失败，请稍后重试')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <div
      ref={actionsRef}
      className="streamer-actions"
      onBlur={(event) => {
        if (mode === 'menu' && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setMode('closed')
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !pending) close()
      }}
    >
      <button
        ref={manageRef}
        type="button"
        className="row-action"
        disabled={pending}
        aria-label={`管理${streamer.displayName}`}
        aria-expanded={mode !== 'closed'}
        aria-controls={menuId}
        onClick={() => setMode((current) => current === 'closed' ? 'menu' : 'closed')}
      >
        <MoreHorizontal aria-hidden="true" size={18} />
        <span>管理</span>
      </button>

      {mode === 'menu' ? (
        <div ref={popoverRef} style={popoverStyle} id={menuId} className="action-popover" aria-label={`管理${streamer.displayName}操作`}>
          <button type="button" onClick={() => setMode('edit')}>
            编辑{streamer.displayName}
          </button>
          <button type="button" onClick={() => setMode('delete')}>
            删除{streamer.displayName}
          </button>
        </div>
      ) : null}

      {mode === 'edit' ? (
        <div ref={popoverRef} style={popoverStyle} id={menuId} className="action-popover action-editor" role="group"
          aria-label={`编辑${streamer.displayName}`} >
          <label className="field-control">
            <span>主播名称</span>
            <input
              ref={editInputRef}
              type="text"
              required
              maxLength={80}
              value={name}
              disabled={pending}
              onChange={(event) => {
                setName(event.currentTarget.value)
                setErrorMessage(undefined)
              }}
            />
          </label>
          <label className="field-control">
            <span>直播间链接</span>
            <input
              type="url"
              required
              maxLength={2048}
              value={roomUrl}
              disabled={pending}
              onChange={(event) => {
                setRoomUrl(event.currentTarget.value)
                setErrorMessage(undefined)
              }}
            />
          </label>
          {errorMessage === undefined ? null : <p className="form-error" role="alert">{errorMessage}</p>}
          <div className="compact-actions">
            <button type="button" disabled={pending} onClick={close}>取消编辑</button>
            <button type="button" disabled={pending} onClick={() => void saveChanges()}>
              {pending ? '正在保存' : '保存修改'}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'delete' ? (
        <div
          ref={popoverRef}
          style={popoverStyle}
          id={menuId}
          className="action-popover delete-confirmation"
          role="group"
          aria-labelledby={`${menuId}-title`}
        >
          <strong id={`${menuId}-title`}>确定删除这位主播吗？</strong>
          <p>只会从本地关注列表删除这条记录。</p>
          {errorMessage === undefined ? null : <p className="form-error" role="alert">{errorMessage}</p>}
          <div className="compact-actions">
            <button ref={cancelDeleteRef} type="button" disabled={pending} onClick={close}>取消删除</button>
            <button type="button" disabled={pending} onClick={() => void remove()}>
              {pending ? '正在删除' : '确认删除'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
