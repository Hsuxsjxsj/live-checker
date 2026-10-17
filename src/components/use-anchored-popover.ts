import type { CSSProperties, RefObject } from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

const VIEWPORT_PADDING = 16
const ANCHOR_GAP = 8
const MOBILE_BREAKPOINT = 767

interface PopoverGeometry {
  anchor: Pick<DOMRect, 'top' | 'right' | 'bottom'>
  width: number
  height: number
  viewportWidth: number
  viewportHeight: number
  topInset: number
}

/** Prefer below the trigger, flip above when possible, otherwise keep the surface reachable. */
export function calculatePopoverPosition({
  anchor, width, height, viewportWidth, viewportHeight, topInset,
}: PopoverGeometry) {
  const minTop = topInset + VIEWPORT_PADDING
  const maxHeight = Math.max(1, viewportHeight - minTop - VIEWPORT_PADDING)
  const visibleHeight = Math.min(height, maxHeight)
  const below = anchor.bottom + ANCHOR_GAP
  const above = anchor.top - ANCHOR_GAP - visibleHeight
  const preferredTop = below + visibleHeight > viewportHeight - VIEWPORT_PADDING
    && above >= minTop ? above : below
  const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - VIEWPORT_PADDING - width)
  return {
    left: Math.max(VIEWPORT_PADDING, Math.min(anchor.right - width, maxLeft)),
    top: Math.max(minTop, Math.min(preferredTop, viewportHeight - VIEWPORT_PADDING - visibleHeight)),
    maxHeight,
  }
}

/** Mobile positioning stays in CSS; desktop popovers track their anchor and viewport edges. */
export function useAnchoredPopover(
  anchorRef: RefObject<HTMLElement | null>, open: boolean, contentKey: string,
) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>()

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }
    const anchor = anchorRef.current
    const popover = popoverRef.current
    if (anchor === null || popover === null) return

    function reposition() {
      if (anchor === null || popover === null) return
      if (window.innerWidth <= MOBILE_BREAKPOINT) {
        setStyle(undefined)
        return
      }
      const bounds = popover.getBoundingClientRect()
      const header = document.querySelector('.app-header')?.getBoundingClientRect()
      const position = calculatePopoverPosition({
        anchor: anchor.getBoundingClientRect(),
        width: bounds.width,
        height: popover.scrollHeight + bounds.height - popover.clientHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        topInset: Math.max(0, header?.bottom ?? 0),
      })
      setStyle((current) => current?.left === position.left && current.top === position.top
        && current.maxHeight === position.maxHeight ? current : {
          position: 'fixed', right: 'auto', ...position,
        })
    }

    reposition()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition)
    observer?.observe(anchor)
    observer?.observe(popover)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [anchorRef, open, contentKey])

  return { popoverRef, popoverStyle: style }
}
