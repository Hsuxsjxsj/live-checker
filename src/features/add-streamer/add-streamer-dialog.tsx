import type { ResolvedStreamer, SavedStreamer } from '../../domain/types'
import type { StreamerRepository } from '../../storage/local-streamer-repository'
import { Link, LoaderCircle, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { LiveApi, LiveApiErrorCode } from '../../platform/live-client'
import { LiveApiError } from '../../platform/live-client'

export interface AddStreamerDialogProps {
  repository: StreamerRepository
  api: LiveApi
  onSaved: (streamer: SavedStreamer) => void | Promise<void>
  onDismiss: () => void
}

type DialogStage = 'idle' | 'resolving' | 'preview' | 'saving' | 'success' | 'error'

const SUPPORTED_HOSTS = new Set([
  'live.bilibili.com',
  'b23.tv',
  'www.douyu.com',
  'm.douyu.com',
  'v.douyu.com',
  'live.douyin.com',
  'www.huya.com',
  'm.huya.com',
])
const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyu: '斗鱼',
  douyin: '抖音',
  huya: '虎牙',
} as const
const ERROR_COPY: Record<LiveApiErrorCode, string> = {
  VALIDATION_ERROR: '链接无效或暂不支持',
  RATE_LIMITED: '识别太频繁，请稍后再试',
  TEMPORARY_FAILURE: '平台暂时无法识别，请稍后再试',
  TRANSPORT_UNAVAILABLE: '当前部署没有可用的检测通道，请部署到 Cloudflare Pages 或在设置中配置代理',
  RELAY_REQUIRED: '抖音直播间需要内置中转检测（部署到 Cloudflare Pages 时自动可用）',
}

export function AddStreamerDialog({
  repository,
  api,
  onSaved,
  onDismiss,
}: AddStreamerDialogProps) {
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [resolved, setResolved] = useState<ResolvedStreamer | null>(null)
  const [stage, setStage] = useState<DialogStage>('idle')
  const [errorMessage, setErrorMessage] = useState<string>()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeRequest = useRef<AbortController | undefined>(undefined)
  const requestSequence = useRef(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    inputRef.current?.focus()
    return () => {
      requestSequence.current += 1
      activeRequest.current?.abort()
    }
  }, [])

  function handleUrlChange(value: string) {
    requestSequence.current += 1
    activeRequest.current?.abort()
    setUrl(value)
    setResolved(null)
    setName('')
    setErrorMessage(undefined)
    setStage('idle')
  }

  async function handleResolve() {
    const input = url.trim()
    const inputKind = classifyInput(input)
    if (inputKind !== 'supported') {
      setErrorMessage(inputKind === 'unsupported'
        ? '暂不支持该直播平台'
        : '链接无效，请粘贴完整直播间地址')
      setStage('error')
      return
    }

    const requestId = ++requestSequence.current
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setErrorMessage(undefined)
    setStage('resolving')
    try {
      const next = await api.resolve(input, { signal: controller.signal })
      if (controller.signal.aborted || requestId !== requestSequence.current) return
      setResolved(next)
      setName(next.streamerName?.trim() ?? '')
      setStage('preview')
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestSequence.current) return
      setErrorMessage(resolveErrorCopy(error))
      setStage('error')
    }
  }

  async function handleSave() {
    if (resolved === null || stage === 'saving') return
    const displayName = name.trim()
    if (displayName.length === 0) {
      setErrorMessage('请填写主播名称')
      setStage('error')
      return
    }
    if (displayName.length > 80) {
      setErrorMessage('主播名称不能超过 80 个字符')
      setStage('error')
      return
    }

    setErrorMessage(undefined)
    setStage('saving')
    try {
      const saved = await repository.create({
        platform: resolved.platform,
        roomId: resolved.roomId,
        roomUrl: resolved.roomUrl,
        displayName,
        avatarUrl: resolved.avatarUrl,
      })
      setStage('success')
      await onSaved(saved)
    } catch (error) {
      setErrorMessage(isRepositoryError(error, 'STREAMER_ALREADY_EXISTS')
        ? '这位主播已在关注列表中'
        : '保存失败，请稍后重试')
      setStage('error')
    }
  }

  function dismiss() {
    requestSequence.current += 1
    activeRequest.current?.abort()
    onDismiss()
  }

  const pending = stage === 'resolving' || stage === 'saving'
  return (
    <dialog
      ref={dialogRef}
      className="streamer-dialog"
      aria-labelledby="add-streamer-title"
      aria-describedby="add-streamer-description"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) dismiss()
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id="add-streamer-title">添加主播</h2>
          <p id="add-streamer-description">粘贴 B站、斗鱼、虎牙或抖音直播间链接。</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭添加主播"
          disabled={stage === 'saving'}
          onClick={dismiss}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="dialog-body">
        <label className="field-control">
          <span>直播间链接</span>
          <input
            ref={inputRef}
            type="url"
            required
            maxLength={2048}
            value={url}
            placeholder="https://live.douyin.com/房间号"
            disabled={stage === 'saving'}
            onChange={(event) => handleUrlChange(event.currentTarget.value)}
          />
        </label>
        <button
          type="button"
          className="primary-button"
          disabled={stage === 'resolving' || stage === 'saving'}
          onClick={() => void handleResolve()}
        >
          {stage === 'resolving' ? (
            <LoaderCircle aria-hidden="true" className="spin" size={17} />
          ) : <Link aria-hidden="true" size={17} />}
          {stage === 'resolving' ? '正在识别' : '识别直播间'}
        </button>

        {resolved !== null ? (
          <section className="resolved-preview" aria-labelledby="resolved-preview-title">
            <span id="resolved-preview-title">已识别直播间</span>
            <strong>{PLATFORM_LABELS[resolved.platform]}</strong>
            <code>{resolved.roomId}</code>
            <label className="field-control">
              <span>主播名称</span>
              <input
                type="text"
                required
                maxLength={80}
                value={name}
                disabled={stage === 'saving'}
                onChange={(event) => {
                  setName(event.currentTarget.value)
                  setErrorMessage(undefined)
                  setStage('preview')
                }}
              />
            </label>
          </section>
        ) : null}

        {errorMessage === undefined ? null : <p className="form-error" role="alert">{errorMessage}</p>}
      </div>

      <div className="dialog-actions">
        <button type="button" className="secondary-button" disabled={pending} onClick={dismiss}>
          取消
        </button>
        {resolved === null ? null : (
          <button
            type="button"
            className="primary-button"
            disabled={stage === 'saving' || stage === 'success'}
            onClick={() => void handleSave()}
          >
            {stage === 'saving' ? '正在保存' : '确认添加'}
          </button>
        )}
      </div>
    </dialog>
  )
}

function classifyInput(raw: string): 'supported' | 'unsupported' | 'invalid' {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return 'invalid'
    return SUPPORTED_HOSTS.has(url.hostname.toLowerCase()) ? 'supported' : 'unsupported'
  } catch {
    return 'invalid'
  }
}

function resolveErrorCopy(error: unknown) {
  return error instanceof LiveApiError
    ? ERROR_COPY[error.code]
    : ERROR_COPY.TEMPORARY_FAILURE
}

function isRepositoryError(error: unknown, code: string) {
  return error instanceof Error && error.message === code
}
