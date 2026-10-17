import type { Transport } from '../platform/transport'
import { PlatformRequestError } from '../platform/transport'

/** 测试用传输层：按 URL 路由固定响应。 */
export class FakeTransport implements Transport {
  readonly kind: 'relay' | 'proxy'

  private readonly shortLinkTarget: string
  readonly requestedUrls: string[] = []

  constructor(
    private readonly router: (url: string) => { status: number; body: string } | undefined,
    options: { kind?: 'relay' | 'proxy'; shortLinkTarget?: string } = {},
  ) {
    this.kind = options.kind ?? 'relay'
    this.shortLinkTarget = options.shortLinkTarget ?? 'https://live.bilibili.com/23058'
  }

  async fetchPlatform(url: string): Promise<{ status: number; body: string }> {
    this.requestedUrls.push(url)
    const response = this.router(url)
    if (response === undefined) {
      throw new Error(`UNEXPECTED_URL:${url}`)
    }
    return response
  }

  async resolveShortLink(url: string): Promise<string> {
    this.requestedUrls.push(url)
    if (this.kind === 'proxy') {
      // 与真实 ProxyTransport 一致：公共代理无法解析短链接。
      throw new PlatformRequestError('RELAY_REQUIRED')
    }
    const response = this.router(url)
    if (response === undefined || response.status >= 400) {
      throw new PlatformRequestError('PLATFORM_ERROR')
    }
    return this.shortLinkTarget
  }
}

export function jsonResponse(body: unknown, status = 200): { status: number; body: string } {
  return { status, body: JSON.stringify(body) }
}
