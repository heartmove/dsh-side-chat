import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SidechatImageRef } from '../api.ts'
import { ImageLightbox } from './ImageLightbox.tsx'
import type { ImageLightboxLabels } from './ImageLightbox.tsx'
import css from './MessageImage.module.css'

/** Loads one durable image's bytes into a displayable URL. */
export type ImageLoader = (ref: SidechatImageRef) => Promise<string>

/** Message-image strings the owner resolves from its own locale namespace. */
export interface MessageImageLabels {
  /** Fallback display name for an unnamed image. */
  image: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible thumbnail label; receives the image's display name. */
  openNamed: (label: string) => string
  /** Loading placeholder shown until bytes resolve. */
  loading: string
  /** Retry-control label shown when the load fails. */
  loadFailed: string
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

/** Display box for a lone image: long edge 240px with the rendered aspect
 * ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(
  dimensions: { readonly width: number; readonly height: number },
): { width: number; height: number; objectPosition: string } {
  const natural = dimensions.width / dimensions.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, dimensions.width / box.width, dimensions.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile.
 */
export function MessageImage({ image, load, variant, labels }: {
  image: SidechatImageRef
  load: ImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
}) {
  const [loaded, setLoaded] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [open, setOpen] = useState(false)
  // Retry re-arms the one load effect below, so every attempt — first load or
  // retry — runs under the same liveness guard and the same reset.
  const [attempt, setAttempt] = useState(0)
  const request = useCallback(() => { setAttempt(a => a + 1) }, [])
  const close = useCallback(() => { setOpen(false) }, [])
  const label = image.name === undefined || image.name === '' ? labels.image : image.name
  const fit = useMemo(() => (variant === 'single' ? singleFit(image) : undefined), [image, variant])

  useEffect(() => {
    let live = true
    setError(false)
    setLoaded(null)
    void load(image).then((url) => { if (live) setLoaded(url) }).catch(() => { if (live) setError(true) })
    return () => { live = false }
  }, [image, load, attempt])

  if (error) return <button type="button" className={css.error} data-variant={variant} onClick={request}>{labels.loadFailed}</button>
  const src = loaded
  return (
    <>
      <button
        type="button"
        className={css.frame}
        data-variant={variant}
        style={fit === undefined ? undefined : { width: fit.width, height: fit.height }}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onClick={() => { if (src !== null) setOpen(true) }}
      >
        {src === null
          ? <span className={css.loading}>{labels.loading}</span>
          : <img src={src} alt={label} style={fit === undefined ? undefined : { objectPosition: fit.objectPosition }} />}
      </button>
      {open && src !== null && <ImageLightbox src={src} alt={label} labels={labels.lightbox} onClose={close} />}
    </>
  )
}

/** Wrapping image group: a lone image renders large, several render as 64px
 * square tiles. */
export function ImageGallery({ images, load, align, labels }: {
  images: readonly SidechatImageRef[]
  load: ImageLoader
  align: 'start' | 'end'
  labels: MessageImageLabels
}) {
  if (images.length === 0) return null
  const variant = images.length === 1 ? 'single' : 'tile'
  return (
    <div className={css.gallery} data-align={align}>
      {images.map((image, index) => (
        <MessageImage
          key={`${image.attachmentId}:${index}`}
          image={image}
          load={load}
          variant={variant}
          labels={labels}
        />
      ))}
    </div>
  )
}
