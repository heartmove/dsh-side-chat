import { createPortal } from 'react-dom'
import css from './DropOverlay.module.css'

/** Drop-overlay strings the owner resolves from its own locale namespace. */
export interface DropOverlayLabels {
  /** Headline inviting the drop, or naming why it is unavailable. */
  title: string
  /** Limits line under the title; shown only while drops are accepted. */
  desc?: string | undefined
}

/**
 * Full-viewport invitation shown while a file drag is over the page.
 * Decoration only: `pointer-events: none` keeps drag targeting on the page
 * below, so the owner's document-level listeners keep an accurate enter/leave
 * count and own accept/reject. Rendered through a body portal for the same
 * transformed-ancestor reason as the lightbox.
 */
export function DropOverlay({ disabled, labels }: {
  disabled: boolean
  labels: DropOverlayLabels
}) {
  return createPortal(
    <div className={css.mask} role="status">
      <div className={css.wrap}>
        <div className={css.illustration} aria-hidden="true">
          {disabled ? <BlockedIllustration /> : <UploadIllustration />}
        </div>
        <div className={css.title}>{labels.title}</div>
        {!disabled && labels.desc !== undefined && <div className={css.desc}>{labels.desc}</div>}
      </div>
    </div>,
    document.body,
  )
}

/** Tilted photo-and-note cards. */
const UploadIllustration = () => (
  <svg width="96" height="72" viewBox="0 0 96 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect y="14" width="38" height="38" rx="10" transform="rotate(-22 0 14)" fill="#9ce5ed" />
    <rect x="62" y="7" width="37" height="43" rx="8" transform="rotate(17 62 7)" fill="#679efe" />
    <rect x="26" y="30" width="38" height="38" rx="10" fill="#3964fe" />
    <path
      d="M33 62c1-2 4-8 7-14 1-2 5-2 6 1 2 5 5 9 7 10 3 1 7-9 17 2"
      stroke="#fff"
      strokeWidth="3"
      fill="none"
    />
    <circle cx="53" cy="43" r="4" fill="#fff" />
  </svg>
)

/** Greyed cards with a blocked badge. */
const BlockedIllustration = () => (
  <svg width="96" height="72" viewBox="0 0 96 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect y="14" width="38" height="38" rx="10" transform="rotate(-22 0 14)" fill="#c4c9d0" />
    <rect x="62" y="7" width="37" height="43" rx="8" transform="rotate(17 62 7)" fill="#b0b6be" />
    <rect x="26" y="30" width="38" height="38" rx="10" fill="#d8dce1" />
    <circle cx="45" cy="49" r="12" stroke="#fff" strokeWidth="3" fill="none" />
    <path d="M36 40l18 18" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
  </svg>
)
