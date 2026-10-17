import { Settings2 } from 'lucide-react'
import type { ReactNode } from 'react'

import logoUrl from '../assets/hsu-logo.jpg'
import { ThemeToggle } from '../theme/theme-toggle'

interface AppShellProps {
  onOpenSettings(): void
  children: ReactNode
}

export function AppShell({ onOpenSettings, children }: AppShellProps) {
  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="app-header">
        <div className="header-inner">
          <a className="brand-lockup" href="./" aria-label="Hsu 直播看板">
            <img className="brand-logo" src={logoUrl} alt="Hsu" width="40" height="40" />
            <span className="brand-copy"><strong className="brand-name">Hsu</strong>
              <span className="brand-tagline">LIVE / 直播空间</span></span>
          </a>
          <div className="header-actions">
            <ThemeToggle />
            <span className="header-divider" aria-hidden="true" />
            <button
              type="button"
              className="icon-button"
              aria-label="检测通道设置"
              title="检测通道设置"
              onClick={onOpenSettings}
            >
              <Settings2 aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
          </div>
        </div>
      </header>
      <div className="workspace-content">{children}</div>
      <footer className="app-footer"><span>Hsu Live · 把喜欢的直播，放在一起。</span>
        <span>哔哩哔哩 / 斗鱼 / 虎牙 / 抖音</span></footer>
    </div>
  )
}
