import { FakeTransport, jsonResponse } from '../testing/fake-transport'
import { PLATFORM_ADAPTERS } from './adapters'

export const bilibiliAdapter = PLATFORM_ADAPTERS.get('bilibili')!
export const douyuAdapter = PLATFORM_ADAPTERS.get('douyu')!
export const huyaAdapter = PLATFORM_ADAPTERS.get('huya')!
export const douyinAdapter = PLATFORM_ADAPTERS.get('douyin')!

export interface BilibiliFixtureOverrides {
  code?: number
  live_status?: number
}

export function bilibiliRoomPayload(overrides: BilibiliFixtureOverrides = {}) {
  return jsonResponse({
    code: overrides.code ?? 0,
    data: {
      live_status: overrides.live_status ?? 1,
      room_id: 23058,
      title: '直播标题',
      user_cover: 'https://i0.hdslb.com/bfs/live/cover.jpg',
      keyframe: 'https://i0.hdslb.com/bfs/live/keyframe.jpg',
    },
  })
}

const BILIBILI_ANCHOR_PAYLOAD = jsonResponse({
  code: 0,
  data: { info: { uname: 'B站主播', face: 'https://i0.hdslb.com/bfs/face/face.jpg' } },
})

export function makeBilibiliTransport(roomResponse: { status: number; body: string }) {
  return new FakeTransport((url) => {
    if (url.startsWith('https://api.live.bilibili.com/room/v1/Room/get_info')) {
      return roomResponse
    }
    if (url.startsWith('https://api.live.bilibili.com/live_user/v1/UserInfo/get_anchor_in_room')) {
      return BILIBILI_ANCHOR_PAYLOAD
    }
    return undefined
  })
}

export interface DouyuFixtureOverrides {
  show_status?: number
  videoLoop?: number
  malformed?: boolean
  avatar?: unknown
}

export function douyuBetardPayload(overrides: DouyuFixtureOverrides = {}) {
  if (overrides.malformed) return jsonResponse({ unexpected: true })
  return jsonResponse({
    room: {
      room_id: 3168536,
      show_status: overrides.show_status ?? 1,
      videoLoop: overrides.videoLoop ?? 0,
      room_name: '斗鱼标题',
      nickname: '斗鱼主播',
      avatar: overrides.avatar ?? 'https://apic.douyucdn.cn/upload/middle.jpg',
      room_pic: 'https://rpic.douyucdn.cn/room_pic.jpg',
    },
  })
}

const DOUYU_ALIAS_HTML = {
  status: 200,
  body: `<html><body>
    <script id="vike_pageContext" type="application/json">${
      JSON.stringify({
        pageProps: {
          room: {
            roomInfo: {
              roomInfo: {
                rid: 3168536,
                nickname: '斗鱼别名主播',
                avatar: 'https://apic.douyucdn.cn/upload/alias.jpg',
              },
            },
          },
        },
      })
    }</script>
  </body></html>`,
}

export function makeDouyuTransport(betardResponse: { status: number; body: string }) {
  return new FakeTransport((url) => {
    if (url.startsWith('https://www.douyu.com/betard/')) {
      return betardResponse
    }
    if (url.startsWith('https://m.douyu.com/')) {
      return DOUYU_ALIAS_HTML
    }
    return undefined
  })
}

export interface HuyaFixtureOverrides {
  liveStatus?: string
  realLiveStatus?: string
  avatar180?: string
}

export function huyaProfileRoomPayload(overrides: HuyaFixtureOverrides = {}) {
  return jsonResponse({
    status: 200,
    data: {
      liveStatus: overrides.liveStatus ?? 'ON',
      realLiveStatus: overrides.realLiveStatus ?? 'ON',
      profileInfo: {
        nick: '虎牙主播',
        avatar180: overrides.avatar180 ?? 'https://a.msstatic.com/huya/avatar180.jpg',
      },
      liveData: {
        introduction: '虎牙标题',
        screenshot: 'https://huya.com/screenshot.jpg',
      },
    },
  })
}

const HUYA_ALIAS_HTML = {
  status: 200,
  body: '<html><head><link rel="canonical" href="https://www.huya.com/10188"></head><body></body></html>',
}

export function makeHuyaTransport(profileResponse: { status: number; body: string }) {
  return new FakeTransport((url) => {
    if (url.startsWith('https://mp.huya.com/cache.php')) {
      return profileResponse
    }
    if (url.startsWith('https://www.huya.com/')) {
      return HUYA_ALIAS_HTML
    }
    return undefined
  })
}

export interface DouyinFixtureOverrides {
  status?: number
  status_code?: number
}

export function douyinRoomPayload(overrides: DouyinFixtureOverrides = {}) {
  return jsonResponse({
    status_code: overrides.status_code ?? 0,
    data: {
      data: [{
        status: overrides.status ?? 2,
        title: '抖音标题',
        owner: {
          nickname: '抖音主播',
          avatar_thumb: { url_list: ['http://insecure.example.com/x.jpg', 'https://p3-webcast.douyinpic.com/avatar.jpg'] },
        },
        cover: { url_list: ['https://p3-webcast.douyinpic.com/cover.jpg'] },
      }],
    },
  })
}

export function makeDouyinTransport(
  roomResponse: { status: number; body: string },
  kind: 'relay' | 'proxy' = 'relay',
) {
  return new FakeTransport((url) => {
    if (url.startsWith('https://live.douyin.com/webcast/room/web/enter/')) {
      return roomResponse
    }
    return undefined
  }, { kind })
}
