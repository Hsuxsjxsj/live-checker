import { Check, Plus, Search } from 'lucide-react'
import type { Ref } from 'react'

import type {
  BoardCounts,
  BoardFilters,
  BoardStatusFilter,
} from './board-types'

export interface BoardToolbarProps {
  value: BoardFilters
  counts: BoardCounts
  onChange: (value: BoardFilters) => void
  onAddStreamer?: () => void
  addButtonRef?: Ref<HTMLButtonElement>
}

const FILTERS: Array<{
  value: BoardStatusFilter
  label: string
  ariaLabel: string
}> = [
  { value: 'all', label: '全部', ariaLabel: '查看全部主播' },
  { value: 'live', label: '直播中', ariaLabel: '只看直播中' },
  { value: 'looping', label: '轮播中', ariaLabel: '只看轮播中' },
  { value: 'unknown', label: '需确认', ariaLabel: '只看需确认' },
  { value: 'offline', label: '离线', ariaLabel: '只看离线' },
]

export function BoardToolbar({
  value,
  counts,
  onChange,
  onAddStreamer,
  addButtonRef,
}: BoardToolbarProps) {
  return (
    <div className="board-toolbar" role="region" aria-label="主播筛选工具">
      <div className="toolbar-search-row">
        <label className="search-control">
          <span className="toolbar-label">搜索主播</span>
          <span className="search-input-wrap">
            <Search aria-hidden="true" size={17} strokeWidth={1.8} />
            <input
              type="search"
              value={value.query}
              placeholder="输入主播名称"
              onChange={(event) => onChange({
                ...value,
                query: event.currentTarget.value,
              })}
            />
          </span>
        </label>
        {onAddStreamer === undefined ? null : (
          <button
            ref={addButtonRef}
            type="button"
            className="primary-button toolbar-add-button"
            onClick={onAddStreamer}
          >
            <Plus aria-hidden="true" size={17} />
            添加主播
          </button>
        )}
      </div>

      <div className="filter-strip" aria-label="按直播状态筛选">
        {FILTERS.map((filter) => {
          const selected = value.status === filter.value
          return (
            <button
              key={filter.value}
              type="button"
              className="filter-button"
              aria-label={filter.ariaLabel}
              aria-pressed={selected}
              onClick={() => onChange({ ...value, status: filter.value })}
            >
              {selected ? (
                <Check aria-hidden="true" size={15} strokeWidth={1.8} />
              ) : null}
              <span className="filter-label">{filter.label}</span>
              <span className="filter-count">{counts[filter.value]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
