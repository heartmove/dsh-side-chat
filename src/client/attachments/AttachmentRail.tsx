import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  IconChevronLeftOutline14,
  IconChevronRightOutline14,
  IconCloseFill14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AttachmentRail.module.css'

/** One rail thumbnail; strings arrive resolved (zero-cordis atom). */
export interface AttachmentRailItem {
  /** Stable identity for the React key. */
  id: string
  /** Object or data URL rendered as the thumbnail. */
  previewUrl: string
  /** Image alt text (display name with the owner's fallback applied). */
  alt: string
  /** Accessible label of the item's remove control. */
  removeLabel: string
}

/** Rail-level strings the owner resolves from its own locale namespace. */
export interface AttachmentRailLabels {
  /** Accessible name of the rail group. */
  group: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible label of the left paging arrow. */
  scrollLeft: string
  /** Accessible label of the right paging arrow. */
  scrollRight: string
}

/** Approximate pixels per wheel step for `deltaMode` LINE deltas (Firefox notch wheels report lines). */
const WHEEL_LINE_PX = 16

/** Smooth paging unless the user asked for reduced motion. */
function pageBehavior(): ScrollBehavior {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/**
 * Horizontal thumbnail rail over the caller's draft attachments.
 *
 * The rail scrolls with its scrollbar hidden; overflow is announced by edge
 * arrows recomputed from scroll geometry on scroll, item-count changes, and
 * rail size changes (a ResizeObserver on the rail element, so sidebar or panel
 * resizes count, not only window resizes). A vertical wheel pans the rail
 * horizontally and is consumed exclusively, a newly added item is revealed at
 * the rail's end, and each thumbnail opens on a single click while its remove
 * control sits inside the card. The owner decides mounting.
 */
export function AttachmentRail<T extends AttachmentRailItem>({ items, labels, onOpen, onRemove }: {
  items: readonly T[]
  labels: AttachmentRailLabels
  onOpen: (item: T) => void
  onRemove: (item: T) => void
}) {
  const railRef = useRef<HTMLDivElement | null>(null)
  // null marks the first layout pass: a rail that MOUNTS over an existing
  // draft is initial display, not growth, and must not jump to the end.
  const countRef = useRef<number | null>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const updateEdges = useCallback(() => {
    const el = railRef.current
    if (el === null) return
    // 1px slack: engines report fractional scroll positions at the edges.
    const left = el.scrollLeft > 1
    const right = el.scrollLeft < el.scrollWidth - el.clientWidth - 1
    setEdges(prev => prev.left === left && prev.right === right ? prev : { left, right })
  }, [])
  useLayoutEffect(() => {
    const grew = countRef.current !== null && items.length > countRef.current
    countRef.current = items.length
    const el = railRef.current
    if (el === null) return
    // A newly added attachment lands at the rail's end: reveal it.
    if (grew) el.scrollLeft = el.scrollWidth - el.clientWidth
    updateEdges()
  }, [items.length, updateEdges])
  useEffect(() => {
    const el = railRef.current
    if (el === null) return
    // The rail's width follows the composer, which resizes with sidebars and
    // panels, not only the window — observe the element itself.
    let disconnect = (): void => {}
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateEdges)
      observer.observe(el)
      disconnect = () => { observer.disconnect() }
    }
    // The rail scrolls horizontally ONLY: any wheel tick with a vertical
    // component is consumed — without preventDefault it would also scroll the
    // conversation behind the composer, and React's root wheel listener is
    // passive, so the exclusion needs this manually attached non-passive
    // listener.
    const onWheel = (event: globalThis.WheelEvent): void => {
      if (event.deltaY === 0) return
      const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? el.clientWidth : 1
      event.preventDefault()
      el.scrollBy({
        left: event.deltaX !== 0
          ? event.deltaX * scale
          : Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * scale, 60),
        behavior: 'auto',
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [updateEdges])
  const page = (direction: -1 | 1): void => {
    const el = railRef.current
    if (el === null) return
    // One viewport minus a card keeps the last visible thumbnail as context.
    el.scrollBy({ left: direction * Math.max(el.clientWidth - 64, 200), behavior: pageBehavior() })
  }
  return (
    <div className={css.root}>
      {edges.left && (
        <button
          type="button"
          className={`${css.arrow} ${css.arrowLeft}`}
          aria-label={labels.scrollLeft}
          onClick={() => { page(-1) }}
        >
          <IconChevronLeftOutline14 />
        </button>
      )}
      <div
        ref={railRef}
        className={css.rail}
        role="group"
        aria-label={labels.group}
        onScroll={updateEdges}
      >
        {items.map(item => (
          <div key={item.id} className={css.item}>
            <button
              type="button"
              className={css.thumbnail}
              title={labels.open}
              onClick={() => { onOpen(item) }}
            >
              <img src={item.previewUrl} alt={item.alt} />
            </button>
            <button
              type="button"
              className={css.remove}
              aria-label={item.removeLabel}
              onClick={() => { onRemove(item) }}
            >
              <IconCloseFill14 size={12} />
            </button>
          </div>
        ))}
      </div>
      {edges.right && (
        <button
          type="button"
          className={`${css.arrow} ${css.arrowRight}`}
          aria-label={labels.scrollRight}
          onClick={() => { page(1) }}
        >
          <IconChevronRightOutline14 />
        </button>
      )}
    </div>
  )
}
