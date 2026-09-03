/**
 * Structural types for the cordis services this plugin consumes, plus the
 * Context augmentation both halves share. A third-party plugin resolves
 * outside the DSH monorepo's single cordis instance, so the upstream
 * `declare module 'cordis'` augmentations do not reach this Context; the
 * members below mirror the actual runtime shapes this plugin touches.
 *
 * The `sessions` field is a union of the HOST store face (get/list) and the
 * CLIENT list feed (list.getSnapshot/subscribe): each half only touches its
 * own side, and the shared declaration keeps the two cordis instance layers
 * from colliding under one tsconfig.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from 'cordis'

/** One named webserver route. */
export interface SideWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

/** The webServer service face this plugin uses. */
export interface SideWebServer {
  register(route: SideWebRoute): () => void
}

/** A published session's header slice (authoritative cwd, lineage, origin). */
export interface SideSessionHeader {
  cwd?: string
  parentSession?: string
  origin?: 'subagent'
  delegationDepth?: number
}

/** One session event (fold source for history and permission current). */
export interface SideSessionEvent {
  type: string
  seq: number
  time: number
  data: Record<string, unknown>
  surfaceOp?: 'append' | 'replace' | 'remove'
  sourceEventSeqs?: number[]
}

/** The live session face the host reads (header + append-only event log). */
export interface SideSession {
  id: string
  header: SideSessionHeader
  events?: readonly SideSessionEvent[]
  requestHeader?: () => { config?: { provider?: string; model?: string; reasoningEffort?: string; maxTokens?: number } } | undefined
}

/** The host session store face (`ctx.sessions` host side). */
export interface SideSessionStore {
  get(id: string): SideSession | undefined
  list(): SideSession[]
}

/** One session list row (client list feed). */
export interface SideSessionSummary {
  id: string
  displayTitle: string
  cwd?: string
  origin?: 'subagent'
  parentId?: string
  running: boolean
}

/** The session list snapshot the browser half subscribes to. */
export interface SideSessionList {
  current: string | undefined
  byId: Record<string, SideSessionSummary>
}

/** One selectable answer in a user-question dialog. */
export interface SideQuestionOption {
  label: string
  description?: string
}

/** One question in a pending user-question dialog. */
export interface SideQuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: SideQuestionOption[]
  multiSelect?: boolean
}

/** A pending main-conversation interaction (question / plan-review / approval dialog). */
export interface SidePendingInteraction {
  /** Presentation discriminator: the question family, or an approval. */
  kind: 'question' | 'plan-review' | 'approval'
  /** Opaque render identity and request key (e.g. `question:1`). */
  key: string
  sessionId: string
  /** The request's question list (present for the question family). */
  questions?: SideQuestionItem[]
}

/** The per-session pending-interaction source exposed by the `uiSession` service. */
export interface SidePendingInteractionStore {
  getSnapshot(): ReadonlyMap<string, SidePendingInteraction>
  subscribe(fn: () => void): () => void
}

/** The client sessions service face (list feed + scope resolution). */
export interface SideSessionsService {
  list: {
    getSnapshot(): SideSessionList
    subscribe(fn: () => void): () => void
  }
  /** Resolve an Agent-scoped context view for a listed session id (use-and-discard). */
  scope(id: string): Context | undefined
}

/** The client UI-session service face (per-session pending interactions). */
export interface SideUiSessionService {
  /** Per-session pending UI interaction (question / plan-review / approval). */
  pendingInteractions: SidePendingInteractionStore
}

/** Agent options (provider/model/maxTokens). */
export interface SideAgentOptions {
  provider?: string
  model?: string
  maxTokens?: number
}

/** The live agent face (`ctx.agents.get(id)` / `AgentHandle.agent`). */
export interface SideAgent {
  readonly id: string
  readonly options: SideAgentOptions
  readonly session: SideSession
  readonly status: string
  readonly ctx: Context
  followup(message: unknown): void
  inject(message: unknown): void
  cancel(cause: { kind: 'user' | 'parent' | 'disposed' } | { kind: 'hook'; reason: string }): void
  whenIdle(): Promise<void>
}

/** The agent handle `ctx.agents.create` resolves (owner tears the agent down). */
export interface SideAgentHandle {
  agent: SideAgent
  dispose(): Promise<void>
}

/** `ctx.agents.create` options (mirror of CreateAgentOptions). */
export interface SideCreateAgentOptions {
  sessionId: string
  meta?: {
    cwd?: string
    parentSession?: string
    agentPreset?: string
  }
  agentOptions?: SideAgentOptions
  setup?: (agentCtx: Context) => void | Promise<void>
}

/** The host agent registry face. */
export interface SideAgentsService {
  get(id: string): SideAgent | undefined
  create(options: SideCreateAgentOptions): Promise<SideAgentHandle>
}

/** Live provider / model / reasoning-effort selection for one agent. */
export interface SideModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

/**
 * Mutable selection plus the value captured when the current step entered
 * prompt assembly (`current` / `assembled`).
 */
export interface SideModelSelectionRef {
  current: SideModelSelection | undefined
  assembled: SideModelSelection | undefined
}

/**
 * Couple a mutable selection to an agent's prompt assembly and request routing
 * (`installModelSelection` on the agent package). Typed structurally rather
 * than imported: this plugin resolves outside the DSH monorepo's single cordis
 * instance, so the upstream export is reached through a loose signature.
 */
export type SideInstallModelSelection = (agentCtx: Context, selection: SideModelSelectionRef) => () => void

/** The workspace registry face (archive a session durably). */
export interface SideWorkspaceRegistry {
  archiveSession(sessionId: string): Promise<void>
}

/** `sessionQuery.readSession` snapshot. */
export interface SideSessionLogSnapshot {
  session: SideSessionHeader
  events: SideSessionEvent[]
}

/** The session query face. */
export interface SideSessionQuery {
  readSession(sessionId: string): Promise<SideSessionLogSnapshot>
}

/** Sandbox mode vocabulary (read from the session override). */
export type SideSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

/** The sandbox policy face. */
export interface SideSandboxPolicy {
  overrideOf(session: SideSession): SideSandboxMode | undefined
}

/** One permission preset option. */
export interface SidePresetOption {
  value: string
  name: string
  description?: string
}

/** The permission presets face. */
export interface SidePermissionPresets {
  current(events: readonly SideSessionEvent[]): string
  set(session: SideSession, name: string): void
  selectFor(state: unknown): { options: SidePresetOption[]; currentValue: string }
}

/** The agent presets face (composeFrom joins a child to the parent's composition). */
export interface SideAgentPresets {
  composeFrom(agentCtx: Context, parentCtx: Context): string | undefined
}

/** One provider route. */
export interface SideLlmProvider {
  id: string
  name: string
}

/** One model entry. */
export interface SideLlmModel {
  provider: string
  id: string
  name: string
  description?: string
}

/** One reasoning-effort entry. */
export interface SideLlmEffort {
  id: string
  name: string
  description?: string
}

/** One model-request stream chunk (minimal structural view for text collection). */
export interface SideLlmStreamChunk {
  type: string
  text?: string
}

/** Minimal generate options the summarize route builds (a hand-built user prompt). */
export interface SideLlmGenerateOptions {
  provider: string
  model: string
  reasoningEffort?: string
  maxTokens?: number
  signal?: AbortSignal
  messages: Array<{
    id?: string
    role: 'user' | 'assistant' | 'system'
    content: Array<{ type: 'text'; text: string }>
    source?: { kind: string }
  }>
}

/** The llm face (model/effort catalog + one-shot streaming calls). */
export interface SideLlm {
  listProviders(): SideLlmProvider[]
  listModels(provider: string): Promise<SideLlmModel[]>
  resolveModelInfo(provider: string, model: string): Promise<{
    provider: string
    id: string
    name: string
    reasoning?: { efforts: readonly SideLlmEffort[]; defaultEffort?: string }
  }>
  stream(options: SideLlmGenerateOptions): AsyncIterable<SideLlmStreamChunk>
}

/** The client locale service face. */
export interface SideLocaleService {
  getSnapshot(): { active: string }
  subscribe(fn: () => void): () => void
  register(ns: string, locale: string, dict: Record<string, string>): () => void
}

/** The host settings service face (namespace registration + read/write). */
export interface SideSettingsService {
  register(ns: unknown, schema: unknown): { get(): unknown; watch(cb: (next: unknown, prev: unknown) => void): () => void }
  describe(opts: { redactSecrets?: boolean }): Array<{ ns: unknown; value?: unknown; revision?: number }>
  update(ns: unknown, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
}

/** The client slots service face (settings.section registration). */
export interface SideSlotsService {
  inject(name: string, factory: () => () => void): void
  register(options: Record<string, unknown>, component: unknown): () => void
}

/** One durable image reference (mirror of ImageAttachmentRef). */
export interface SideImageAttachmentRef {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
}

/** The host attachment store face (`ctx.attachments`). */
export interface SideAttachmentStore {
  readonly imageLimits: {
    maxImageBytes: number
    maxImagesPerMessage: number
    maxMessageImageBytes: number
    maxImagePixels: number
    mediaTypes: readonly string[]
  }
  validateImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<void>
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<SideImageAttachmentRef>
  readImage(ref: SideImageAttachmentRef): Promise<{ ref: SideImageAttachmentRef; data: Uint8Array }>
}

/** The host command registry face (`ctx.commands`). */
export interface SideCommandsService {
  list(agent: SideAgent): Array<{ name: string; description: string }>
  execute(agent: SideAgent, line: string, signal: AbortSignal): Promise<unknown>
}

/** The per-session composer input face this plugin writes to (draft-only). */
export interface SideSessionInput {
  /** Replace the session composer draft (never submits). */
  setDraft(text: string): void
  /** Live input state store (draft read). */
  state: { getSnapshot(): { draft: string } }
  /** Surface a notice on the session composer. */
  notify(level: 'info' | 'error', text: string): void
}

/** The conversation service face (`ctx.conversation`) — input registry only. */
export interface SideConversationService {
  input: {
    /** Resolve the input facade for one session-scope context. */
    for(actx: Context): SideSessionInput
  }
}

declare module 'cordis' {
  interface Context {
    webServer: SideWebServer
    sessions: SideSessionStore & SideSessionsService
    agents: SideAgentsService
    workspaceRegistry: SideWorkspaceRegistry
    sessionQuery: SideSessionQuery
    sandboxPolicy: SideSandboxPolicy
    permissionPresets: SidePermissionPresets
    agentPresets: SideAgentPresets
    llm: SideLlm
    locale: SideLocaleService
    settings: SideSettingsService
    slots: SideSlotsService
    attachments: SideAttachmentStore
    commands: SideCommandsService
    conversation: SideConversationService
    uiSession: SideUiSessionService
    inject(deps: string[], callback: (ctx: Context) => void): void
    get(name: string): unknown | undefined
    on(name: string, listener: (...args: any[]) => any): () => void
    effect(fn: () => void | (() => void), label?: string): void
  }
}

export type { Context }
