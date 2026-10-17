import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  saveTransportConfig,
  useTransportState,
  type TransportMode,
} from '../../platform/transport'

export interface TransportSettingsDialogProps {
  onDismiss: () => void
}

const MODE_OPTIONS: Array<{ value: TransportMode; label: string; description: string }> = [
  {
    value: 'auto',
    label: '自动（推荐）',
    description: '优先使用内置中转；不可用时使用下方公共代理。',
  },
  {
    value: 'relay',
    label: '仅内置中转',
    description: '只使用部署自带的 /api/relay（Cloudflare Pages 部署自动可用）。',
  },
  {
    value: 'proxy',
    label: '仅公共代理',
    description: '只使用下方配置的公共 CORS 代理（抖音与 B 站短链接不可用）。',
  },
]

export function TransportSettingsDialog({ onDismiss }: TransportSettingsDialogProps) {
  const transport = useTransportState()
  const [mode, setMode] = useState<TransportMode>(transport.config.mode)
  const [proxyTemplate, setProxyTemplate] = useState(transport.config.proxyTemplate)
  const [errorMessage, setErrorMessage] = useState<string>()
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog !== null && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
  }, [])

  function save() {
    if (mode === 'proxy' && proxyTemplate.trim() === '') {
      setErrorMessage('使用公共代理模式需要先填写代理地址')
      return
    }
    if (proxyTemplate.trim() !== '' && !proxyTemplate.trim().startsWith('https://')) {
      setErrorMessage('代理地址必须是 https:// 开头的 URL 模板')
      return
    }
    saveTransportConfig({ mode, proxyTemplate })
    onDismiss()
  }

  const relayLabel = transport.probing
    ? '正在探测…'
    : transport.relayAvailable ? '可用' : '不可用（当前部署没有 /api/relay）'

  return (
    <dialog
      ref={dialogRef}
      className="streamer-dialog transport-dialog"
      aria-labelledby="transport-settings-title"
      onCancel={(event) => {
        event.preventDefault()
        onDismiss()
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id="transport-settings-title">检测通道设置</h2>
          <p>直播平台接口不允许浏览器直接访问，检测请求需要经过一个中转通道。</p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭检测通道设置"
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={18} />
        </button>
      </div>

      <div className="dialog-body">
        <p className="relay-status" data-available={transport.probing ? undefined : transport.relayAvailable}>
          内置中转：{relayLabel}
        </p>

        <div className="mode-options" role="radiogroup" aria-label="检测通道模式">
          {MODE_OPTIONS.map((option) => (
            <label key={option.value} className="mode-option">
              <input
                type="radio"
                name="transport-mode"
                value={option.value}
                checked={mode === option.value}
                onChange={() => {
                  setMode(option.value)
                  setErrorMessage(undefined)
                }}
              />
              <span className="mode-copy">
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <label className="field-control">
          <span>公共 CORS 代理模板</span>
          <input
            type="url"
            maxLength={512}
            value={proxyTemplate}
            placeholder="https://api.allorigins.win/raw?url="
            onChange={(event) => {
              setProxyTemplate(event.currentTarget.value)
              setErrorMessage(undefined)
            }}
          />
        </label>
        <p className="proxy-hint">
          目标地址会以 encodeURIComponent 编码后替换模板中的 {'{url}'} 占位符；没有占位符时直接拼接在末尾。
          示例：https://api.allorigins.win/raw?url= 或 https://api.codetabs.com/v1/proxy?quest=
          。公共代理由第三方提供，速度与稳定性不可保证。
        </p>

        {errorMessage === undefined ? null : <p className="form-error" role="alert">{errorMessage}</p>}
      </div>

      <div className="dialog-actions">
        <button type="button" className="secondary-button" onClick={onDismiss}>
          取消
        </button>
        <button type="button" className="primary-button" onClick={save}>
          保存设置
        </button>
      </div>
    </dialog>
  )
}

export function TransportNotice({ onOpenSettings }: { onOpenSettings(): void }) {
  return (
    <section className="transport-notice" role="note" aria-label="检测通道不可用提示">
      <div>
        <strong>当前部署没有可用的检测通道</strong>
        <p>
          四个直播平台的接口都不允许浏览器直接访问。部署到 Cloudflare Pages
          会自动启用内置中转；部署到 GitHub Pages 等纯静态空间时，请在设置中配置公共 CORS 代理。
        </p>
      </div>
      <button type="button" className="secondary-button" onClick={onOpenSettings}>
        打开检测通道设置
      </button>
    </section>
  )
}
