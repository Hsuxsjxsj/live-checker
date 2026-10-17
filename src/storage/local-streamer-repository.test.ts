import { beforeEach, describe, expect, it } from 'vitest'

import type { CreateStreamerInput } from '../domain/types'
import { LocalStreamerRepository } from './local-streamer-repository'

const STORAGE_KEY = 'hsu-live-streamers-v1'

function input(overrides: Partial<CreateStreamerInput> = {}): CreateStreamerInput {
  return {
    platform: 'bilibili',
    roomId: '23058',
    roomUrl: 'https://live.bilibili.com/23058',
    displayName: 'B站主播',
    avatarUrl: null,
    ...overrides,
  }
}

describe('LocalStreamerRepository', () => {
  let repository: LocalStreamerRepository

  beforeEach(() => {
    window.localStorage.clear()
    repository = new LocalStreamerRepository()
  })

  it('创建并读取关注列表', async () => {
    const saved = await repository.create(input())
    expect(saved.platform).toBe('bilibili')
    expect(saved.displayName).toBe('B站主播')
    expect(saved.revision).toBe(1)
    const list = await repository.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(saved.id)
  })

  it('拒绝重复的平台与房间组合', async () => {
    await repository.create(input())
    await expect(repository.create(input({ displayName: '另一个名字' })))
      .rejects.toThrow('STREAMER_ALREADY_EXISTS')
  })

  it('校验主播名称', async () => {
    await expect(repository.create(input({ displayName: '   ' })))
      .rejects.toThrow('DISPLAY_NAME_REQUIRED')
    await expect(repository.create(input({ displayName: 'x'.repeat(81) })))
      .rejects.toThrow('DISPLAY_NAME_TOO_LONG')
  })

  it('更新记录并递增修订号', async () => {
    const saved = await repository.create(input())
    const updated = await repository.update(saved.id, { displayName: '新名字' })
    expect(updated.displayName).toBe('新名字')
    expect(updated.revision).toBe(2)
    const list = await repository.list()
    expect(list[0]!.displayName).toBe('新名字')
  })

  it('更新为已存在的房间时拒绝', async () => {
    const first = await repository.create(input())
    const second = await repository.create(input({
      platform: 'douyu',
      roomId: '3168536',
      roomUrl: 'https://www.douyu.com/3168536',
      displayName: '斗鱼主播',
    }))
    await expect(repository.update(second.id, {
      platform: 'bilibili',
      roomId: '23058',
      roomUrl: 'https://live.bilibili.com/23058',
    })).rejects.toThrow('STREAMER_ALREADY_EXISTS')
    expect(first.id).not.toBe(second.id)
  })

  it('删除记录', async () => {
    const saved = await repository.create(input())
    await repository.remove(saved.id)
    expect(await repository.list()).toHaveLength(0)
    await expect(repository.remove(saved.id)).rejects.toThrow('STREAMER_NOT_FOUND')
  })

  it('按给定顺序重排', async () => {
    const first = await repository.create(input({ displayName: '一' }))
    const second = await repository.create(input({
      platform: 'douyu',
      roomId: '3168536',
      roomUrl: 'https://www.douyu.com/3168536',
      displayName: '二',
    }))
    const reordered = await repository.reorder!([second.id, first.id])
    expect(reordered.map((streamer) => streamer.displayName)).toEqual(['二', '一'])
    const list = await repository.list()
    expect(list.map((streamer) => streamer.displayName)).toEqual(['二', '一'])
    await expect(repository.reorder!([first.id])).rejects.toThrow('REORDER_MISMATCH')
  })

  it('容忍损坏的本地存储', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    expect(await repository.list()).toEqual([])
    const saved = await repository.create(input())
    const list = await repository.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(saved.id)
  })

  it('过滤掉不符合结构的记录', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      streamers: [
        { id: 'broken', platform: 'unknown-platform', roomId: '1' },
        {
          id: 'ok',
          platform: 'huya',
          roomId: '10188',
          roomUrl: 'https://www.huya.com/10188',
          displayName: '虎牙主播',
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          revision: 1,
          schemaVersion: 1,
        },
      ],
    }))
    const list = await repository.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('ok')
  })
})
