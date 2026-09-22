/**
 * dsh-side-chat host half: the /sidechat JSON API. Every side chat is an
 * ORDINARY session (no `origin: 'subagent'`) whose `meta.parentSession` points
 * at the conversation that launched it, kept archived so it appears in neither
 * the main session list nor the subagent catalog, and driven directly through
 * the live agent (followup). Model / reasoning-effort / permission are
 * inherited from the launching conversation at creation and adjustable later.
 *
 * DSH 0.1.7 admits archived sessions to no model step: its archived-session
 * gate answers `{ kind: 'reject' }` on `agent/pre-step` for a session in the
 * registry archive set, so a turn ends `blocked` before the first request. The
 * archive is therefore lifted (unarchived) for exactly as long as a side chat
 * has work queued and restored as soon as its agent settles — see
 * `deliver`/`settleTurn` below.
 *
 * All routes pass the same browser-trust fence as the /api gateway (loopback
 * or trusted authority; cross-site markers refuse).
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as agentApi from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {
  Context,
  SideAgent,
  SideAgentHandle,
  SideImageAttachmentRef,
  SideInstallModelSelection,
  SideModelSelectionRef,
  SidePresetOption,
  SideSession,
  SideSessionEvent,
} from './context-types.ts'
import { SUBCHAT_PREFS_DEFAULTS, type SubchatPrefs } from './settings-shared.ts'
import { isTrustedApiRequest } from './trust-fence.ts'
import { optionalBoolean, readJsonBody, requireString, SidechatError, writeError, writeJson, writeOk } from './wire.ts'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-side-chat-plus'

/** Services required before mounting. */
export const inject = [
  'webServer',
  'sessions',
  'agents',
  'workspaceRegistry',
  'sessionQuery',
  'permissionPresets',
  'agentPresets',
  'llm',
  'attachments',
  'commands',
]

/**
 * Couple a side chat's selection to its agent so prompt assembly and request
 * routing switch together. Read through the namespace object rather than a
 * named import: a named import fails the ESM link on any build that drops the
 * export, while this degrades to the request-only waterfall in `start`.
 */
const installModelSelection = (agentApi as unknown as { installModelSelection?: SideInstallModelSelection }).installModelSelection

/** One live side chat the host owns. */
interface SidechatRecord {
  childId: string
  parentSessionId: string
  handle: SideAgentHandle
  /** Live selection coupled to the agent; mutated by `sidechat.selectModel`. */
  selection: SideModelSelectionRef
  createdAt: number
  /**
   * Deliveries whose turn has not settled yet. The session stays unarchived
   * while this is non-zero and is archived again when it reaches zero, so a
   * followup sent mid-turn can never be archived out from under itself.
   */
  pendingTurns: number
}

/** Durable record list file (cleanup is a later feature; the list is the record). */
const RECORD_FILE = 'dsh-side-chat-sessions.json'

/** The record-list file path under the harness home. */
function recordFilePath(): string {
  return dshHomePath(RECORD_FILE)
}

/** Read the durable side-chat record list (absent/malformed → empty). */
async function readRecords(): Promise<Array<{ childId: string; parentSessionId: string; createdAt: number }>> {
  try {
    const raw = await readFile(recordFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is { childId: string; parentSessionId: string; createdAt: number } => {
      const record = entry as Record<string, unknown> | null
      return typeof record?.childId === 'string' && typeof record?.parentSessionId === 'string'
    }).map((entry) => ({
      childId: entry.childId,
      parentSessionId: entry.parentSessionId,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : 0,
    }))
  } catch {
    return []
  }
}

/** Persist the live side-chat record list (the "record" a future cleanup consumes). */
async function writeRecords(records: Array<{ childId: string; parentSessionId: string; createdAt: number }>): Promise<void> {
  const path = recordFilePath()
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(records, null, 2), 'utf8')
}

/** Browser-submitted prompt content part (text or base64 image). */
type PromptContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }

/** Model-facing content block (text or durable image reference). */
type ContentBlock = { type: 'text'; text: string } | { type: 'image'; attachment: SideImageAttachmentRef }

/** One transcript block (text or durable image reference). */
type TranscriptBlock = { type: 'text'; text: string } | { type: 'image'; ref: SideImageAttachmentRef } | { type: 'reasoning'; text: string }

/** The lookup guidance appended as an extra text block (hidden from the UI). */
const GUIDANCE_MARKER = '[sidechat-guidance]'
const LOOKUP_GUIDANCE = `${GUIDANCE_MARKER}[需要时，请读取工作区文件或查阅发起此问题的父会话记录来补充信息；若已尽力仍不足，请说明限制。]`
const NO_LOOKUP_GUIDANCE = `${GUIDANCE_MARKER}[请仅基于上述内容直接回答，不要主动查阅工作区文件或父会话记录。]`
/** Legacy (pre-marker) guidance prefixes, filtered so older messages hide too. */
const LEGACY_GUIDANCE_PREFIXES = ['[需要时，请读取工作区文件', '[请仅基于上述内容']

/** Decode one base64 string into bytes (host-side; Node Buffer). */
function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'))
}

/** A user-role message value `agent.followup` accepts (identity + content + source). */
function userMessage(content: ContentBlock[]): { id: string; role: 'user'; content: ContentBlock[]; source: { kind: 'user' } } {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    source: { kind: 'user' },
  }
}

/** Fold a raw session event log into a minimal user/assistant transcript with image refs. */
function foldTranscript(events: readonly { type: string; data: Record<string, unknown> }[]): Array<{ role: 'user' | 'assistant'; blocks: TranscriptBlock[] }> {
  const fold = (content: unknown): TranscriptBlock[] => {
    if (!Array.isArray(content)) return []
    const blocks: TranscriptBlock[] = []
    for (const raw of content) {
      const b = raw as Record<string, unknown> | null
      if (b?.type === 'text' && typeof b.text === 'string') {
        const text = b.text
        const hidden = text.startsWith(GUIDANCE_MARKER) || LEGACY_GUIDANCE_PREFIXES.some((prefix) => text.startsWith(prefix))
        if (!hidden) blocks.push({ type: 'text', text })
      } else if (b?.type === 'image' && b.attachment !== null && typeof b.attachment === 'object') {
        blocks.push({ type: 'image', ref: b.attachment as SideImageAttachmentRef })
      } else if (b?.type === 'reasoning' && typeof b.text === 'string') {
        blocks.push({ type: 'reasoning', text: b.text })
      }
    }
    return blocks
  }
  const messages: Array<{ role: 'user' | 'assistant'; blocks: TranscriptBlock[] }> = []
  for (const event of events) {
    if (event.type === 'user/message') {
      // Skip plugin-injected runtime context (system prompt contexts like the
      // sandbox policy), which the loop projects as user/message events.
      const source = (event.data as { source?: { kind?: string } }).source
      if (source !== undefined && source.kind !== 'user') continue
      const blocks = fold(event.data.content)
      if (blocks.length > 0) messages.push({ role: 'user', blocks })
    } else if (event.type === 'assistant/message') {
      const message = event.data.message as Record<string, unknown> | null
      const blocks = fold(message?.content)
      if (blocks.length > 0) messages.push({ role: 'assistant', blocks })
    }
  }
  return messages
}

/** The start time of the still-open turn, or undefined when no turn is running. */
function openTurnStart(events: readonly SideSessionEvent[]): number | undefined {
  let lastStart: number | undefined
  let lastEnd: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') lastStart = event.time
    else if (event.type === 'turn/end') lastEnd = event.time
  }
  if (lastStart === undefined) return undefined
  if (lastEnd !== undefined && lastEnd >= lastStart) return undefined
  return lastStart
}

/** Schemastery schema for the user-facing preferences (validated by the settings service). */
const PrefsSchema: z<SubchatPrefs> = z.object({
  lookupDefault: z.boolean().default(SUBCHAT_PREFS_DEFAULTS.lookupDefault),
  sendImmediately: z.boolean().default(SUBCHAT_PREFS_DEFAULTS.sendImmediately),
  defaultPrompt: z.string().default(SUBCHAT_PREFS_DEFAULTS.defaultPrompt),
  bringMode: z.union(['draft', 'context']).default(SUBCHAT_PREFS_DEFAULTS.bringMode),
  panelHome: z.union(['floating', 'sidebar-right']).default(SUBCHAT_PREFS_DEFAULTS.panelHome),
})

// DSH 0.1.7 derives settings from the Loader entry's live Config fields.
// Volatile preferences update without disposing the running side chats.
export const Config = PrefsSchema.volatile()

/** Live settings face (bound when the settings service is mounted). */
interface SubchatSettingsFace {
  get(): { value?: unknown; revision?: number }
  update(patch: Record<string, unknown>, expectedRevision?: number): Promise<{ value?: unknown; revision?: number }>
}

/** The API method table bound to the plugin context and the live side-chat map. */
function buildApi(ctx: Context, sideChats: Map<string, SidechatRecord>, getSettings: () => SubchatSettingsFace | undefined) {
  /** Persist the current live records (best-effort; never blocks the API). */
  const persist = (): void => {
    const records = [...sideChats.values()].map((record) => ({
      childId: record.childId,
      parentSessionId: record.parentSessionId,
      createdAt: record.createdAt,
    }))
    void writeRecords(records).catch((error: unknown) => {
      console.warn('[dsh-side-chat] record write failed:', error instanceof Error ? error.message : String(error))
    })
  }

  /** Narrow a payload value to a non-empty prompt content array. */
  const requireContent = (payload: unknown): PromptContentPart[] => {
    const record = payload as Record<string, unknown> | null
    const content = record?.content
    if (!Array.isArray(content) || content.length === 0) {
      throw new SidechatError('bad-request', 'missing or invalid "content"')
    }
    const parts: PromptContentPart[] = []
    for (const raw of content) {
      const part = raw as Record<string, unknown> | null
      if (part?.type === 'text' && typeof part.text === 'string' && part.text !== '') {
        parts.push({ type: 'text', text: part.text })
      } else if (part?.type === 'image' && typeof part.mediaType === 'string' && typeof part.data === 'string' && part.data !== '') {
        parts.push({
          type: 'image',
          mediaType: part.mediaType,
          data: part.data,
          ...(typeof part.name === 'string' && part.name !== '' ? { name: part.name } : {}),
        })
      } else {
        throw new SidechatError('bad-request', 'invalid content block')
      }
    }
    if (parts.every((p) => p.type !== 'text')) {
      // Content must carry at least one text block (image-only prompts unsupported).
      throw new SidechatError('bad-request', 'content must include text')
    }
    return parts
  }

  /** Promote browser base64 images to durable references; append hidden guidance. */
  const durableContent = async (parts: PromptContentPart[], lookupEnabled: boolean): Promise<ContentBlock[]> => {
    const limits = ctx.attachments.imageLimits
    const images = parts.filter((p) => p.type === 'image')
    if (images.length > limits.maxImagesPerMessage) {
      throw new SidechatError('too-many-images', `prompt exceeds the ${limits.maxImagesPerMessage}-image limit`, 400)
    }
    const blocks: ContentBlock[] = []
    for (const part of parts) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text })
      } else {
        const data = decodeBase64(part.data)
        await ctx.attachments.validateImage({ data, mediaType: part.mediaType, ...(part.name === undefined ? {} : { name: part.name }) })
        const attachment = await ctx.attachments.saveImage({ data, mediaType: part.mediaType, ...(part.name === undefined ? {} : { name: part.name }) })
        blocks.push({ type: 'image', attachment })
      }
    }
    blocks.push({ type: 'text', text: lookupEnabled ? LOOKUP_GUIDANCE : NO_LOOKUP_GUIDANCE })
    return blocks
  }

  /** Resolve the live launching agent (the side chat's durable parent must be live to start/continue). */
  const parentOf = (parentSessionId: string): SideAgent => {
    const parent = ctx.agents.get(parentSessionId)
    if (parent === undefined) {
      throw new SidechatError('parent-unavailable', 'the launching conversation is not live; reopen it to start or continue a side chat', 409)
    }
    return parent
  }

  /** The parent conversation's current model selection (for staged-mode display). */
  const inherit = (payload: unknown): { provider: string; model: string; reasoningEffort?: string } => {
    const parentSessionId = requireString(payload, 'parentSessionId')
    const parent = parentOf(parentSessionId)
    const parentConfig = parent.session.requestHeader?.()?.config
    return {
      provider: parentConfig?.provider ?? parent.options.provider ?? '',
      model: parentConfig?.model ?? parent.options.model ?? '',
      ...(parentConfig?.reasoningEffort === undefined ? {} : { reasoningEffort: parentConfig.reasoningEffort }),
    }
  }

  /** Resolve the live side-chat agent behind a childId. */
  const childOf = (childId: string): SideAgent => {
    const record = sideChats.get(childId)
    if (record !== undefined) return record.handle.agent
    const live = ctx.agents.get(childId)
    if (live !== undefined) return live
    throw new SidechatError('child-unavailable', `side chat "${childId}" is not live`, 409)
  }

  /** Resolve the live side-chat session (for permission writes). */
  const sessionOf = (childId: string): SideSession => {
    const child = childOf(childId)
    const session = ctx.sessions.get(childId) ?? child.session
    if (session === undefined) throw new SidechatError('child-unavailable', `side chat "${childId}" has no session`, 409)
    return session
  }

  /** List the host slash commands available to one side-chat agent. */
  const commands = (payload: unknown): { commands: Array<{ name: string; description: string }> } => {
    const childId = requireString(payload, 'childId')
    const child = childOf(childId)
    return { commands: ctx.commands.list(child).map((c) => ({ name: c.name, description: c.description })) }
  }

  /** Execute one host slash command against a side-chat agent. */
  const command = async (payload: unknown): Promise<{ executed: boolean }> => {
    const childId = requireString(payload, 'childId')
    const line = requireString(payload, 'line')
    const child = childOf(childId)
    const result = await ctx.commands.execute(child, line, [], new AbortController().signal)
    return { executed: result !== undefined }
  }

  /**
   * Read a side chat's event log through the session-query service. DSH 0.1.6
   * deprecated the Session's synchronous event getters (`snapshotEvents`,
   * `eventAt`, `ownEvents`); `readSession` is the live-preferred asynchronous
   * read that supersedes them, and the transcript routes already use it.
   */
  const sessionEvents = async (sessionId: string): Promise<readonly SideSessionEvent[]> =>
    (await ctx.sessionQuery.readSession(sessionId)).events

  /** Fold one side-chat agent's plan/goal state for its composer chrome. */
  const state = async (payload: unknown): Promise<{ plan: { active: boolean; pending: boolean }; goal: { id: string; objective: string } | null }> => {
    const childId = requireString(payload, 'childId')
    childOf(childId)
    const events = await sessionEvents(childId)
    // Plan fold mirrors dsh-plan-mode's `plan` projection.
    let planActive = false
    let planWanted: boolean | null = null
    // Goal fold mirrors dsh-goal's last-wins `goal/change` projection.
    let goal: { id: string; objective: string } | null = null
    for (const event of events) {
      const data = event.data as Record<string, unknown>
      if (event.type === 'command/run' && data.name === 'plan') {
        if (data.args === undefined) continue
        const wanted = String(data.args).trim() !== 'off'
        if (wanted !== planWanted) planWanted = wanted
      } else if (event.type === 'plan/mode') {
        planActive = data.active === true
        planWanted = null
      } else if (event.type === 'goal/change') {
        if (data.operation === 'clear') {
          goal = null
        } else if (data.goal !== null && typeof data.goal === 'object') {
          const g = data.goal as Record<string, unknown>
          if (typeof g.id === 'string' && typeof g.objective === 'string') {
            goal = { id: g.id, objective: g.objective }
          }
        }
      }
    }
    return {
      plan: { active: planActive, pending: planWanted !== null && planWanted !== planActive },
      goal,
    }
  }

  /**
   * Serialize one side chat's archive/unarchive writes. Both registry calls go
   * through the host registry's own operation queue, so enqueueing them in call
   * order is what decides the final state; this chain keeps that order stable
   * when a settling turn and a new delivery overlap.
   */
  const visibilityQueue = new Map<string, Promise<void>>()
  const queueVisibility = (childId: string, op: () => Promise<void>): Promise<void> => {
    const previous = visibilityQueue.get(childId) ?? Promise.resolve()
    const next = previous.then(op, op)
    visibilityQueue.set(childId, next.then(() => {}, () => {}))
    return next
  }

  /**
   * Restore one side chat's session before a turn. Registries older than the
   * 0.1.7 gate have no `unarchiveSession` (and need none): there the archive
   * simply stays in place for the whole turn. A failed restore propagates: the
   * caller must not deliver a prompt the gate will answer with `blocked`.
   */
  const unarchiveChild = (childId: string): Promise<void> => {
    const unarchive = ctx.workspaceRegistry.unarchiveSession
    if (unarchive === undefined) return archiveChild(childId)
    return queueVisibility(childId, () => unarchive.call(ctx.workspaceRegistry, childId))
  }

  /**
   * Hide one side chat's session again once its agent has settled. Best-effort:
   * a registry that reports the session active (or refuses the write) only
   * leaves it visible until the next settle, never breaks a turn.
   */
  const archiveChild = (childId: string): Promise<void> => {
    return queueVisibility(childId, () => ctx.workspaceRegistry.archiveSession(childId)).catch(() => {})
  }

  /** Count one settled turn and re-archive the session when the last one ends. */
  const settleTurn = (record: SidechatRecord): void => {
    if (record.pendingTurns > 0) record.pendingTurns -= 1
    if (record.pendingTurns > 0) return
    void archiveChild(record.childId)
  }

  /**
   * Hand one prompt to a side chat: lift the archive, deliver, and let the
   * agent's own idle boundary put the session back out of every list. `followup`
   * opens the driver synchronously (the phase turns `running` before it
   * returns), so observing `whenIdle` right after it can never miss the turn.
   */
  const deliver = async (record: SidechatRecord, message: unknown): Promise<void> => {
    record.pendingTurns += 1
    try {
      await unarchiveChild(record.childId)
      record.handle.agent.followup(message)
    } catch (error) {
      // Balance the count: the delivery never opened a turn.
      settleTurn(record)
      throw error
    }
    void record.handle.agent.whenIdle().then(() => { settleTurn(record) }, () => { settleTurn(record) })
  }

  /** Create one side chat: inherit, record, deliver the first prompt (hidden while idle). */
  const start = async (payload: unknown): Promise<{ childId: string; provider: string; model: string; reasoningEffort?: string }> => {
    const parentSessionId = requireString(payload, 'parentSessionId')
    const content = requireContent(payload)
    const lookupEnabled = optionalBoolean(payload, 'lookupEnabled')
    const parent = parentOf(parentSessionId)

    const record = payload as { provider?: unknown; model?: unknown; reasoningEffort?: unknown; preset?: unknown }
    const parentConfig = parent.session.requestHeader?.()?.config
    const parentProvider = parentConfig?.provider ?? parent.options.provider ?? ''
    const parentModel = parentConfig?.model ?? parent.options.model ?? ''
    // A client-supplied selection wins over the inherited one (lets the user
    // pick a provider/model before the first send while "send immediately" is off).
    const provider = typeof record.provider === 'string' && record.provider !== '' ? record.provider : parentProvider
    const model = typeof record.model === 'string' && record.model !== '' ? record.model : parentModel
    const maxTokens = parentConfig?.maxTokens ?? parent.options.maxTokens
    const explicitEffort = typeof record.reasoningEffort === 'string' && record.reasoningEffort !== '' ? record.reasoningEffort : undefined
    const reasoningEffort = explicitEffort ?? parentConfig?.reasoningEffort
    const cwd = parent.session.header.cwd

    // The mutable ref the agent reads live, so `sidechat.selectModel` takes
    // effect on a later step instead of only after a restart.
    const selection: SideModelSelectionRef = {
      current: {
        provider,
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      },
      assembled: undefined,
    }
    const parentCtx = parent.ctx

    const childId = `subchat-${randomUUID()}`
    const handle = await ctx.agents.create({
      sessionId: childId,
      meta: {
        ...(cwd === undefined ? {} : { cwd }),
        parentSession: parentSessionId,
      },
      agentOptions: {
        provider,
        model,
        ...(maxTokens === undefined ? {} : { maxTokens }),
      },
      setup: (agentCtx: Context) => {
        // Inherit the launching conversation's toolset/prompt sections.
        if (parentCtx !== undefined) {
          ctx.agentPresets.composeFrom(agentCtx, parentCtx)
        }
        // Model / reasoning-effort are adjustable at runtime. The coupled
        // installer snapshots the selection before prompt assembly delegates
        // and applies the same value to the request config, so a switch made
        // mid-turn lands on a later step instead of assembling the prompt for
        // the inherited model while calling the selected one. An absent
        // effort clears the inherited one, restoring provider/default behavior.
        if (installModelSelection !== undefined) {
          installModelSelection(agentCtx, selection)
          return
        }
        // Fallback for builds without that API: rewrites the request config
        // only, which can split prompt assembly from routing mid-turn.
        agentCtx.on('agent/request', async (_payload: unknown, next: () => Promise<Record<string, unknown>>) => {
          const resolved = await next()
          const sel = selection.current
          if (sel === undefined) return resolved
          const { reasoningEffort: _drop, ...rest } = resolved
          return {
            ...rest,
            provider: sel.provider,
            model: sel.model,
            ...(sel.reasoningEffort === undefined ? {} : { reasoningEffort: sel.reasoningEffort }),
          }
        })
      },
    })

    try {
      // Client-supplied preset wins; otherwise inherit the launching
      // conversation's permission preset (skip custom).
      const explicitPreset = typeof record.preset === 'string' && record.preset !== '' ? record.preset : undefined
      const parentPreset = ctx.permissionPresets.current(parent.session)
      const preset = explicitPreset ?? parentPreset
      if (preset !== 'custom') {
        ctx.permissionPresets.set(handle.agent.session, preset)
      }
    } catch (error) {
      console.warn('[dsh-side-chat] permission inherit failed:', error instanceof Error ? error.message : String(error))
    }

    const child: SidechatRecord = {
      childId,
      parentSessionId,
      handle,
      selection,
      createdAt: Date.now(),
      pendingTurns: 0,
    }
    sideChats.set(childId, child)
    persist()

    await deliver(child, userMessage(await durableContent(content, lookupEnabled)))
    return { childId, provider, model, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }
  }

  /** Deliver one later message to an existing side chat. */
  const followup = async (payload: unknown): Promise<{ accepted: true }> => {
    const childId = requireString(payload, 'childId')
    const content = requireContent(payload)
    const lookupEnabled = optionalBoolean(payload, 'lookupEnabled')
    const child = childOf(childId)
    const record = sideChats.get(childId)
    const message = userMessage(await durableContent(content, lookupEnabled))
    if (record === undefined) {
      // A child adopted from the live agent registry (record lost) still needs
      // its archive lifted before a turn it did not create itself.
      await unarchiveChild(childId)
      child.followup(message)
      void child.whenIdle().then(() => { void archiveChild(childId) }, () => { void archiveChild(childId) })
      return { accepted: true }
    }
    await deliver(record, message)
    return { accepted: true }
  }

  /** List the side chats launched by one parent conversation. */
  const list = async (payload: unknown): Promise<{ items: Array<{ childId: string; running: boolean; runningSince?: number }> }> => {
    const parentSessionId = requireString(payload, 'parentSessionId')
    const items: Array<{ childId: string; running: boolean; runningSince?: number }> = []
    for (const record of sideChats.values()) {
      if (record.parentSessionId !== parentSessionId) continue
      const agent = record.handle.agent
      // "Running" follows the agent's live lifecycle status — the dominant
      // signal the main conversation uses — so the composer flips to the stop
      // button the moment the driver wakes for thinking/streaming, instead of
      // waiting for a durable turn/start to land in the log. A settled driver
      // is always 'idle' again, so a finished turn can never leave the panel
      // stuck on "thinking". Hosts that do not surface the status getter fall
      // back to the open-turn event scan.
      const status = (agent as { status?: string }).status
      const statusRunning = status === 'running'
      // Only the status-less fallback pays for a log read.
      const eventRunningSince = status === undefined ? openTurnStart(await sessionEvents(record.childId)) : undefined
      const running = statusRunning || (status === undefined && eventRunningSince !== undefined)
      const runningSince = running ? (eventRunningSince ?? Date.now()) : undefined
      items.push({
        childId: record.childId,
        running,
        ...(runningSince !== undefined ? { runningSince } : {}),
      })
    }
    return { items }
  }

  /** Interrupt the active side chat's current turn (user-initiated stop). */
  const stop = (payload: unknown): { accepted: true } => {
    const childId = requireString(payload, 'childId')
    const child = childOf(childId)
    child.cancel({ kind: 'user' })
    return { accepted: true }
  }

  /** Fold one side chat's transcript. */
  const history = async (payload: unknown): Promise<{ messages: Array<{ role: 'user' | 'assistant'; blocks: TranscriptBlock[] }> }> => {
    const childId = requireString(payload, 'childId')
    const snapshot = await ctx.sessionQuery.readSession(childId)
    return { messages: foldTranscript(snapshot.events) }
  }

  /** The deployment-resolved image policy (for client-side fast-path checks). */
  const limits = (): { mediaTypes: string[]; maxImageBytes: number; maxImagesPerMessage: number; maxMessageImageBytes: number; maxImagePixels: number; maxImageDimension?: number } => {
    const l = ctx.attachments.imageLimits
    return {
      mediaTypes: [...l.mediaTypes],
      maxImageBytes: l.maxImageBytes,
      maxImagesPerMessage: l.maxImagesPerMessage,
      maxMessageImageBytes: l.maxMessageImageBytes,
      maxImagePixels: l.maxImagePixels,
      // Added in 0.1.6; earlier lines leave it absent so the client skips the check.
      ...(l.maxImageDimension === undefined ? {} : { maxImageDimension: l.maxImageDimension }),
    }
  }

  /** Read one durable image's bytes for transcript rendering. */
  const attachment = async (payload: unknown): Promise<{ mediaType: string; data: string }> => {
    const childId = requireString(payload, 'childId')
    const attachmentId = requireString(payload, 'attachmentId')
    const snapshot = await ctx.sessionQuery.readSession(childId)
    for (const message of foldTranscript(snapshot.events)) {
      for (const block of message.blocks) {
        if (block.type === 'image' && block.ref.attachmentId === attachmentId) {
          const stored = await ctx.attachments.readImage(block.ref)
          return { mediaType: stored.ref.mediaType, data: Buffer.from(stored.data).toString('base64') }
        }
      }
    }
    throw new SidechatError('not-found', `image "${attachmentId}" not found`, 404)
  }

  /** Adjust one side chat's model / reasoning-effort. */
  const selectModel = (payload: unknown): { accepted: true } => {
    const childId = requireString(payload, 'childId')
    const provider = requireString(payload, 'provider')
    const model = requireString(payload, 'model')
    const record = sideChats.get(childId)
    if (record === undefined) throw new SidechatError('child-unavailable', `side chat "${childId}" is not live`, 409)
    const reasoningEffort = (payload as Record<string, unknown> | null)?.reasoningEffort
    // Replace the whole object so the coupled listeners never observe a
    // half-written selection (provider switched, model still inherited).
    record.selection.current = {
      provider,
      model,
      ...(typeof reasoningEffort === 'string' && reasoningEffort !== '' ? { reasoningEffort } : {}),
    }
    return { accepted: true }
  }

  /** Adjust one side chat's permission preset. */
  const selectPermission = (payload: unknown): { accepted: true } => {
    const childId = requireString(payload, 'childId')
    const presetName = requireString(payload, 'presetName')
    const session = sessionOf(childId)
    ctx.permissionPresets.set(session, presetName)
    return { accepted: true }
  }

  /** Close one side chat (tears down its agent and session). */
  const dispose = async (payload: unknown): Promise<{ accepted: true }> => {
    const childId = requireString(payload, 'childId')
    const record = sideChats.get(childId)
    if (record !== undefined) {
      sideChats.delete(childId)
      try {
        await record.handle.dispose()
      } catch (error) {
        console.warn('[dsh-side-chat] dispose failed:', error instanceof Error ? error.message : String(error))
      }
      persist()
    }
    return { accepted: true }
  }

  /** Summarize one piece of text with the side chat's (inherited) model. */
  const summarize = async (payload: unknown): Promise<{ summary: string }> => {
    const parentSessionId = requireString(payload, 'parentSessionId')
    const text = requireString(payload, 'text')
    const record = payload as { provider?: unknown; model?: unknown; reasoningEffort?: unknown; locale?: unknown }

    // Inherit the launching conversation's model unless the client supplied one.
    const parent = parentOf(parentSessionId)
    const parentConfig = parent.session.requestHeader?.()?.config
    const provider = typeof record.provider === 'string' && record.provider !== '' ? record.provider : (parentConfig?.provider ?? parent.options.provider ?? '')
    const model = typeof record.model === 'string' && record.model !== '' ? record.model : (parentConfig?.model ?? parent.options.model ?? '')
    if (provider === '' || model === '') {
      throw new SidechatError('bad-request', 'no model available for summarization')
    }
    const reasoningEffort = typeof record.reasoningEffort === 'string' && record.reasoningEffort !== '' ? record.reasoningEffort : parentConfig?.reasoningEffort

    const locale = typeof record.locale === 'string' && record.locale === 'en' ? 'en' : 'zh'
    const prompt = locale === 'en'
      ? `Summarize the following content concisely. Keep the key points and output only the summary:\n\n${text}`
      : `请对以下内容做简明扼要的摘要，保留关键信息，只输出摘要本身：\n\n${text}`

    const chunks = ctx.llm.stream({
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      maxTokens: 1024,
      messages: [{
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'user' },
      }],
    })

    let summary = ''
    for await (const chunk of chunks) {
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        summary += chunk.text
      }
    }
    const trimmed = summary.trim()
    if (trimmed === '') {
      throw new SidechatError('summarize-empty', 'the model returned no summary', 502)
    }
    return { summary: trimmed }
  }

  /** Inject one piece of text into the main conversation as a collapsed context row. */
  const inject = (payload: unknown): { accepted: true } => {
    const parentSessionId = requireString(payload, 'parentSessionId')
    const text = requireString(payload, 'text')
    const record = payload as { summary?: unknown }
    const summary = typeof record.summary === 'string' && record.summary.trim() !== '' ? record.summary.trim() : '从侧边聊天带回'
    const parent = parentOf(parentSessionId)
    parent.inject({
      id: randomUUID(),
      role: 'user',
      content: [{ type: 'text', text }],
      // V4 rejects the retired { kind: 'plugin', plugin: ... } wrapper.
      // Match the identity assigned to historical messages by V3→V4 migration.
      source: { kind: 'plugin:dsh-side-chat', form: 'notice', summary },
    })
    return { accepted: true }
  }

  /** Full model directory: provider groups → models → reasoning efforts. */
  const directory = async (): Promise<{
    groups: Array<{
      id: string
      name: string
      models: Array<{
        id: string
        name: string
        description?: string
        reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
      }>
    }>
  }> => {
    const providers = ctx.llm.listProviders()
    const groups: Array<{
      id: string
      name: string
      models: Array<{
        id: string
        name: string
        description?: string
        reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
      }>
    }> = []
    for (const provider of providers) {
      const listed = await ctx.llm.listModels(provider.id)
      const models: Array<{
        id: string
        name: string
        description?: string
        reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
      }> = []
      for (const model of listed) {
        const entry: {
          id: string
          name: string
          description?: string
          reasoning?: { efforts: Array<{ id: string; name: string }>; defaultEffort?: string }
        } = {
          id: model.id,
          name: model.name,
          ...(model.description === undefined ? {} : { description: model.description }),
        }
        try {
          const info = await ctx.llm.resolveModelInfo(provider.id, model.id)
          if (info.reasoning !== undefined) {
            entry.reasoning = {
              efforts: info.reasoning.efforts.map((e) => ({ id: e.id, name: e.name })),
              ...(info.reasoning.defaultEffort === undefined ? {} : { defaultEffort: info.reasoning.defaultEffort }),
            }
          }
        } catch {
          // A model whose metadata fails still lists, just without effort levels.
        }
        models.push(entry)
      }
      groups.push({ id: provider.id, name: provider.name, models })
    }
    return { groups }
  }

  /** Permission-preset options for the side-chat selector. */
  const permissions = (): { options: Array<{ value: string; name: string; description?: string }>; current: string } => {
    const presets = ctx.permissionPresets
    const toOption = (o: SidePresetOption): { value: string; name: string; description?: string } => ({
      value: o.value,
      name: o.name,
      ...(o.description === undefined ? {} : { description: o.description }),
    })
    // 0.1.6 split the combined `selectFor(knobState)` into a process-level
    // `catalog()` plus a separate current value. Prefer the new face and fall
    // back to the old one so both release lines serve this route.
    const catalog = presets.catalog
    if (typeof catalog === 'function') {
      return {
        options: catalog.call(presets).options.map(toOption),
        current: presets.defaultPreset ?? 'custom',
      }
    }
    const selectFor = presets.selectFor
    if (typeof selectFor === 'function') {
      const select = selectFor.call(presets, {})
      return {
        options: select.options.map(toOption),
        current: select.currentValue,
      }
    }
    throw new SidechatError('permissions-unavailable', 'the permission-presets service exposes neither catalog() nor selectFor()', 503)
  }

  return {
    'sidechat.start': start,
    'sidechat.followup': followup,
    'sidechat.list': list,
    'sidechat.history': history,
    'sidechat.stop': stop,
    'sidechat.selectModel': selectModel,
    'sidechat.selectPermission': selectPermission,
    'sidechat.summarize': summarize,
    'sidechat.inject': inject,
    'sidechat.directory': directory,
    'sidechat.permissions': permissions,
    'sidechat.limits': limits,
    'sidechat.attachment': attachment,
    'sidechat.inherit': inherit,
    'sidechat.commands': commands,
    'sidechat.command': command,
    'sidechat.state': state,
    'sidechat.dispose': dispose,
    // Side-chat preferences (settings service optional; absent → undefined).
    'settings.get': () => {
      const settings = getSettings()
      return settings?.get() ?? { value: undefined, revision: undefined }
    },
    'settings.update': async (payload: unknown) => {
      const settings = getSettings()
      if (settings === undefined) {
        throw new SidechatError('settings-rejected', 'the settings service is not mounted in this deployment', 503)
      }
      const record = payload as { patch?: unknown; expectedRevision?: unknown } | null
      const patch = record?.patch
      if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new SidechatError('bad-request', 'patch must be a plain object')
      }
      const expectedRevision = typeof record?.expectedRevision === 'number' ? record.expectedRevision : undefined
      try {
        return await settings.update(patch as Record<string, unknown>, expectedRevision)
      } catch (error) {
        if (error instanceof SettingsConflictError) {
          throw new SidechatError('settings-conflict', error.message, 409)
        }
        throw new SidechatError('settings-rejected', error instanceof Error ? error.message : String(error), 400)
      }
    },
  }
}

/** Read the connection row's trustedHosts, or empty (loopback-only fence). */
function trustedHostsOf(ctx: Context): string[] {
  const loader = ctx.get('loader') as { entries?: () => Iterable<{ options: { name: string; config?: unknown } }> } | undefined
  for (const entry of loader?.entries?.() ?? []) {
    if (entry.options.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

/** Host plugin body: register the /sidechat JSON API routes. */
export function apply(ctx: Context): void {
  const sideChats = new Map<string, SidechatRecord>()
  let settingsFace: SubchatSettingsFace | undefined

  // Settings namespaces are now Loader entry ids, including user-renamed rows.
  ctx.inject(['settings'], (sctx: Context) => {
    const ns = (ctx as Context & { entry?: { id: string } }).entry?.id
    if (ns === undefined) return
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber))
    const viewOf = (): { value?: unknown; revision?: number } => {
      const descriptor = sctx.settings.describe({ redactSecrets: true }).find((c) => c.ns === ns)
      return descriptor === undefined
        ? { value: undefined, revision: undefined }
        : { value: descriptor.value, revision: descriptor.revision }
    }
    settingsFace = {
      get: viewOf,
      update: async (patch, expectedRevision) => {
        await sctx.settings.update(ns, patch, expectedRevision)
        return viewOf()
      },
    }
    sctx.effect(() => () => { settingsFace = undefined })
  })

  const api = buildApi(ctx, sideChats, () => settingsFace)

  // Tear every live side chat down with the plugin fiber, and put back the
  // archive of any chat that was mid-turn (a live turn is lifted from the
  // archive for its duration, so an unload would otherwise leave it visible).
  ctx.effect(() => {
    return () => {
      const records = [...sideChats.values()]
      sideChats.clear()
      void (async () => {
        for (const record of records) {
          try {
            await record.handle.dispose()
          } catch {
            // A half-disposed agent must not stop the archive restore below.
          }
          try {
            await ctx.workspaceRegistry.archiveSession(record.childId)
          } catch {
            // Best-effort: a still-active session stays visible until next run.
          }
        }
      })()
    }
  }, 'dsh-side-chat: dispose side chats')

  // DSH 0.1.6 lists archived sessions in Settings and lets the user restore
  // one. A side chat is archived precisely so it stays out of the session
  // list, so at activation re-archive every recorded side chat that a restore,
  // an interrupted run (turn still open when the harness stopped), or an older
  // run left visible again. Best-effort: records whose session no longer
  // exists are simply skipped.
  ctx.effect(() => {
    void (async () => {
      for (const record of await readRecords()) {
        try {
          await ctx.workspaceRegistry.archiveSession(record.childId)
        } catch {
          // Unknown/expired ids are expected as the record list ages out.
        }
      }
    })()
  }, 'dsh-side-chat: re-archive recorded side chats')

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/sidechat/api',
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHostsOf(ctx))) {
        writeJson(res, 403, { ok: false, error: { code: 'forbidden', message: 'forbidden' } })
        return
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { ok: false, error: { code: 'method-error', message: 'method not allowed' } })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname
      const method = pathname.startsWith('/sidechat/api/') ? pathname.slice('/sidechat/api/'.length) : undefined
      if (method === undefined || method.includes('/')) {
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: 'unknown sidechat API method' } })
        return
      }
      const handler = (api as Record<string, (payload: unknown) => unknown>)[method]
      if (handler === undefined) {
        writeJson(res, 404, { ok: false, error: { code: 'not-found', message: `unknown sidechat API method "${method}"` } })
        return
      }
      try {
        const payload = await readJsonBody(req)
        writeOk(res, await handler(payload))
      } catch (error) {
        writeError(res, error)
      }
    },
  }), 'dsh-side-chat: /sidechat/api routes')
}
