import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TransportConfig } from './transport'

interface FetchMock {
  (input: string | URL | RequestInfo, init?: RequestInit): Promise<Response>
}

function jsonResponseMock(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadTransportModule() {
  const module = await import('./transport')
  return module
}

describe('transport', () => {
  beforeEach(() => {
    vi.resetModules()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('自动模式：内置中转可用时优先使用中转', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) return Promise.resolve(jsonResponseMock({ ok: true, probe: true }))
      if (url.includes('api/relay?u=')) {
        return Promise.resolve(jsonResponseMock({
          ok: true,
          status: 200,
          body: JSON.stringify({ code: 0 }),
        }))
      }
      return Promise.resolve(new Response('not found', { status: 404 }))
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { pickTransport } = await loadTransportModule()
    const transport = await pickTransport()
    expect(transport.kind).toBe('relay')
    const response = await transport.fetchPlatform('https://api.live.bilibili.com/x')
    expect(response.status).toBe(200)
    expect(response.body).toBe(JSON.stringify({ code: 0 }))
  })

  it('自动模式：中转不可用且配置了代理时使用代理并正确拼接地址', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) {
        return Promise.resolve(new Response('404 html', {
          status: 404,
          headers: { 'content-type': 'text/html' },
        }))
      }
      expect(url).toBe('https://api.allorigins.win/raw?url=https%3A%2F%2Fapi.live.bilibili.com%2Froom%2Fv1%2FRoom%2Fget_info%3Froom_id%3D23058')
      return Promise.resolve(jsonResponseMock({ code: 0, data: {} }))
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const config: TransportConfig = {
      mode: 'auto',
      proxyTemplate: 'https://api.allorigins.win/raw?url=',
    }
    window.localStorage.setItem('hsu-live-transport-v1', JSON.stringify(config))

    const { pickTransport } = await loadTransportModule()
    const transport = await pickTransport()
    expect(transport.kind).toBe('proxy')
    const response = await transport.fetchPlatform(
      'https://api.live.bilibili.com/room/v1/Room/get_info?room_id=23058',
    )
    expect(response.status).toBe(200)
  })

  it('代理模板支持 {url} 占位符', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) {
        return Promise.resolve(new Response('404', { status: 404 }))
      }
      expect(url).toBe('https://proxy.example.com/?target=https%3A%2F%2Fmp.huya.com%2Fcache.php%3Fm%3DLive')
      return Promise.resolve(jsonResponseMock({ status: 200, data: {} }))
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    window.localStorage.setItem('hsu-live-transport-v1', JSON.stringify({
      mode: 'proxy',
      proxyTemplate: 'https://proxy.example.com/?target={url}',
    } satisfies TransportConfig))

    const { pickTransport } = await loadTransportModule()
    const transport = await pickTransport()
    expect(transport.kind).toBe('proxy')
    await transport.fetchPlatform('https://mp.huya.com/cache.php?m=Live')
  })

  it('自动模式：无中转且未配置代理时抛出 NoTransportError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('404', { status: 404 }))) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { pickTransport, NoTransportError } = await loadTransportModule()
    await expect(pickTransport()).rejects.toBeInstanceOf(NoTransportError)
  })

  it('仅代理模式但未填写模板时抛出 NoTransportError', async () => {
    window.localStorage.setItem('hsu-live-transport-v1', JSON.stringify({
      mode: 'proxy',
      proxyTemplate: '',
    } satisfies TransportConfig))

    const { pickTransport, NoTransportError } = await loadTransportModule()
    await expect(pickTransport()).rejects.toBeInstanceOf(NoTransportError)
  })

  it('仅中转模式不触发探测请求', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      expect(url.includes('probe=1')).toBe(false)
      if (url.includes('api/relay?u=')) {
        return Promise.resolve(jsonResponseMock({ ok: true, status: 200, body: '{}' }))
      }
      throw new Error(`UNEXPECTED:${url}`)
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    window.localStorage.setItem('hsu-live-transport-v1', JSON.stringify({
      mode: 'relay',
      proxyTemplate: '',
    } satisfies TransportConfig))

    const { pickTransport } = await loadTransportModule()
    const transport = await pickTransport()
    expect(transport.kind).toBe('relay')
    await transport.fetchPlatform('https://www.douyu.com/betard/3168536')
  })

  it('中转错误信封映射为对应原因', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) return Promise.resolve(jsonResponseMock({ ok: true, probe: true }))
      if (url.includes('api/relay?u=')) {
        return Promise.resolve(jsonResponseMock({ ok: false, error: 'TTWID_UNAVAILABLE' }, 502))
      }
      throw new Error(`UNEXPECTED:${url}`)
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { pickTransport, PlatformRequestError } = await loadTransportModule()
    const transport = await pickTransport()
    await expect(transport.fetchPlatform('https://live.douyin.com/webcast/room/web/enter/'))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof PlatformRequestError && error.reason === 'MALFORMED_RESPONSE')
  })

  it('中转返回非 JSON 错误页时映射为通道不可用', async () => {
    // Cloudflare 免费版配额耗尽返回的 1027 错误页是 HTML，不是我们的 JSON 信封。
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) return Promise.resolve(jsonResponseMock({ ok: true, probe: true }))
      return Promise.resolve(new Response('<!doctype html><title>Error 1027</title>', {
        status: 429,
        headers: { 'content-type': 'text/html' },
      }))
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { pickTransport, PlatformRequestError } = await loadTransportModule()
    const transport = await pickTransport()
    await expect(transport.fetchPlatform('https://www.douyu.com/betard/3168536'))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof PlatformRequestError && error.reason === 'TRANSPORT_UNAVAILABLE')
  })

  it('中转信封结构异常时映射为通道不可用', async () => {
    const fetchMock = vi.fn(((input: RequestInfo) => {
      const url = String(input)
      if (url.includes('probe=1')) return Promise.resolve(jsonResponseMock({ ok: true, probe: true }))
      // 合法 JSON 但缺少 status 字段，说明中转实现异常，同样属于通道级失败。
      return Promise.resolve(jsonResponseMock({ ok: true }))
    })) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { pickTransport, PlatformRequestError } = await loadTransportModule()
    const transport = await pickTransport()
    await expect(transport.fetchPlatform('https://www.douyu.com/betard/3168536'))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof PlatformRequestError && error.reason === 'TRANSPORT_UNAVAILABLE')
  })

  it('保存配置后立即生效', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response('404', { status: 404 }))) as FetchMock
    vi.stubGlobal('fetch', fetchMock)

    const { saveTransportConfig, getTransportState } = await loadTransportModule()
    saveTransportConfig({ mode: 'proxy', proxyTemplate: 'https://proxy.example.com/' })
    expect(getTransportState().config.mode).toBe('proxy')
    expect(getTransportState().active).toBe('proxy')
    const stored = window.localStorage.getItem('hsu-live-transport-v1')
    expect(JSON.parse(stored!)).toEqual({
      mode: 'proxy',
      proxyTemplate: 'https://proxy.example.com/',
    })
  })
})
