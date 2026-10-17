import { ArrowDown, ArrowUp } from 'lucide-react'

export function OrderControls({
  name, canMoveUp, canMoveDown, disabled, onMoveUp, onMoveDown,
}: {
  name: string
  canMoveUp: boolean
  canMoveDown: boolean
  disabled: boolean
  onMoveUp(): void
  onMoveDown(): void
}) {
  return (
    <div className="order-controls" aria-label={`调整 ${name} 排序`}>
      <button type="button" aria-label={`上移 ${name}`} title="上移"
        disabled={disabled || !canMoveUp} onClick={onMoveUp}>
        <ArrowUp aria-hidden="true" size={15} />
      </button>
      <button type="button" aria-label={`下移 ${name}`} title="下移"
        disabled={disabled || !canMoveDown} onClick={onMoveDown}>
        <ArrowDown aria-hidden="true" size={15} />
      </button>
    </div>
  )
}
