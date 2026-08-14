/**
 * Client half of dsh-side-chat: a text-selection floating menu, a right-side
 * side-chat panel (drag-resizable + collapsible), the main-conversation-style
 * model/permission selectors and send/stop buttons, and a "Side chat" settings
 * section. The panel is isolated per current conversation and talks to the
 * host /sidechat API.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  DisclosureRow,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconPanelLeftOutline16,
  IconSendOutline16,
  IconStopFill16,
  IconThinkOutline14,
  MarkdownText,
  Menu,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  AttachmentRail,
  DropOverlay,
  ImageGallery,
  ImageLightbox,
  type ImageLoader,
} from '@deepseek-ai/dsh-client-ui-attachment'
import type { Context, SideQuestionItem, SideQuestionOption } from '../context-types.ts'
import {
  api,
  type PromptContentPart,
  type SidechatDirectory,
  type SidechatImageRef,
  type SidechatListItem,
  type SidechatMessage,
  type SidechatPermissions,
} from './api.ts'
import { en, LOCALE_NS, zh, type SidechatLocaleKey } from './locales.ts'
import { SUBCHAT_PREFS_DEFAULTS, type SubchatPrefs } from '../settings-shared.ts'
import css from './client.module.css'
import './layout.css'

/** Services required before mounting. */
export const inject = ['sessions', 'locale', 'slots', 'conversation']

/** A text selection the floating menu anchors to. */
interface SelectionAnchor {
  text: string
  x: number
  y: number
}

/** The panel UI state, per current parent conversation. */
interface PanelState {
  open: boolean
  parentSessionId: string
  activeChildId: string | null
  items: SidechatListItem[]
  messages: SidechatMessage[]
  draft: string
  /** Staged selection shown as an attachment while "send immediately" is off. */
  attachment: string | null
  /** Browser-owned draft images (object URLs); serialized on send. */
  attachments: ComposerAttachment[]
  lookup: boolean
  directory: SidechatDirectory | null
  permissions: SidechatPermissions | null
  provider: string
  model: string
  effort: string
  preset: string
  /** Which selector the command menu asked to open (consumed once). */
  commandOpen: 'model' | 'permission' | null
  planActive: boolean
  planPending: boolean
  goalObjective: string | null
  error: string | null
}

/** The whole browser-side snapshot. */
interface SidechatSnapshot {
  current: string | undefined
  panel: PanelState
  anchor: SelectionAnchor | null
  prefs: SubchatPrefs
  /** The current main conversation's pending user-question dialog (null = none). */
  mainQuestion: SideQuestionItem[] | null
}

/** The whole browser-side store (one per activation). */
interface SidechatStore {
  getSnapshot(): SidechatSnapshot
  subscribe(fn: () => void): () => void
  setCurrent(current: string | undefined): void
  setAnchor(anchor: SelectionAnchor | null): void
  setPrefs(prefs: SubchatPrefs): void
  setMainQuestion(questions: SideQuestionItem[] | null): void
  openPanel(parentSessionId: string): void
  closePanel(): void
  setActive(childId: string): void
  patch(partial: Partial<PanelState>): void
}

function emptyPanel(): PanelState {
  return {
    open: false,
    parentSessionId: '',
    activeChildId: null,
    items: [],
    messages: [],
    draft: '',
    attachment: null,
    attachments: [],
    lookup: false,
    directory: null,
    permissions: null,
    provider: '',
    model: '',
    effort: '',
    preset: '',
    commandOpen: null,
    planActive: false,
    planPending: false,
    goalObjective: null,
    error: null,
  }
}

/** Create the browser store (one instance per activation, per the factory rule). */
function createStore(): SidechatStore {
  let current: string | undefined
  let panel: PanelState = emptyPanel()
  let anchor: SelectionAnchor | null = null
  let prefs: SubchatPrefs = { ...SUBCHAT_PREFS_DEFAULTS }
  let mainQuestion: SideQuestionItem[] | null = null
  // Per-conversation panel state so switching away and back restores the side
  // chats instead of resetting them. The side chats stay live on the host, so
  // the client must remember each conversation's open panel + active child.
  const bySession = new Map<string, PanelState>()
  const listeners = new Set<() => void>()
  // Cached snapshot: useSyncExternalStore compares identity, so the object is
  // only rebuilt on a mutation — never inside getSnapshot itself.
  let snapshot: SidechatSnapshot = { current, panel, anchor, prefs, mainQuestion }

  const notify = (): void => {
    snapshot = { current, panel, anchor, prefs, mainQuestion }
    for (const fn of [...listeners]) fn()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    },
    setCurrent(next) {
      if (next === current) return
      if (current !== undefined) bySession.set(current, panel)
      current = next
      panel = next === undefined
        ? emptyPanel()
        : (bySession.get(next) ?? { ...emptyPanel(), parentSessionId: next, lookup: prefs.lookupDefault })
      anchor = null
      mainQuestion = null
      notify()
    },
    setAnchor(next) {
      anchor = next
      notify()
    },
    setPrefs(next) {
      prefs = next
      notify()
    },
    setMainQuestion(questions) {
      mainQuestion = questions
      notify()
    },
    openPanel(parentSessionId) {
      panel = { ...panel, open: true, parentSessionId }
      notify()
    },
    closePanel() {
      panel = { ...panel, open: false }
      notify()
    },
    setActive(childId) {
      panel = { ...panel, activeChildId: childId, messages: [], error: null }
      notify()
    },
    patch(partial) {
      panel = { ...panel, ...partial }
      notify()
    },
  }
}

/** Resolve the localized label for one locale key (module-level active locale). */
function translate(activeLocale: string, key: SidechatLocaleKey): string {
  const dict = activeLocale === 'en' ? en : zh
  return dict[key] ?? key
}

/** Format a run duration like the main conversation: "Xs" / "Xm SSs" (or Chinese). */
function formatRunDuration(ms: number, activeLocale: string): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes > 0) {
    return activeLocale === 'en'
      ? `${minutes}m ${String(seconds).padStart(2, '0')}s`
      : `${minutes}分${String(seconds).padStart(2, '0')}秒`
  }
  return activeLocale === 'en' ? `${seconds}s` : `${seconds}秒`
}

/** Browser-owned draft image (object URL preview). */
interface ComposerAttachment {
  id: string
  file: File
  previewUrl: string
}

/** Accepted image media types (mirror of dsh-attachment's ImageMediaType). */
const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

/** Create runtime draft images with object URLs (validates media type). */
function createDraftImages(files: readonly File[]): ComposerAttachment[] {
  return files.map((file) => {
    if (!IMAGE_MEDIA_TYPES.includes(file.type)) {
      throw new Error(`unsupported image type: ${file.type || 'unknown'}`)
    }
    return { id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) }
  })
}

/** Revoke one draft image's preview URL. */
function releaseDraftImage(attachment: ComposerAttachment): void {
  URL.revokeObjectURL(attachment.previewUrl)
}

/** Serialize draft images to base64 prompt parts (mirror of main sendSession). */
async function serializeImages(attachments: readonly ComposerAttachment[]): Promise<PromptContentPart[]> {
  return Promise.all(attachments.map(async (a) => {
    const bytes = new Uint8Array(await a.file.arrayBuffer())
    let binary = ''
    const chunk = 32768
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
    }
    return {
      type: 'image',
      mediaType: a.file.type,
      data: btoa(binary),
      ...(a.file.name === '' ? {} : { name: a.file.name }),
    }
  }))
}

/** Convert a base64 string to an object URL for transcript image rendering. */
function base64ObjectUrl(mediaType: string, data: string): string {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mediaType }))
}

/** Pull the side-chat list for one parent conversation. */
async function refreshList(store: SidechatStore, parentSessionId: string): Promise<void> {
  const result = await api.list({ parentSessionId })
  if (result.ok) store.patch({ items: result.value.items })
}

/** Optimistically flip one side-chat's running flag before the list round-trip. */
function setItemRunning(store: SidechatStore, childId: string, running: boolean): void {
  const items = store.getSnapshot().panel.items
  store.patch({ items: items.map((i) => (i.childId === childId ? { ...i, running } : i)) })
}

/** Pull the active side chat's transcript. */
async function refreshHistory(store: SidechatStore, childId: string): Promise<void> {
  const result = await api.history({ childId })
  if (result.ok) store.patch({ messages: result.value.messages })
}

/** Pull the model directory + permission catalog once. */
async function refreshDirectory(store: SidechatStore): Promise<void> {
  const [directoryResult, permissionsResult] = await Promise.all([
    api.directory(),
    api.permissions(),
  ])
  const patch: Partial<PanelState> = {}
  if (directoryResult.ok) patch.directory = directoryResult.value
  if (permissionsResult.ok) {
    patch.permissions = permissionsResult.value
    // Only seed the preset on first load; never clobber an explicit user pick.
    if (store.getSnapshot().panel.preset === '') {
      patch.preset = permissionsResult.value.current
    }
  }
  store.patch(patch)
}

/** The side-chat's current model selection (provider + model + effort). */
interface ModelSelection {
  provider: string
  model: string
  effort: string
}

/** One directory model's reasoning slice. */
type DirectoryReasoning = SidechatDirectory['groups'][number]['models'][number]['reasoning']

/** The first non-empty line of a reasoning block (collapsed summary). */
function firstLine(text: string): string {
  const end = text.indexOf('\n')
  return end === -1 ? text : text.slice(0, end)
}

/** Main-conversation-style reasoning disclosure row (Think). */
function ReasoningRow(props: { text: string; t: (key: SidechatLocaleKey) => string }) {
  const [expanded, setExpanded] = useState(false)
  const summary = firstLine(props.text)
  return (
    <DisclosureRow
      icon={<IconThinkOutline14 size={14} />}
      title={props.t('panel.think')}
      open={expanded}
      expandable={true}
      expandOnRowClick={true}
      onToggle={() => { setExpanded((value) => !value) }}
      collapsedContent={<span className={css.reasoningSummary}>{summary}</span>}
    >
      <div className={css.reasoningBody}>{props.text}</div>
    </DisclosureRow>
  )
}

/**
 * Main-conversation-style model selector: a compact trigger showing
 * `model · effort`, opening a two-level menu (provider groups → models, then
 * effort levels). UI mirrors dsh-client-ui-model-selection's ModelSelect.
 */
function ModelSelect(props: {
  directory: SidechatDirectory | null
  selection: ModelSelection
  onSelect: (provider: string, model: string, effort?: string) => void
  t: (key: SidechatLocaleKey) => string
  openSignal?: boolean
  onOpenConsumed?: () => void
}) {
  const { directory, selection, onSelect, t, openSignal, onOpenConsumed } = props
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<'root' | 'model' | 'effort'>('root')
  const rootRef = useRef<HTMLDivElement | null>(null)

  // External open signal (the + command menu asks the selector to open).
  useEffect(() => {
    if (openSignal === true) {
      setPane('root')
      setOpen(true)
      onOpenConsumed?.()
    }
  }, [openSignal, onOpenConsumed])

  // Current model entry across all provider groups.
  let currentChoice: { name: string; reasoning?: DirectoryReasoning } | undefined
  for (const group of directory?.groups ?? []) {
    const model = group.models.find((m) => m.id === selection.model && group.id === selection.provider)
    if (model !== undefined) {
      currentChoice = { name: model.name, reasoning: model.reasoning }
      break
    }
  }
  const reasoning = currentChoice?.reasoning
  const effectiveEffort = selection.effort !== '' ? selection.effort : reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('panel.effortDefault')
      : reasoning.efforts.find((e) => e.id === effectiveEffort)?.name ?? effectiveEffort
  const modelLabel = currentChoice?.name ?? t('panel.noModel')
  const effortChoices = reasoning === undefined
    ? []
    : [
        ...(reasoning.defaultEffort === undefined ? [{ key: 'default', effort: undefined as string | undefined, label: t('panel.effortDefault') }] : []),
        ...reasoning.efforts.map((e) => ({ key: e.id, effort: e.id, label: e.name })),
      ]

  // Close on outside pointer-down / Escape.
  useEffect(() => {
    if (!open) return
    const onDown = (e: globalThis.MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`

  return (
    <div ref={rootRef} className={css.modelSelect}>
      <button
        type="button"
        className={css.modelSelectTrigger}
        aria-haspopup="menu"
        aria-expanded={open}
        title={triggerLabel}
        onClick={() => {
          if (open) setOpen(false)
          else { setPane('root'); setOpen(true) }
        }}
      >
        <span className={css.modelSelectLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.modelSelectEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={open ? css.chevronOpen : undefined} />
      </button>

      {open && (
        <div className={css.modelSelectMenu} role="menu">
          {pane === 'root' && (
            <>
              <button type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('model') }}>
                <span className={css.modelCellLabel}>{t('panel.model')}</span>
                <span className={css.modelCellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.modelCellChevron} />
              </button>
              {reasoning !== undefined && (
                <button type="button" role="menuitem" className={css.modelCell} onClick={() => { setPane('effort') }}>
                  <span className={css.modelCellLabel}>{t('panel.effort')}</span>
                  <span className={css.modelCellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.modelCellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <div className={css.modelGroups}>
              {(directory?.groups ?? []).map((group) => (
                <section key={group.id} role="group" aria-label={group.name} className={css.modelGroup}>
                  <div className={css.modelGroupTitle}>{group.name}</div>
                  {group.models.map((model) => {
                    const selected = selection.provider === group.id && selection.model === model.id
                    return (
                      <button
                        key={model.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={selected ? `${css.modelOption} ${css.modelOptionSelected}` : css.modelOption}
                        title={model.name}
                        onClick={() => {
                          onSelect(group.id, model.id)
                          setOpen(false)
                        }}
                      >
                        <span className={css.modelOptionCopy}>
                          <span className={css.modelName}>{model.name}</span>
                          {model.description !== undefined && <span className={css.modelDescription}>{model.description}</span>}
                        </span>
                        <span className={css.modelCheck}>{selected ? <IconCheckOutline16 /> : null}</span>
                      </button>
                    )
                  })}
                </section>
              ))}
              {(directory?.groups ?? []).length === 0 && <div className={css.modelEmpty}>{t('panel.noModel')}</div>}
            </div>
          )}

          {pane === 'effort' && (
            <>
              {effortChoices.length === 0
                ? <div className={css.modelEmpty}>{t('panel.effort')}</div>
                : effortChoices.map((level) => {
                    const selected = effectiveEffort === level.effort
                    return (
                      <button
                        key={level.key}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={selected ? `${css.modelOption} ${css.modelOptionSelected}` : css.modelOption}
                        onClick={() => {
                          onSelect(selection.provider, selection.model, level.effort)
                          setOpen(false)
                        }}
                      >
                        <span className={css.modelOptionCopy}>
                          <span className={css.modelName}>{level.label}</span>
                        </span>
                        <span className={css.modelCheck}>{selected ? <IconCheckOutline16 /> : null}</span>
                      </button>
                    )
                  })}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Main-conversation-style permission selector (Menu + compact trigger). */
function PermissionSelect(props: {
  permissions: SidechatPermissions | null
  preset: string
  onSelect: (preset: string) => void
  t: (key: SidechatLocaleKey) => string
  openSignal?: boolean
  onOpenConsumed?: () => void
}) {
  const { permissions, preset, onSelect, openSignal, onOpenConsumed } = props
  const [open, setOpen] = useState(false)
  const options = (permissions?.options ?? []).filter((o) => o.value !== 'custom')
  const current = options.find((o) => o.value === preset)
  const items = options.map((o) => ({ id: o.value, label: o.name }))

  // External open signal (the + command menu asks the selector to open).
  useEffect(() => {
    if (openSignal === true) {
      setOpen(true)
      onOpenConsumed?.()
    }
  }, [openSignal, onOpenConsumed])

  return (
    <Menu
      open={open}
      side="top"
      align="end"
      items={items}
      selectedId={preset}
      onSelect={(id) => { setOpen(false); onSelect(id) }}
      onClose={() => { setOpen(false) }}
      anchor={(
        <button
          type="button"
          className={css.modelSelectTrigger}
          aria-haspopup="menu"
          aria-expanded={open}
          title={current?.description}
          onClick={() => { setOpen(!open) }}
        >
          <span className={css.modelSelectLabel}>{current?.name ?? preset}</span>
          <IconChevronDownOutline14 />
        </button>
      )}
    />
  )
}

/**
 * The floating selection menu: listens to the document selection and shows
 * one or two buttons (start / continue), dispatching to the host API.
 */
function SelectionMenu(props: { store: SidechatStore; t: (key: SidechatLocaleKey) => string }) {
  const { anchor, current, panel, prefs } = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const [local, setLocal] = useState<SelectionAnchor | null>(null)

  useEffect(() => {
    const compute = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) {
        setLocal(null)
        return
      }
      const text = selection.toString().trim()
      if (text === '') {
        setLocal(null)
        return
      }
      const range = selection.getRangeAt(0)
      const node = range.startContainer
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement
      if (element !== null && element.closest('input, textarea, [contenteditable="true"]') !== null) {
        setLocal(null)
        return
      }
      // Never offer "ask in side chat" for selections inside the side-chat panel
      // (those belong to the bring-back-to-main menu instead).
      if (element !== null && element.closest('[data-dsh-side-chat]') !== null) {
        setLocal(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setLocal(null)
        return
      }
      setLocal({ text, x: rect.left + rect.width / 2, y: rect.top })
    }
    const onMouseUp = (): void => { window.setTimeout(compute, 0) }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', compute)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', compute)
    }
  }, [])

  const start = useCallback(() => {
    if (local === null || current === undefined) return
    const parentSessionId = current
    const text = local.text
    const snap = props.store.getSnapshot().panel
    if (prefs.sendImmediately) {
      const content: PromptContentPart[] = [
        { type: 'text', text },
        ...(prefs.defaultPrompt.trim() !== '' ? [{ type: 'text' as const, text: prefs.defaultPrompt.trim() }] : []),
      ]
      void api.start({
        parentSessionId,
        content,
        lookupEnabled: prefs.lookupDefault,
        ...(snap.provider !== '' ? { provider: snap.provider } : {}),
        ...(snap.model !== '' ? { model: snap.model } : {}),
        ...(snap.effort !== '' ? { reasoningEffort: snap.effort } : {}),
      }).then((result) => {
        if (result.ok) {
          props.store.openPanel(parentSessionId)
          props.store.setActive(result.value.childId)
          props.store.patch({
            provider: result.value.provider,
            model: result.value.model,
            effort: result.value.reasoningEffort ?? '',
          })
          void refreshList(props.store, parentSessionId)
          void refreshDirectory(props.store)
        }
      })
    } else {
      // Stage the selection as an attachment; a new side chat is created on
      // send. Detach from any previously active child, but show the parent's
      // inherited model until the user picks one.
      props.store.openPanel(parentSessionId)
      props.store.patch({ attachment: text, activeChildId: null, messages: [], draft: '', provider: '', model: '', effort: '' })
      void api.inherit({ parentSessionId }).then((result) => {
        if (result.ok) {
          props.store.patch({
            provider: result.value.provider,
            model: result.value.model,
            effort: result.value.reasoningEffort ?? '',
          })
        }
      })
      void refreshDirectory(props.store)
    }
    setLocal(null)
  }, [local, current, prefs, props.store])

  const continueChat = useCallback(() => {
    if (local === null || current === undefined) return
    const parentSessionId = current
    const text = local.text
    const active = props.store.getSnapshot().panel.activeChildId
    if (active === null) return
    props.store.openPanel(parentSessionId)
    if (prefs.sendImmediately) {
      const content: PromptContentPart[] = [
        { type: 'text', text },
        ...(prefs.defaultPrompt.trim() !== '' ? [{ type: 'text' as const, text: prefs.defaultPrompt.trim() }] : []),
      ]
      setItemRunning(props.store, active, true)
      void api.followup({ childId: active, content, lookupEnabled: prefs.lookupDefault }).then((result) => {
        if (!result.ok) props.store.patch({ error: result.error.message })
        void refreshList(props.store, parentSessionId)
        void refreshHistory(props.store, active)
      })
    } else {
      props.store.patch({ attachment: text })
    }
    setLocal(null)
  }, [local, current, prefs, props.store])

  if (local === null || current === undefined) return null
  const hasActive = panel.activeChildId !== null
  return (
    <div className={css.selectionMenu} style={{ left: local.x, top: local.y - 46 }}>
      <button type="button" className={css.selectionButton} onClick={start}>{props.t('ask.new')}</button>
      {hasActive && <button type="button" className={css.selectionButton} onClick={continueChat}>{props.t('ask.continue')}</button>}
    </div>
  )
}

/**
 * The floating bring-back-to-main menu: listens to the document selection and,
 * when the selection is inside an assistant reply in the side-chat panel, shows
 * two actions — "insert directly" and "summarize then insert" — both appending
 * into the main composer without sending.
 */
function BringBackMenu(props: {
  store: SidechatStore
  t: (key: SidechatLocaleKey) => string
  bringToMain: (text: string) => Promise<boolean>
  summarizeBring: (text: string) => Promise<boolean>
}) {
  const [local, setLocal] = useState<SelectionAnchor | null>(null)
  const [summarizing, setSummarizing] = useState(false)

  useEffect(() => {
    const compute = (): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed) {
        setLocal(null)
        return
      }
      const text = selection.toString().trim()
      if (text === '') {
        setLocal(null)
        return
      }
      const range = selection.getRangeAt(0)
      const node = range.startContainer
      const element = node.nodeType === 1 ? (node as Element) : node.parentElement
      if (element !== null && element.closest('input, textarea, [contenteditable="true"]') !== null) {
        setLocal(null)
        return
      }
      if (element === null || element.closest('[data-sidechat-role="assistant"]') === null) {
        setLocal(null)
        return
      }
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) {
        setLocal(null)
        return
      }
      setLocal({ text, x: rect.left + rect.width / 2, y: rect.top })
    }
    const onMouseUp = (): void => { window.setTimeout(compute, 0) }
    document.addEventListener('mouseup', onMouseUp)
    document.addEventListener('selectionchange', compute)
    return () => {
      document.removeEventListener('mouseup', onMouseUp)
      document.removeEventListener('selectionchange', compute)
    }
  }, [])

  if (local === null) return null

  const summarize = async (): Promise<void> => {
    setSummarizing(true)
    const ok = await props.summarizeBring(local.text)
    setSummarizing(false)
    if (!ok) props.store.patch({ error: props.t('insert.summarizeFailed') })
    else setLocal(null)
  }

  return (
    <div className={css.selectionMenu} style={{ left: local.x, top: local.y - 46 }}>
      <button
        type="button"
        className={css.selectionButton}
        onClick={() => {
          void props.bringToMain(local.text).then((ok) => {
            if (!ok) props.store.patch({ error: props.t('insert.failed') })
            else setLocal(null)
          })
        }}
      >
        {props.t('insert.direct')}
      </button>
      <button type="button" className={css.selectionButton} disabled={summarizing} onClick={() => { void summarize() }}>
        {summarizing ? props.t('insert.summarizing') : props.t('insert.summarize')}
      </button>
    </div>
  )
}

/** The side-chat panel body. */
function SidechatPanel(props: {
  store: SidechatStore
  t: (key: SidechatLocaleKey) => string
  formatDuration: (ms: number) => string
  bringToMain: (text: string) => Promise<boolean>
  summarizeBring: (text: string) => Promise<boolean>
  askSidechat: (text: string) => Promise<boolean>
}) {
  const { panel, mainQuestion } = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const codeLabels = useMemo(() => ({ copyLabel: props.t('panel.copy'), copiedLabel: props.t('panel.copied') }), [props.t])
  const attachmentRailLabels = useMemo(() => ({
    group: props.t('image.railGroup'),
    open: props.t('image.railOpen'),
    scrollLeft: props.t('image.railScrollLeft'),
    scrollRight: props.t('image.railScrollRight'),
  }), [props.t])
  const messageImageLabels = useMemo(() => ({
    image: props.t('image.label'),
    open: props.t('image.open'),
    openNamed: (name: string): string => name,
    loading: props.t('image.loading'),
    loadFailed: props.t('image.loadFailed'),
    lightbox: { dialog: props.t('image.lightboxDialog'), close: props.t('image.close') },
  }), [props.t])
  const dropOverlayLabels = useMemo(() => ({
    title: props.t('image.dropTitle'),
    desc: props.t('image.dropDesc'),
  }), [props.t])
  const [width, setWidth] = useState(360)
  const [collapsed, setCollapsed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [dragActive, setDragActive] = useState(false)
  const [lightbox, setLightbox] = useState<ComposerAttachment | null>(null)
  const [limits, setLimits] = useState<{ mediaTypes: string[]; maxImageBytes: number; maxImagesPerMessage: number; maxMessageImageBytes: number } | null>(null)
  /** Index of the assistant message whose "summarize then insert" is in flight. */
  const [summarizingIndex, setSummarizingIndex] = useState<number | null>(null)
  /** Which question-dialog item is being brought into the side chat ('all' or an option label). */
  const [bringingKey, setBringingKey] = useState<string | null>(null)

  /** Assemble one question + all its options into a prompt. */
  const buildAllText = (q: SideQuestionItem): string => {
    const lines: string[] = []
    if (q.header !== undefined && q.header !== '') lines.push(`【${q.header}】`)
    lines.push(q.question)
    if (q.detail !== undefined && q.detail !== '') lines.push(q.detail)
    const options = q.options ?? []
    if (options.length > 0) {
      lines.push(props.t('question.options'))
      for (const o of options) {
        lines.push(`- ${o.label}${o.description !== undefined && o.description !== '' ? ` — ${o.description}` : ''}`)
      }
    }
    lines.push(props.t('question.allPrompt'))
    return lines.join('\n')
  }

  /** Assemble one question + one specific option into a prompt. */
  const buildOneText = (q: SideQuestionItem, o: SideQuestionOption): string => {
    const lines: string[] = []
    if (q.header !== undefined && q.header !== '') lines.push(`【${q.header}】`)
    lines.push(q.question)
    if (q.detail !== undefined && q.detail !== '') lines.push(q.detail)
    lines.push(`${props.t('question.option')}：${o.label}${o.description !== undefined && o.description !== '' ? ` — ${o.description}` : ''}`)
    lines.push(props.t('question.onePrompt'))
    return lines.join('\n')
  }

  const bringQuestionText = (text: string, key: string): void => {
    setBringingKey(key)
    void props.askSidechat(text).then((ok) => {
      setBringingKey(null)
      if (!ok) props.store.patch({ error: props.t('question.failed') })
    })
  }

  const activeItem = panel.items.find((i) => i.childId === panel.activeChildId)
  const activeRunning = activeItem?.running ?? false
  const [anchor, setAnchor] = useState<number | null>(null)

  useEffect(() => {
    const w = panel.open && !collapsed ? `${width}px` : '0px'
    document.documentElement.style.setProperty('--dsh-subchat-width', w)
    return () => { document.documentElement.style.setProperty('--dsh-subchat-width', '0px') }
  }, [panel.open, collapsed, width])

  // Lazy-load the model/permission directory whenever the panel is open but the
  // directory has not hydrated yet (covers page reload + continue + direct open).
  useEffect(() => {
    if (panel.open && panel.directory === null) {
      void refreshDirectory(props.store)
    }
  }, [panel.open, panel.directory, props.store])

  useEffect(() => {
    if (activeRunning) {
      if (anchor === null) setAnchor(activeItem?.runningSince ?? Date.now())
    } else if (anchor !== null) {
      setAnchor(null)
    }
  }, [activeRunning, activeItem?.runningSince, anchor])

  useEffect(() => {
    if (!activeRunning) return
    const id = window.setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { window.clearInterval(id) }
  }, [activeRunning])

  useEffect(() => {
    const el = scrollRef.current
    if (el !== null) el.scrollTop = el.scrollHeight
  }, [panel.messages.length, panel.activeChildId])

  useEffect(() => {
    if (!panel.open || panel.activeChildId === null) return
    const tick = (): void => {
      const snap = props.store.getSnapshot().panel
      const childId = snap.activeChildId
      if (childId === null) return
      void refreshList(props.store, snap.parentSessionId)
      void refreshHistory(props.store, childId)
    }
    tick()
    const id = window.setInterval(tick, 1200)
    return () => { window.clearInterval(id) }
  }, [panel.open, panel.activeChildId, props.store])

  const send = useCallback(() => {
    const draft = panel.draft.trim()
    const attachment = panel.attachment === null ? '' : panel.attachment
    const text = attachment === '' ? draft : (draft === '' ? attachment : `${attachment}\n\n${draft}`)
    void serializeImages(panel.attachments).then((imageParts) => {
      const content: PromptContentPart[] = [...imageParts, ...(text === '' ? [] : [{ type: 'text', text }] as PromptContentPart[])]
      if (content.length === 0) return
      const toRelease = panel.attachments
      props.store.patch({ draft: '', attachment: null, attachments: [] })
      toRelease.forEach(releaseDraftImage)

      if (panel.activeChildId === null) {
        void api.start({
          parentSessionId: panel.parentSessionId,
          content,
          lookupEnabled: panel.lookup,
          ...(panel.provider !== '' ? { provider: panel.provider } : {}),
          ...(panel.model !== '' ? { model: panel.model } : {}),
          ...(panel.effort !== '' ? { reasoningEffort: panel.effort } : {}),
          ...(panel.preset !== '' ? { preset: panel.preset } : {}),
        }).then((result) => {
          if (result.ok) {
            props.store.setActive(result.value.childId)
            props.store.patch({
              provider: result.value.provider,
              model: result.value.model,
              effort: result.value.reasoningEffort ?? '',
            })
            void refreshList(props.store, panel.parentSessionId)
            void refreshDirectory(props.store)
          } else {
            props.store.patch({ error: result.error.message })
          }
        })
        return
      }

      const childId = panel.activeChildId
      setItemRunning(props.store, childId, true)
      void api.followup({ childId, content, lookupEnabled: panel.lookup }).then((result) => {
        if (!result.ok) {
          setItemRunning(props.store, childId, false)
          props.store.patch({ error: result.error.message })
        }
        void refreshList(props.store, panel.parentSessionId)
        void refreshHistory(props.store, childId)
      })
    }).catch((error: unknown) => {
      props.store.patch({ error: error instanceof Error ? error.message : String(error) })
    })
  }, [panel, props.store])

  const stop = useCallback(() => {
    if (panel.activeChildId === null) return
    const childId = panel.activeChildId
    setItemRunning(props.store, childId, false)
    void api.stop({ childId }).then(() => {
      void refreshList(props.store, panel.parentSessionId)
      void refreshHistory(props.store, childId)
    })
  }, [panel, props.store])

  const onModelSelect = useCallback((provider: string, model: string, effort?: string) => {
    // Always update the panel selection; only a live child can receive the
    // selection immediately (staged mode applies it at creation instead).
    props.store.patch({ provider, model, effort: effort ?? '' })
    if (panel.activeChildId !== null) {
      void api.selectModel({ childId: panel.activeChildId, provider, model, ...(effort === undefined ? {} : { reasoningEffort: effort }) })
    }
  }, [panel.activeChildId, props.store])

  const onPresetChange = useCallback((value: string) => {
    if (value === 'custom' || value === '') return
    props.store.patch({ preset: value })
    if (panel.activeChildId !== null) {
      void api.selectPermission({ childId: panel.activeChildId, presetName: value }).then((result) => {
        if (!result.ok) props.store.patch({ error: result.error.message })
      })
    }
  }, [panel.activeChildId, props.store])

  const dispose = useCallback(() => {
    if (panel.activeChildId === null) return
    const childId = panel.activeChildId
    void api.dispose({ childId }).then(() => {
      void refreshList(props.store, panel.parentSessionId)
      props.store.patch({ activeChildId: null, messages: [] })
    })
  }, [panel, props.store])

  const startResize = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    const onMove = (ev: globalThis.MouseEvent): void => {
      setWidth(Math.min(720, Math.max(280, startWidth + (startX - ev.clientX))))
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [width])

  const intakeImages = useCallback((files: File[]) => {
    if (files.length === 0) return
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length === 0) {
      props.store.patch({ error: props.t('image.unsupported') })
      return
    }
    try {
      if (limits !== null) {
        if (images.some((f) => !limits.mediaTypes.includes(f.type))) {
          props.store.patch({ error: props.t('image.unsupported') })
          return
        }
        if (panel.attachments.length + images.length > limits.maxImagesPerMessage) {
          props.store.patch({ error: props.t('image.tooMany') })
          return
        }
        if (images.some((f) => f.size > limits.maxImageBytes)) {
          props.store.patch({ error: props.t('image.fileTooLarge') })
          return
        }
      }
      const created = createDraftImages(images)
      props.store.patch({ attachments: [...panel.attachments, ...created], error: null })
    } catch (error) {
      props.store.patch({ error: error instanceof Error ? error.message : String(error) })
    }
  }, [limits, panel.attachments, props.store, props.t])

  // Load the deployment image policy once (fast-path checks mirror the host).
  useEffect(() => {
    void api.limits().then((result) => {
      if (result.ok) setLimits(result.value)
    })
  }, [])

  // Full-page file drag: track enter/leave depth and accept image drops.
  useEffect(() => {
    if (!panel.open || collapsed) return
    const dragDepth = { value: 0 }
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false
    const reset = (): void => { dragDepth.value = 0; setDragActive(false) }
    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.value += 1
      setDragActive(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event) || event.dataTransfer === null) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      dragDepth.value = Math.max(0, dragDepth.value - 1)
      if (dragDepth.value === 0) setDragActive(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      reset()
      intakeImages([...event.dataTransfer?.files ?? []])
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [panel.open, collapsed, intakeImages])

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter((f): f is File => f !== null)
    if (files.length === 0) return
    e.preventDefault()
    intakeImages(files)
  }, [intakeImages])

  const removeImage = useCallback((id: string) => {
    const target = panel.attachments.find((a) => a.id === id)
    if (target !== undefined) releaseDraftImage(target)
    props.store.patch({ attachments: panel.attachments.filter((a) => a.id !== id) })
  }, [panel.attachments, props.store])

  // Load one durable image's bytes → object URL for history rendering.
  const imageLoader: ImageLoader = useCallback(async (ref) => {
    const result = await api.attachment({ childId: panel.activeChildId ?? '', attachmentId: ref.attachmentId })
    if (!result.ok) throw new Error(result.error.message)
    return base64ObjectUrl(result.value.mediaType, result.value.data)
  }, [panel.activeChildId])

  if (!panel.open) return null

  if (collapsed) {
    return (
      <Tooltip label={props.t('panel.expand')} side="bottom">
        <button type="button" className={css.collapsedHandle} onClick={() => { setCollapsed(false) }}>
          <IconPanelLeftOutline16 size={16} />
        </button>
      </Tooltip>
    )
  }

  const elapsedMs = anchor === null ? 0 : Math.max(0, now - anchor)
  const showClock = elapsedMs >= 15000

  return (
    <div className={css.panel} style={{ width }}>
      <div className={css.panelResize} onMouseDown={startResize} />
      <div className={css.panelHeader}>
        <span className={css.panelTitle}>{props.t('panel.title')}</span>
        <div className={css.panelHeaderActions}>
          <Tooltip label={props.t('panel.collapse')} side="bottom">
            <button type="button" className={css.panelIconButton} onClick={() => { setCollapsed(true) }}>
              <IconPanelLeftOutline16 size={16} />
            </button>
          </Tooltip>
        </div>
      </div>

      {mainQuestion !== null && (
        <div className={css.questionBlock}>
          {mainQuestion.map((q) => {
            const options = q.options ?? []
            return (
              <div key={q.id} className={css.questionItem}>
                <div className={css.questionHeader}>
                  <span className={css.questionHeaderText}>{q.header ?? q.question}</span>
                  <button
                    type="button"
                    className={css.questionBringButton}
                    disabled={bringingKey !== null}
                    onClick={() => { bringQuestionText(buildAllText(q), `all:${q.id}`) }}
                  >
                    {bringingKey === `all:${q.id}` ? props.t('question.bringing') : props.t('question.bringAll')}
                  </button>
                </div>
                <div className={css.questionBody}>{q.question}</div>
                {q.detail !== undefined && q.detail !== '' && <div className={css.questionDetail}>{q.detail}</div>}
                {options.map((o) => {
                  const key = `${q.id}:${o.label}`
                  return (
                    <div key={o.label} className={css.questionOption}>
                      <span className={css.questionOptionText}>
                        <span className={css.questionOptionLabel}>{o.label}</span>
                        {o.description !== undefined && o.description !== '' && <span className={css.questionOptionDesc}> — {o.description}</span>}
                      </span>
                      <button
                        type="button"
                        className={css.questionBringButton}
                        disabled={bringingKey !== null}
                        onClick={() => { bringQuestionText(buildOneText(q, o), key) }}
                      >
                        {bringingKey === key ? props.t('question.bringing') : props.t('question.bringOne')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <div className={css.panelList}>
        {panel.items.length === 0
          ? <div className={css.panelEmpty}>{props.t('panel.empty')}</div>
          : panel.items.map((item) => (
              <button
                key={item.childId}
                type="button"
                className={`${css.panelListItem} ${item.childId === panel.activeChildId ? css.panelListItemActive : ''}`}
                onClick={() => { props.store.setActive(item.childId); void refreshHistory(props.store, item.childId) }}
              >
                <span className={css.panelListItemDot} data-running={item.running ? '1' : undefined} />
                <span className={css.panelListItemLabel}>{item.childId}</span>
              </button>
            ))}
      </div>

      <div className={css.panelTranscript} ref={scrollRef}>
        {panel.messages.map((message, index) => {
          const textBlocks = message.blocks.filter((b) => b.type === 'text')
          const imageBlocks = message.blocks.filter((b) => b.type === 'image')
          const reasoningBlocks = message.blocks.filter((b) => b.type === 'reasoning')
          const text = textBlocks.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
          const images = imageBlocks.map((b) => (b.type === 'image' ? { attachment: b.ref } : null)).filter((x): x is { attachment: SidechatImageRef } => x !== null)
          if (message.role === 'user') {
            return (
              <div key={index} className={css.messageUser}>
                {text !== '' && <span className={css.messageUserText}>{text}</span>}
                {images.length > 0 && (
                  <ImageGallery images={images as unknown as Array<{ attachment: never }>} load={imageLoader} align="end" labels={messageImageLabels} />
                )}
              </div>
            )
          }
          return (
            <div key={index} className={css.messageAssistant} data-sidechat-role="assistant">
              {reasoningBlocks.map((block, rIndex) => (
                <ReasoningRow key={rIndex} text={block.type === 'reasoning' ? block.text : ''} t={props.t} />
              ))}
              {text !== '' && <MarkdownText text={text} codeLabels={codeLabels} />}
              {text !== '' && (
                <div className={css.messageActions}>
                  <button
                    type="button"
                    className={css.messageInsertButton}
                    onClick={() => {
                      void props.bringToMain(text).then((ok) => {
                        if (!ok) props.store.patch({ error: props.t('insert.failed') })
                      })
                    }}
                  >
                    {props.t('insert.direct')}
                  </button>
                  <button
                    type="button"
                    className={css.messageInsertButton}
                    disabled={summarizingIndex === index}
                    onClick={() => {
                      setSummarizingIndex(index)
                      void props.summarizeBring(text).then((ok) => {
                        setSummarizingIndex(null)
                        if (!ok) props.store.patch({ error: props.t('insert.summarizeFailed') })
                      })
                    }}
                  >
                    {summarizingIndex === index ? props.t('insert.summarizing') : props.t('insert.summarize')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {activeRunning && (
          <div className={css.panelRunning} role="status" aria-live="polite">
            <span className={css.panelRunningDot} />
            <span>{props.t('panel.running')}</span>
            {showClock && <span className={css.panelRunningClock}>{props.formatDuration(elapsedMs)}</span>}
          </div>
        )}
        {panel.error !== null && <div className={css.panelError}>{props.t('panel.error')}: {panel.error}</div>}
      </div>

      <div className={css.panelComposer}>
        {panel.attachment !== null && (
          <div className={css.panelAttachment}>
            <span className={css.panelAttachmentText}>{panel.attachment}</span>
            <button type="button" className={css.panelAttachmentRemove} onClick={() => { props.store.patch({ attachment: null }) }}>×</button>
          </div>
        )}
        {panel.attachments.length > 0 && (
          <div className={css.panelAttachmentRail}>
            <AttachmentRail
              items={panel.attachments.map((a) => ({ id: a.id, previewUrl: a.previewUrl, alt: a.file.name || props.t('image.label'), removeLabel: props.t('image.remove') }))}
              labels={attachmentRailLabels}
              onOpen={(item) => { const a = panel.attachments.find((x) => x.id === item.id); if (a !== undefined) setLightbox(a) }}
              onRemove={(item) => { removeImage(item.id) }}
            />
          </div>
        )}
        <textarea
          className={css.panelTextarea}
          placeholder={props.t('panel.input.placeholder')}
          value={panel.draft}
          onChange={(e) => { props.store.patch({ draft: e.target.value }) }}
          onPaste={onPaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className={css.panelToolbar}>
          <ModelSelect
            directory={panel.directory}
            selection={{ provider: panel.provider, model: panel.model, effort: panel.effort }}
            onSelect={onModelSelect}
            t={props.t}
          />
          <PermissionSelect
            permissions={panel.permissions}
            preset={panel.preset}
            onSelect={onPresetChange}
            t={props.t}
          />
          <Tooltip label={activeRunning ? props.t('panel.stop') : props.t('panel.send')} side="top" delayMs={500}>
            <button
              type="button"
              className={css.primary}
              aria-label={activeRunning ? props.t('panel.stop') : props.t('panel.send')}
              onClick={activeRunning ? stop : send}
            >
              {activeRunning ? <IconStopFill16 size={16} /> : <IconSendOutline16 size={16} />}
            </button>
          </Tooltip>
        </div>

        <label className={css.panelLookup}>
          <input
            type="checkbox"
            checked={panel.lookup}
            onChange={(e) => { props.store.patch({ lookup: e.target.checked }) }}
          />
          <span>{props.t('panel.lookup')}</span>
        </label>
      </div>

      <div className={css.panelFooter}>
        <button type="button" className={css.panelDispose} onClick={dispose}>{props.t('panel.dispose')}</button>
      </div>

      {dragActive && <DropOverlay disabled={false} labels={dropOverlayLabels} />}
      {lightbox !== null && (
        <ImageLightbox
          src={lightbox.previewUrl}
          alt={lightbox.file.name || props.t('image.label')}
          labels={{ dialog: props.t('image.lightboxDialog'), close: props.t('image.close') }}
          onClose={() => { setLightbox(null) }}
        />
      )}
    </div>
  )
}

/** The "Side chat" settings section (two switches + a prompt textarea). */
function SettingsSection(props: { store: SidechatStore; t: (key: SidechatLocaleKey) => string }) {
  const { store, t } = props
  const { prefs } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [promptDraft, setPromptDraft] = useState(prefs.defaultPrompt)

  // Keep the local textarea in sync with the persisted value.
  useEffect(() => { setPromptDraft(prefs.defaultPrompt) }, [prefs.defaultPrompt])

  const toggle = useCallback((patch: Partial<SubchatPrefs>) => {
    const previous = prefs
    const next = { ...previous, ...patch }
    store.setPrefs(next)
    void api.settingsUpdate(patch).then((result) => {
      if (!result.ok) store.setPrefs(previous)
    })
  }, [prefs, store])

  const commitPrompt = useCallback(() => {
    const value = promptDraft.trim()
    if (value !== prefs.defaultPrompt) toggle({ defaultPrompt: value })
  }, [promptDraft, prefs.defaultPrompt, toggle])

  return (
    <div className={css.settingsSection}>
      <label className={css.settingsRow}>
        <span className={css.settingsRowText}>
          <span className={css.settingsRowTitle}>{t('settings.lookupTitle')}</span>
          <span className={css.settingsRowDesc}>{t('settings.lookupDesc')}</span>
        </span>
        <input
          type="checkbox"
          className={css.settingsToggle}
          checked={prefs.lookupDefault}
          aria-label={t('settings.lookupTitle')}
          onChange={(e) => { toggle({ lookupDefault: e.currentTarget.checked }) }}
        />
      </label>
      <label className={css.settingsRow}>
        <span className={css.settingsRowText}>
          <span className={css.settingsRowTitle}>{t('settings.sendImmediatelyTitle')}</span>
          <span className={css.settingsRowDesc}>{t('settings.sendImmediatelyDesc')}</span>
        </span>
        <input
          type="checkbox"
          className={css.settingsToggle}
          checked={prefs.sendImmediately}
          aria-label={t('settings.sendImmediatelyTitle')}
          onChange={(e) => { toggle({ sendImmediately: e.currentTarget.checked }) }}
        />
      </label>
      <div className={css.settingsRow}>
        <span className={css.settingsRowText}>
          <span className={css.settingsRowTitle}>{t('settings.bringModeTitle')}</span>
          <span className={css.settingsRowDesc}>{t('settings.bringModeDesc')}</span>
        </span>
      </div>
      <div className={css.settingsBringMode}>
        <label className={`${css.settingsBringOption} ${prefs.bringMode === 'draft' ? css.settingsBringOptionActive : ''}`}>
          <input
            type="radio"
            name="dsh-side-chat-bring-mode"
            className={css.settingsToggle}
            checked={prefs.bringMode === 'draft'}
            onChange={() => { toggle({ bringMode: 'draft' }) }}
          />
          <span className={css.settingsRowText}>
            <span className={css.settingsRowTitle}>{t('settings.bringModeDraftTitle')}</span>
            <span className={css.settingsRowDesc}>{t('settings.bringModeDraftDesc')}</span>
          </span>
        </label>
        <label className={`${css.settingsBringOption} ${prefs.bringMode === 'context' ? css.settingsBringOptionActive : ''}`}>
          <input
            type="radio"
            name="dsh-side-chat-bring-mode"
            className={css.settingsToggle}
            checked={prefs.bringMode === 'context'}
            onChange={() => { toggle({ bringMode: 'context' }) }}
          />
          <span className={css.settingsRowText}>
            <span className={css.settingsRowTitle}>{t('settings.bringModeContextTitle')}</span>
            <span className={css.settingsRowDesc}>{t('settings.bringModeContextDesc')}</span>
          </span>
        </label>
      </div>
      <div className={css.settingsRow}>
        <span className={css.settingsRowText}>
          <span className={css.settingsRowTitle}>{t('settings.defaultPromptTitle')}</span>
          <span className={css.settingsRowDesc}>{t('settings.defaultPromptDesc')}</span>
        </span>
      </div>
      <textarea
        className={css.settingsPromptInput}
        value={promptDraft}
        placeholder={t('settings.defaultPromptPlaceholder')}
        aria-label={t('settings.defaultPromptTitle')}
        onChange={(e) => { setPromptDraft(e.currentTarget.value) }}
        onBlur={commitPrompt}
      />
    </div>
  )
}

/** Client plugin body. */
export function apply(ctx: Context): void {
  const store = createStore()

  // Localized copy follows the DSH locale (module-level mirror for callbacks).
  let activeLocale = ctx.locale.getSnapshot().active

  /** Append text to the main composer draft (draft bring mode). */
  const draftBring = (text: string): boolean => {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return false
    try {
      const actx = ctx.sessions.scope(sessionId)
      if (actx === undefined) return false
      const input = ctx.conversation.input.for(actx)
      const draft = input.state.getSnapshot().draft
      input.setDraft(draft === '' ? trimmed : `${draft}\n\n${trimmed}`)
      return true
    } catch {
      return false
    }
  }

  /** Inject text into the main conversation as a collapsed, source-tagged context row. */
  const injectBring = async (text: string, summary: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const sessionId = ctx.sessions.list.getSnapshot().current
    if (sessionId === undefined) return false
    const result = await api.inject({ parentSessionId: sessionId, text: trimmed, summary })
    return result.ok
  }

  /** Land text in the main conversation per the configured bring mode. */
  const landText = async (text: string, summaryKey: SidechatLocaleKey): Promise<boolean> => {
    const mode = store.getSnapshot().prefs.bringMode
    if (mode === 'context') {
      return injectBring(text, translate(activeLocale, summaryKey))
    }
    return draftBring(text)
  }

  /** Bring a reply back directly (routed through the configured mode). */
  const bringToMain = (text: string): Promise<boolean> => landText(text, 'insert.contextSummary')

  /** Summarize text with the side chat's inherited model, then bring the summary back. */
  const summarizeBring = async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const snap = store.getSnapshot().panel
    if (snap.parentSessionId === '') return false
    const result = await api.summarize({
      parentSessionId: snap.parentSessionId,
      text: trimmed,
      ...(snap.provider !== '' ? { provider: snap.provider } : {}),
      ...(snap.model !== '' ? { model: snap.model } : {}),
      ...(snap.effort !== '' ? { reasoningEffort: snap.effort } : {}),
      locale: activeLocale,
    })
    if (!result.ok) return false
    return landText(result.value.summary, 'insert.summarizeContextSummary')
  }

  /** Ask a piece of text in the side chat (start a new one, or continue the active one). */
  const askSidechat = async (text: string): Promise<boolean> => {
    const trimmed = text.trim()
    if (trimmed === '') return false
    const parentSessionId = ctx.sessions.list.getSnapshot().current
    if (parentSessionId === undefined) return false
    const panel = store.getSnapshot().panel
    const content: PromptContentPart[] = [{ type: 'text', text: trimmed }]

    if (panel.activeChildId === null) {
      const result = await api.start({
        parentSessionId,
        content,
        lookupEnabled: panel.lookup,
        ...(panel.provider !== '' ? { provider: panel.provider } : {}),
        ...(panel.model !== '' ? { model: panel.model } : {}),
        ...(panel.effort !== '' ? { reasoningEffort: panel.effort } : {}),
      })
      if (result.ok) {
        store.openPanel(parentSessionId)
        store.setActive(result.value.childId)
        store.patch({ provider: result.value.provider, model: result.value.model, effort: result.value.reasoningEffort ?? '' })
        void refreshList(store, parentSessionId)
        void refreshDirectory(store)
        return true
      }
      return false
    }

    const childId = panel.activeChildId
    setItemRunning(store, childId, true)
    const result = await api.followup({ childId, content, lookupEnabled: panel.lookup })
    if (!result.ok) {
      setItemRunning(store, childId, false)
      store.patch({ error: result.error.message })
    }
    void refreshList(store, parentSessionId)
    void refreshHistory(store, childId)
    return result.ok
  }

  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    const offSub = ctx.locale.subscribe(() => {
      activeLocale = ctx.locale.getSnapshot().active
      store.patch({})
    })
    return () => { offZh(); offEn(); offSub() }
  }, 'dsh-side-chat: dictionaries')

  // Load the persisted preferences once.
  void api.settingsGet().then((result) => {
    if (!result.ok) return
    const raw = result.value.value as Partial<SubchatPrefs> | null | undefined
    if (raw === null || raw === undefined) return
    store.setPrefs({
      lookupDefault: typeof raw.lookupDefault === 'boolean' ? raw.lookupDefault : SUBCHAT_PREFS_DEFAULTS.lookupDefault,
      sendImmediately: typeof raw.sendImmediately === 'boolean' ? raw.sendImmediately : SUBCHAT_PREFS_DEFAULTS.sendImmediately,
      defaultPrompt: typeof raw.defaultPrompt === 'string' ? raw.defaultPrompt : SUBCHAT_PREFS_DEFAULTS.defaultPrompt,
      bringMode: raw.bringMode === 'context' ? 'context' : 'draft',
    })
  })

  // Track the current conversation (per-conversation panel state).
  ctx.effect(() => {
    let lastId: string | undefined
    const sync = (): void => {
      const next = ctx.sessions.list.getSnapshot().current
      if (next === lastId) return
      lastId = next
      store.setCurrent(next)
      if (next === undefined) return
      void refreshList(store, next)
      const panel = store.getSnapshot().panel
      if (panel.open && panel.activeChildId !== null) {
        void refreshHistory(store, panel.activeChildId)
      }
    }
    sync()
    return ctx.sessions.list.subscribe(sync)
  }, 'dsh-side-chat: follow current conversation')

  // Track the main conversation's pending user-question dialog so the panel can
  // list its questions/options with per-item bring-back buttons. Only
  // re-publishes when the question object identity changes.
  ctx.effect(() => {
    let unsub: (() => void) | undefined
    let lastQuestion: unknown = undefined
    const follow = (): void => {
      unsub?.()
      unsub = undefined
      lastQuestion = undefined
      const sessionId = ctx.sessions.list.getSnapshot().current
      if (sessionId === undefined) {
        store.setMainQuestion(null)
        return
      }
      const binding = ctx.sessions.binding(sessionId)
      if (binding === undefined) {
        store.setMainQuestion(null)
        return
      }
      const read = (): void => {
        const pending = binding.session.getSnapshot().pending
        const question = pending.find((p) => p.kind === 'question')
        if (question === lastQuestion) return
        lastQuestion = question
        const questions = question !== undefined && question.kind === 'question' ? (question.payload.questions ?? null) : null
        store.setMainQuestion(questions === null ? null : [...questions])
      }
      read()
      unsub = binding.session.subscribe(read)
    }
    follow()
    const offList = ctx.sessions.list.subscribe(follow)
    return () => { offList(); unsub?.() }
  }, 'dsh-side-chat: track main question dialog')

  // The "Side chat" settings section.
  const settingsT = (key: SidechatLocaleKey): string => translate(activeLocale, key)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dsh-side-chat',
    order: 110,
    label: () => settingsT('settingsNav'),
    inject: () => ({ store, t: settingsT }),
  }, SettingsSection))

  // Mount the portalled tree onto document.body.
  ctx.effect(() => {
    const host = document.createElement('div')
    host.setAttribute('data-dsh-side-chat', '')
    document.body.appendChild(host)
    const root = createRoot(host)

    const t = (key: SidechatLocaleKey): string => translate(activeLocale, key)
    const formatDuration = (ms: number): string => formatRunDuration(ms, activeLocale)
    root.render(<>
      <SelectionMenu store={store} t={t} />
      <BringBackMenu store={store} t={t} bringToMain={bringToMain} summarizeBring={summarizeBring} />
      <SidechatPanel store={store} t={t} formatDuration={formatDuration} bringToMain={bringToMain} summarizeBring={summarizeBring} askSidechat={askSidechat} />
    </>)

    return () => {
      root.unmount()
      host.remove()
    }
  }, 'dsh-side-chat: panel mount')
}
