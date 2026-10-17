import { afterEach, describe, expect, it, vi } from 'vitest'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
}

interface FakeResponseInit {
  status?: number
  url?: string
  body?: string
  setCookies?: string[]
}

function fakeResponse(init: FakeResponseInit = {}): Response {
  const setCookies = init.setCookies ?? []
  return {
    status: init.status ?? 200,
    url: init.url ?? '',
    body: null,
    text: () => Promise.resolve(init.body ?? ''),
    json: () => Promise.resolve(JSON.parse(init.body ?? 'null')),
    headers: {
      get: (name: string) => (name.toLowerCase() === 'set-cookie' ? setCookies[0] ?? null : null),
      getSetCookie: () => setCookies,
    },
  } as unknown as Response
}

/** 用桩 fetch 捕获出站请求，从而断言中转真正发送的请求头。 */
function stubFetch(handler: (request: CapturedRequest) => Response): CapturedRequest[] {
  const captured: CapturedRequest[] = []
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value)
    }
    const request: CapturedRequest = { url, method: (init?.method ?? 'GET').toUpperCase(), headers }
    captured.push(request)
    return Promise.resolve(handler(request))
  })
  return captured
}

/**
 * 模块内缓存了 ttwid 与 buvid 指纹，测试之间必须重置模块，
 * 否则先执行的用例会污染后续用例（缓存命中后不再请求上游）。
 */
async function freshRelay() {
  vi.resetModules()
  const module = await import('./relay-core')
  return module.relayRequest
}

const FINGERPRINT_PATH = '/x/frontend/finger/spi'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('relayRequest 白名单', () => {
  it('拒绝白名单之外的域名', async () => {
    const relayRequest = await freshRelay()

    expect(await relayRequest('https://evil.example.com/steal')).toEqual({
      ok: false,
      error: 'INVALID_URL',
    })
  })

  it('拒绝非 https 地址', async () => {
    const relayRequest = await freshRelay()

    expect(await relayRequest('http://api.live.bilibili.com/room/v1/Room/get_info')).toEqual({
      ok: false,
      error: 'INVALID_URL',
    })
  })

  it('拒绝带端口或凭据的地址', async () => {
    const relayRequest = await freshRelay()

    expect(await relayRequest('https://api.live.bilibili.com:8443/x')).toEqual({
      ok: false,
      error: 'INVALID_URL',
    })
    expect(await relayRequest('https://user:pass@api.live.bilibili.com/x')).toEqual({
      ok: false,
      error: 'INVALID_URL',
    })
  })

  it('缺少 url 参数时返回 MISSING_URL', async () => {
    const relayRequest = await freshRelay()

    expect(await relayRequest(null)).toEqual({ ok: false, error: 'MISSING_URL' })
    expect(await relayRequest('')).toEqual({ ok: false, error: 'MISSING_URL' })
  })
})

describe('relayRequest 平台请求', () => {
  it('设备指纹接口不可用时，仍然照常发起 B 站请求（不阻断检测）', async () => {
    const relayRequest = await freshRelay()
    const captured = stubFetch((request) => {
      if (request.url.includes(FINGERPRINT_PATH)) return fakeResponse({ status: 500 })
      return fakeResponse({ status: 200, body: '{"code":0}' })
    })

    const outcome = await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=1')

    expect(captured).toHaveLength(2)
    expect(captured[1]?.headers.cookie).toBeUndefined()
    expect(outcome).toEqual({ ok: true, status: 200, body: '{"code":0}' })
  })

  it('B 站请求先取 buvid 指纹，并携带完整浏览器请求头', async () => {
    const relayRequest = await freshRelay()
    const captured = stubFetch((request) => {
      if (request.url.includes(FINGERPRINT_PATH)) {
        return fakeResponse({
          status: 200,
          body: JSON.stringify({ code: 0, data: { b_3: 'B3VALUE', b_4: 'B4VALUE' } }),
        })
      }
      return fakeResponse({ status: 200, body: '{"code":0,"data":{"live_status":1}}' })
    })

    const outcome = await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=23058')

    expect(captured).toHaveLength(2)
    expect(captured[0]?.url).toContain(FINGERPRINT_PATH)

    const apiRequest = captured[1]
    expect(apiRequest?.headers.cookie).toBe('buvid3=B3VALUE; buvid4=B4VALUE')
    expect(apiRequest?.headers['user-agent']).toContain('Chrome/')
    expect(apiRequest?.headers.referer).toBe('https://live.bilibili.com/')
    // 带 Origin 会被 B 站以 403 拒绝，因此必须确保没有该请求头。
    expect(apiRequest?.headers.origin).toBeUndefined()

    expect(outcome).toEqual({ ok: true, status: 200, body: '{"code":0,"data":{"live_status":1}}' })
  })

  it('B 站指纹会被缓存，短时间内不重复请求', async () => {
    const relayRequest = await freshRelay()
    let fingerprintCalls = 0
    const captured = stubFetch((request) => {
      if (request.url.includes(FINGERPRINT_PATH)) {
        fingerprintCalls += 1
        return fakeResponse({ status: 200, body: JSON.stringify({ data: { b_3: 'CACHED' } }) })
      }
      return fakeResponse({ status: 200, body: '{"code":0}' })
    })

    await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=2')
    await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=3')

    expect(fingerprintCalls).toBe(1)
    expect(captured).toHaveLength(3)
    expect(captured[2]?.headers.cookie).toBe('buvid3=CACHED')
  })

  it('B 站指纹请求失败也会被缓存，不重复白跑', async () => {
    const relayRequest = await freshRelay()
    let fingerprintCalls = 0
    stubFetch((request) => {
      if (request.url.includes(FINGERPRINT_PATH)) {
        fingerprintCalls += 1
        return fakeResponse({ status: 412, body: '{"code":-412}' })
      }
      return fakeResponse({ status: 412, body: '{"code":-412}' })
    })

    await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=4')
    await relayRequest('https://api.live.bilibili.com/room/v1/Room/get_info?room_id=5')

    expect(fingerprintCalls).toBe(1)
  })

  it('抖音直播间请求会先取 ttwid 并携带 Cookie', async () => {
    const relayRequest = await freshRelay()
    const captured = stubFetch((request) => {
      if (request.method === 'HEAD') {
        return fakeResponse({ status: 200, setCookies: ['ttwid=TT123; path=/;'] })
      }
      return fakeResponse({ status: 200, body: '{"status_code":0}' })
    })

    const outcome = await relayRequest('https://live.douyin.com/webcast/room/web/enter/?web_rid=1')

    expect(captured.map((request) => request.method)).toEqual(['HEAD', 'GET'])
    expect(captured[1]?.headers.cookie).toBe('ttwid=TT123')
    expect(outcome).toEqual({ ok: true, status: 200, body: '{"status_code":0}' })
  })

  it('取不到 ttwid 时返回 TTWID_UNAVAILABLE', async () => {
    const relayRequest = await freshRelay()
    stubFetch((request) =>
      request.method === 'HEAD'
        ? fakeResponse({ status: 200, setCookies: [] })
        : fakeResponse({ status: 200, body: '{}' }),
    )

    expect(await relayRequest('https://live.douyin.com/webcast/room/web/enter/?web_rid=1')).toEqual({
      ok: false,
      error: 'TTWID_UNAVAILABLE',
    })
  })

  it('抖音非直播间路径被拒绝', async () => {
    const relayRequest = await freshRelay()

    expect(await relayRequest('https://live.douyin.com/359765653648')).toEqual({
      ok: false,
      error: 'DISALLOWED_TARGET',
    })
  })

  it('响应体超过上限时返回 PAYLOAD_TOO_LARGE', async () => {
    const relayRequest = await freshRelay()
    stubFetch(() => fakeResponse({ status: 200, body: 'x'.repeat(4_000_001) }))

    expect(await relayRequest('https://www.douyu.com/betard/1')).toEqual({
      ok: false,
      error: 'PAYLOAD_TOO_LARGE',
    })
  })

  it('上游抛错时返回 UPSTREAM_ERROR', async () => {
    const relayRequest = await freshRelay()
    vi.stubGlobal('fetch', () => Promise.reject(new Error('boom')))

    expect(await relayRequest('https://www.douyu.com/betard/1')).toEqual({
      ok: false,
      error: 'UPSTREAM_ERROR',
    })
  })
})

describe('relayRequest 短链接解析', () => {
  it('b23.tv 跳到直播间网页地址时返回最终地址', async () => {
    const relayRequest = await freshRelay()
    stubFetch(() => fakeResponse({ status: 200, url: 'https://live.bilibili.com/23058?broadcast_type=0' }))

    expect(await relayRequest('https://b23.tv/AbCdEfG')).toEqual({
      ok: true,
      status: 200,
      location: 'https://live.bilibili.com/23058?broadcast_type=0',
    })
  })

  it('b23.tv 跳到视频页时也返回最终地址', async () => {
    const relayRequest = await freshRelay()
    stubFetch(() => fakeResponse({ status: 200, url: 'https://www.bilibili.com/video/BV1xx411c7mD' }))

    expect(await relayRequest('https://b23.tv/AbCdEfG')).toEqual({
      ok: true,
      status: 200,
      location: 'https://www.bilibili.com/video/BV1xx411c7mD',
    })
  })

  it('跳到非平台地址时拒绝返回', async () => {
    const relayRequest = await freshRelay()
    stubFetch(() => fakeResponse({ status: 200, url: 'https://evil.example.com/phish' }))

    expect(await relayRequest('https://b23.tv/AbCdEfG')).toEqual({ ok: false, error: 'UPSTREAM_ERROR' })
  })

  it('没有发生跳转时返回 UPSTREAM_ERROR', async () => {
    const relayRequest = await freshRelay()
    stubFetch(() => fakeResponse({ status: 200, url: '' }))

    expect(await relayRequest('https://b23.tv/AbCdEfG')).toEqual({ ok: false, error: 'UPSTREAM_ERROR' })
  })
})
