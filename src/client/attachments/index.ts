/**
 * Image presentation owned by this plugin.
 *
 * The DSH attachment UI package registers these through conversation slots and
 * exports no React components (`packages/client/AGENTS.md`: a feature plugin
 * MUST NOT runtime-import another feature plugin's values — UI crosses
 * packages through slots). A standalone side panel sits outside the
 * conversation slot tree and cannot reach those slots, so it carries its own
 * presentation, built only on `ui-primitives` (a sanctioned static owner).
 */

export { AttachmentRail } from './AttachmentRail.tsx'
export type { AttachmentRailItem, AttachmentRailLabels } from './AttachmentRail.tsx'
export { DropOverlay } from './DropOverlay.tsx'
export type { DropOverlayLabels } from './DropOverlay.tsx'
export { ImageGallery, MessageImage } from './MessageImage.tsx'
export type { ImageLoader, MessageImageLabels } from './MessageImage.tsx'
export { ImageLightbox } from './ImageLightbox.tsx'
export type { ImageLightboxLabels } from './ImageLightbox.tsx'
