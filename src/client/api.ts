/**
 * Client API client for the /sidechat JSON routes (same fetch pattern the
 * better-sidebar built-ins use). All requests are same-origin POSTs; the host
 * fence (loopback/trusted authority) passes them naturally.
 */

/** One API failure envelope. */
export interface SidechatApiError {
  code: string
  message: string
}

/** The unwrapped success value of one API method. */
export type SidechatResult<T> = { ok: true; value: T } | { ok: false; error: SidechatApiError }

/** Side-chat list row. */
export interface SidechatListItem {
  childId: string
  running: boolean
  runningSince?: number
}

/** Browser-submitted prompt content part (text or base64 image). */
export type PromptContentPart = { type: 'text'; text: string } | { type: 'image'; mediaType: string; data: string; name?: string }

/** One durable image reference returned by the host transcript. */
export interface SidechatImageRef {
  attachmentId: string
  mediaType: string
  bytes: number
  width: number
  height: number
  name?: string
}

/** One transcript message block. */
export type SidechatMessageBlock = { type: 'text'; text: string } | { type: 'image'; ref: SidechatImageRef } | { type: 'reasoning'; text: string }

/** One transcript message. */
export interface SidechatMessage {
  role: 'user' | 'assistant'
  blocks: SidechatMessageBlock[]
}

/** Model / effort directory (provider groups → models → reasoning efforts). */
export interface SidechatDirectory {
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
}

/** Permission options. */
export interface SidechatPermissions {
  options: Array<{ value: string; name: string; description?: string }>
  current: string
}

/** Call one /sidechat/api method. */
async function call<T>(method: string, payload: Record<string, unknown>): Promise<SidechatResult<T>> {
  const res = await fetch(`/sidechat/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return (await res.json()) as SidechatResult<T>
}

export const api = {
  start: (args: { parentSessionId: string; content: PromptContentPart[]; lookupEnabled: boolean; provider?: string; model?: string; reasoningEffort?: string; preset?: string }) =>
    call<{ childId: string; provider: string; model: string; reasoningEffort?: string }>('sidechat.start', args),
  followup: (args: { childId: string; content: PromptContentPart[]; lookupEnabled: boolean }) =>
    call<{ accepted: true }>('sidechat.followup', args),
  list: (args: { parentSessionId: string }) =>
    call<{ items: SidechatListItem[] }>('sidechat.list', args),
  history: (args: { childId: string }) =>
    call<{ messages: SidechatMessage[] }>('sidechat.history', args),
  stop: (args: { childId: string }) =>
    call<{ accepted: true }>('sidechat.stop', args),
  selectModel: (args: { childId: string; provider: string; model: string; reasoningEffort?: string }) =>
    call<{ accepted: true }>('sidechat.selectModel', args),
  selectPermission: (args: { childId: string; presetName: string }) =>
    call<{ accepted: true }>('sidechat.selectPermission', args),
  summarize: (args: { parentSessionId: string; text: string; provider?: string; model?: string; reasoningEffort?: string; locale?: string }) =>
    call<{ summary: string }>('sidechat.summarize', args),
  directory: () => call<SidechatDirectory>('sidechat.directory', {}),
  permissions: () => call<SidechatPermissions>('sidechat.permissions', {}),
  limits: () => call<{ mediaTypes: string[]; maxImageBytes: number; maxImagesPerMessage: number; maxMessageImageBytes: number; maxImagePixels: number }>('sidechat.limits', {}),
  attachment: (args: { childId: string; attachmentId: string }) =>
    call<{ mediaType: string; data: string }>('sidechat.attachment', args),
  inherit: (args: { parentSessionId: string }) =>
    call<{ provider: string; model: string; reasoningEffort?: string }>('sidechat.inherit', args),
  commands: (args: { childId: string }) =>
    call<{ commands: Array<{ name: string; description: string }> }>('sidechat.commands', args),
  command: (args: { childId: string; line: string }) =>
    call<{ executed: boolean }>('sidechat.command', args),
  state: (args: { childId: string }) =>
    call<{ plan: { active: boolean; pending: boolean }; goal: { id: string; objective: string } | null }>('sidechat.state', args),
  settingsGet: () => call<{ value?: unknown; revision?: number }>('settings.get', {}),
  settingsUpdate: (patch: Record<string, unknown>, expectedRevision?: number) =>
    call<{ value?: unknown; revision?: number }>('settings.update', { patch, expectedRevision }),
  dispose: (args: { childId: string }) =>
    call<{ accepted: true }>('sidechat.dispose', args),
}
