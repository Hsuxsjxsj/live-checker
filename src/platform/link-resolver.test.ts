import { describe, expect, it } from 'vitest'

import { resolveLink, UnsupportedLinkError } from './link-resolver'
import { FakeTransport } from '../testing/fake-transport'
import { PlatformRequestError } from './transport'

const relayTransport = new FakeTransport(() => undefined)
const proxyTransport = new FakeTransport(() => undefined, { kind: 'proxy' })

describe('resolveLink', () => {
  it('解析哔哩哔哩直播间链接', async () => {
    const target = await resolveLink('https://live.bilibili.com/23058', relayTransport)
    expect(target).toEqual({
      platform: 'bilibili',
      roomId: '23058',
      roomUrl: 'https://live.bilibili.com/23058',
    })
  })

  it('解析斗鱼直播间链接', async () => {
    const target = await resolveLink('https://www.douyu.com/3168536', relayTransport)
    expect(target.platform).toBe('douyu')
    expect(target.roomId).toBe('3168536')
  })

  it('解析虎牙别名与数字房间', async () => {
    const alias = await resolveLink('https://www.huya.com/dank1ng', relayTransport)
    expect(alias.platform).toBe('huya')
    expect(alias.roomId).toBe('dank1ng')
    const numeric = await resolveLink('https://www.huya.com/10188', relayTransport)
    expect(numeric.roomId).toBe('10188')
  })

  it('解析抖音直播间链接', async () => {
    const target = await resolveLink('https://live.douyin.com/359765653648', relayTransport)
    expect(target.platform).toBe('douyin')
    expect(target.roomId).toBe('359765653648')
  })

  it('从分享文本中提取唯一链接并去除尾部标点', async () => {
    const target = await resolveLink(
      '快来看 https://live.bilibili.com/23058。',
      relayTransport,
    )
    expect(target.roomId).toBe('23058')
  })

  it('抖音房间号必须是纯数字', async () => {
    await expect(resolveLink('https://live.douyin.com/abc', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
  })

  it('拒绝多个链接、非白名单域名与协议相对地址', async () => {
    await expect(resolveLink('https://live.bilibili.com/1 https://www.douyu.com/2', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
    await expect(resolveLink('https://evil.com/123', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
    await expect(resolveLink('//live.bilibili.com/23058', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
    await expect(resolveLink('http://live.bilibili.com/23058', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
  })

  it('拒绝路径点段与带用户信息的地址', async () => {
    await expect(resolveLink('https://live.bilibili.com/../23058', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
    await expect(resolveLink('https://user@live.bilibili.com/23058', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
    await expect(resolveLink('https://live.bilibili.com/%2e%2e/23058', relayTransport))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
  })

  it('通过内置中转解析 b23.tv 短链接', async () => {
    const shortLinkTransport = new FakeTransport(() => ({ status: 200, body: '' }))
    const target = await resolveLink('https://b23.tv/abc123', shortLinkTransport)
    expect(target.platform).toBe('bilibili')
    expect(target.roomId).toBe('23058')
  })

  it('公共代理模式下短链接给出专用错误', async () => {
    await expect(resolveLink('https://b23.tv/abc123', proxyTransport))
      .rejects.toSatisfy((error: unknown) =>
        error instanceof UnsupportedLinkError
        && error.detail === 'short-link-relay-required')
  })

  it('中转请求失败时按不支持链接处理', async () => {
    const failing = new FakeTransport(() => ({ status: 502, body: 'bad gateway' }))
    await expect(resolveLink('https://b23.tv/abc123', failing))
      .rejects.toBeInstanceOf(UnsupportedLinkError)
  })

  it('PlatformRequestError RELAY_REQUIRED 会被识别', () => {
    const error = new PlatformRequestError('RELAY_REQUIRED')
    expect(error.reason).toBe('RELAY_REQUIRED')
  })
})
