import { describe, expect, it } from 'vitest'

import {
  bilibiliAdapter,
  bilibiliRoomPayload,
  douyinAdapter,
  douyinRoomPayload,
  douyuAdapter,
  douyuBetardPayload,
  huyaAdapter,
  huyaProfileRoomPayload,
  makeBilibiliTransport,
  makeDouyinTransport,
  makeDouyuTransport,
  makeHuyaTransport,
} from './adapters.fixtures'

describe('bilibili adapter', () => {
  it('识别直播中状态并优先使用关键帧封面', async () => {
    const transport = makeBilibiliTransport(bilibiliRoomPayload({ live_status: 1 }))
    const status = await bilibiliAdapter.inspect('23058', { transport })
    expect(status).toMatchObject({
      kind: 'live',
      title: '直播标题',
      startedAt: null,
    })
    if (status.kind !== 'live') throw new Error('UNREACHABLE')
    expect(status.media).toEqual({
      streamerName: 'B站主播',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/face.jpg',
      coverUrl: 'https://i0.hdslb.com/bfs/live/keyframe.jpg',
    })
  })

  it('识别离线状态并使用封面图', async () => {
    const transport = makeBilibiliTransport(bilibiliRoomPayload({ live_status: 0 }))
    const status = await bilibiliAdapter.inspect('23058', { transport })
    expect(status.kind).toBe('offline')
    if (status.kind !== 'offline') throw new Error('UNREACHABLE')
    expect(status.media.coverUrl).toBe('https://i0.hdslb.com/bfs/live/cover.jpg')
  })

  it('平台错误码与异常响应映射为 unknown', async () => {
    const errorTransport = makeBilibiliTransport(bilibiliRoomPayload({ code: 1 }))
    expect(await bilibiliAdapter.inspect('23058', { transport: errorTransport }))
      .toMatchObject({ kind: 'unknown', reason: 'PLATFORM_ERROR' })

    const malformed = makeBilibiliTransport({ status: 200, body: '{oops' })
    expect(await bilibiliAdapter.inspect('23058', { transport: malformed }))
      .toMatchObject({ kind: 'unknown', reason: 'MALFORMED_RESPONSE' })

    const denied = makeBilibiliTransport({ status: 403, body: '' })
    expect(await bilibiliAdapter.inspect('23058', { transport: denied }))
      .toMatchObject({ kind: 'unknown', reason: 'ACCESS_DENIED' })

    // B站风控对机房 IP 返回 412，应归为平台限制访问而非平台服务异常。
    const banned = makeBilibiliTransport({
      status: 412,
      body: '{"code":-412,"message":"request was banned"}',
    })
    expect(await bilibiliAdapter.inspect('23058', { transport: banned }))
      .toMatchObject({ kind: 'unknown', reason: 'ACCESS_DENIED' })

    const limited = makeBilibiliTransport({ status: 429, body: '' })
    expect(await bilibiliAdapter.inspect('23058', { transport: limited }))
      .toMatchObject({ kind: 'unknown', reason: 'RATE_LIMITED' })
  })

  it('describe 返回规范房间号与主播信息', async () => {
    const transport = makeBilibiliTransport(bilibiliRoomPayload({ live_status: 1 }))
    const metadata = await bilibiliAdapter.describe('23058', { transport })
    expect(metadata).toEqual({
      canonicalRoomId: '23058',
      roomUrl: 'https://live.bilibili.com/23058',
      streamerName: 'B站主播',
      avatarUrl: 'https://i0.hdslb.com/bfs/face/face.jpg',
    })
  })
})

describe('douyu adapter', () => {
  it('识别直播、轮播与离线状态', async () => {
    const live = makeDouyuTransport(douyuBetardPayload({ show_status: 1, videoLoop: 0 }))
    expect(await douyuAdapter.inspect('3168536', { transport: live }))
      .toMatchObject({ kind: 'live', title: '斗鱼标题' })

    const looping = makeDouyuTransport(douyuBetardPayload({ show_status: 1, videoLoop: 1 }))
    expect(await douyuAdapter.inspect('3168536', { transport: looping }))
      .toMatchObject({ kind: 'looping', title: '斗鱼标题' })

    const offline = makeDouyuTransport(douyuBetardPayload({ show_status: 2, videoLoop: 0 }))
    const offlineStatus = await douyuAdapter.inspect('3168536', { transport: offline })
    expect(offlineStatus.kind).toBe('offline')
    if (offlineStatus.kind !== 'offline') throw new Error('UNREACHABLE')
    expect(offlineStatus.media).toEqual({
      streamerName: '斗鱼主播',
      avatarUrl: 'https://apic.douyucdn.cn/upload/middle.jpg',
      coverUrl: 'https://rpic.douyucdn.cn/room_pic.jpg',
    })
  })

  it('头像字段支持对象形式并按 middle > big > small 取值', async () => {
    const transport = makeDouyuTransport(douyuBetardPayload({
      show_status: 2,
      videoLoop: 0,
      avatar: { big: 'https://apic.douyucdn.cn/upload/big.jpg' },
    }))
    const status = await douyuAdapter.inspect('3168536', { transport })
    if (status.kind !== 'offline') throw new Error('UNREACHABLE')
    expect(status.media.avatarUrl).toBe('https://apic.douyucdn.cn/upload/big.jpg')
  })

  it('describe 在 betard 异常时回退到移动页解析', async () => {
    const transport = makeDouyuTransport(douyuBetardPayload({ malformed: true }))
    const metadata = await douyuAdapter.describe('alias-room', { transport })
    expect(metadata).toEqual({
      canonicalRoomId: '3168536',
      roomUrl: 'https://www.douyu.com/3168536',
      streamerName: '斗鱼别名主播',
      avatarUrl: 'https://apic.douyucdn.cn/upload/alias.jpg',
    })
  })
})

describe('huya adapter', () => {
  it('识别直播、轮播与离线状态', async () => {
    const live = makeHuyaTransport(huyaProfileRoomPayload({ liveStatus: 'ON', realLiveStatus: 'ON' }))
    expect(await huyaAdapter.inspect('10188', { transport: live }))
      .toMatchObject({ kind: 'live', title: '虎牙标题' })

    const looping = makeHuyaTransport(huyaProfileRoomPayload({ liveStatus: 'REPLAY', realLiveStatus: 'REPLAY' }))
    expect(await huyaAdapter.inspect('10188', { transport: looping }))
      .toMatchObject({ kind: 'looping', title: '虎牙标题' })

    const offline = makeHuyaTransport(huyaProfileRoomPayload({ liveStatus: 'OFF', realLiveStatus: 'OFF' }))
    const offlineStatus = await huyaAdapter.inspect('10188', { transport: offline })
    expect(offlineStatus.kind).toBe('offline')
    if (offlineStatus.kind !== 'offline') throw new Error('UNREACHABLE')
    expect(offlineStatus.media).toEqual({
      streamerName: '虎牙主播',
      avatarUrl: 'https://a.msstatic.com/huya/avatar180.jpg',
      coverUrl: 'https://huya.com/screenshot.jpg',
    })
  })

  it('别名房间先解析规范房间号再检测', async () => {
    const transport = makeHuyaTransport(huyaProfileRoomPayload({ liveStatus: 'ON', realLiveStatus: 'ON' }))
    const status = await huyaAdapter.inspect('dank1ng', { transport })
    expect(status.kind).toBe('live')
    expect(transport.requestedUrls).toContain('https://www.huya.com/dank1ng')
    expect(transport.requestedUrls).toContain(
      'https://mp.huya.com/cache.php?m=Live&do=profileRoom&roomid=10188',
    )
  })

  it('协议相对头像地址会补全为 https', async () => {
    const transport = makeHuyaTransport(huyaProfileRoomPayload({
      liveStatus: 'OFF',
      realLiveStatus: 'OFF',
      avatar180: '//a.msstatic.com/huya/avatar180.jpg',
    }))
    const status = await huyaAdapter.inspect('10188', { transport })
    if (status.kind !== 'offline') throw new Error('UNREACHABLE')
    expect(status.media.avatarUrl).toBe('https://a.msstatic.com/huya/avatar180.jpg')
  })
})

describe('douyin adapter', () => {
  it('公共代理模式下返回 RELAY_REQUIRED', async () => {
    const transport = makeDouyinTransport(douyinRoomPayload({ status: 2 }), 'proxy')
    expect(await douyinAdapter.inspect('359765653648', { transport }))
      .toMatchObject({ kind: 'unknown', reason: 'RELAY_REQUIRED' })
  })

  it('识别直播与离线状态并过滤非 https 媒体地址', async () => {
    const live = makeDouyinTransport(douyinRoomPayload({ status: 2 }))
    const liveStatus = await douyinAdapter.inspect('359765653648', { transport: live })
    expect(liveStatus).toMatchObject({ kind: 'live', title: '抖音标题' })
    if (liveStatus.kind !== 'live') throw new Error('UNREACHABLE')
    expect(liveStatus.media).toEqual({
      streamerName: '抖音主播',
      avatarUrl: 'https://p3-webcast.douyinpic.com/avatar.jpg',
      coverUrl: 'https://p3-webcast.douyinpic.com/cover.jpg',
    })

    const offline = makeDouyinTransport(douyinRoomPayload({ status: 4 }))
    expect(await douyinAdapter.inspect('359765653648', { transport: offline }))
      .toMatchObject({ kind: 'offline' })
  })

  it('非零 status_code 映射为 PLATFORM_ERROR', async () => {
    const transport = makeDouyinTransport(douyinRoomPayload({ status_code: 400 }))
    expect(await douyinAdapter.inspect('359765653648', { transport }))
      .toMatchObject({ kind: 'unknown', reason: 'PLATFORM_ERROR' })
  })

  it('房间号必须是纯数字', async () => {
    const transport = makeDouyinTransport(douyinRoomPayload({ status: 2 }))
    expect(await douyinAdapter.inspect('abc', { transport }))
      .toMatchObject({ kind: 'unknown', reason: 'MALFORMED_RESPONSE' })
  })
})
