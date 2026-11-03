import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { expect, test, vi } from 'vitest'
import * as agentPackage from '@deepseek-ai/dsh-agent'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { apply, Config } from '../src/index.ts'
import { SUBCHAT_PREFS_DEFAULTS } from '../src/settings-shared.ts'
import { migratedSession } from './v4-fixture.mjs'

// The host half persists its side-chat record list under the harness home; point
// that at a throwaway directory so a test run never rewrites the real profile.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-side-chat-test-'))

/** Whether the installed agent package is the 0.2.2+ durable-selection line. */
const durableSelectionRuntime = typeof (agentPackage as unknown as { AgentModel?: unknown }).AgentModel === 'function'

function mount(options: {
  fiberEntry?: unknown
  loaderLocate?: string
  settingsNs?: string
  /** Loader rows the host half scans for the `connection` authorities. */
  loaderEntries?: Array<{ options: { id?: string; name?: string; config?: unknown } }>
  /** The `webStartup` service face (0.2.1-rc.1 authority source). */
  webStartup?: { trustedHosts?: unknown }
  /** The webserver service's bind address and listener protocol. */
  bindHost?: string
  protocol?: 'http:' | 'https:'
  /** `agents.create` implementation, or undefined to model a host that cannot create one. */
  agentsCreate?: (options: any) => Promise<any>
  /** The launching agent the routes resolve (`parent` by default). */
  parentAgent?: any
} = {}) {
  let route: any
  let revision = 0
  let value = { ...SUBCHAT_PREFS_DEFAULTS }
  const ns = options.settingsNs ?? 'custom-side-chat'
  const inject = vi.fn()
  const settings = {
    configure: vi.fn(() => () => {}),
    describe: () => [{ ns, value, revision }],
    update: vi.fn(async (called: unknown, patch, expected) => {
      expect(called).toBe(ns)
      if (expected !== revision) throw new SettingsConflictError(ns, expected, revision)
      value = { ...value, ...patch }
      revision++
    }),
  }
  const artifact = migratedSession()
  /** The launching conversation: inherits a route through the request header on the 0.2.1 line. */
  const parentAgent = options.parentAgent ?? {
    id: 'parent',
    options: { provider: 'inherited-provider', model: 'inherited-model', maxTokens: 4096 },
    session: {
      id: 'parent',
      header: { cwd: 'work' },
      requestHeader: () => ({ config: { provider: 'inherited-provider', model: 'inherited-model', reasoningEffort: 'high', maxTokens: 4096 } }),
    },
    ctx: {},
    inject,
  }
  // The Loader puts the owning entry on the FIBER (`fiber.entry`); it is not a
  // plain `ctx.entry`. `fiberEntry: undefined` models a bare mount.
  const fiberEntry = 'fiberEntry' in options ? options.fiberEntry : { options: { id: 'custom-side-chat' } }
  const ctx: any = {
    fiber: { entry: fiberEntry },
    settings,
    get: (name: string) => {
      if (name === 'webStartup') return options.webStartup
      if (name !== 'loader') return undefined
      if (options.loaderLocate === undefined && options.loaderEntries === undefined) return undefined
      return {
        ...(options.loaderLocate !== undefined ? { locate: () => options.loaderLocate } : {}),
        ...(options.loaderEntries !== undefined ? { entries: () => options.loaderEntries! } : {}),
      }
    },
    inject: (_deps, callback) => callback(ctx),
    effect: (callback, label) => label?.includes('re-archive') ? undefined : callback(),
    agents: {
      get: (id: string) => (id === 'parent' ? parentAgent : undefined),
      create: async (createOptions: any) => {
        if (options.agentsCreate === undefined) throw new Error('agents.create is not stubbed')
        return options.agentsCreate(createOptions)
      },
    },
    agentPresets: { composeFrom: vi.fn() },
    permissionPresets: { current: () => 'custom', set: vi.fn(), catalog: () => ({ options: [] }) },
    attachments: {
      imageLimits: { maxImagesPerMessage: 5, maxMessageImageBytes: 10_000_000, mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] },
      validateImage: vi.fn(),
      saveImage: vi.fn(),
      readImage: vi.fn(),
    },
    workspaceRegistry: { archiveSession: vi.fn(async () => {}), unarchiveSession: vi.fn(async () => {}) },
    sessionQuery: { readSession: vi.fn(async () => artifact) },
    webServer: {
      register: (r) => { route = r; return () => {} },
      host: options.bindHost,
      protocol: options.protocol,
    },
  }
  apply(ctx)
  async function call(method: string, payload = {}, headers: Record<string, string> = { host: 'localhost' }) {
    const req: any = Readable.from([Buffer.from(JSON.stringify(payload))])
    req.headers = headers
    req.method = 'POST'
    req.url = `/sidechat/api/${method}`
    let status: number | undefined, body: any
    await route.handler(req, {
      writeHead: (s) => { status = s }, end: (s) => { body = JSON.parse(s) },
    })
    return { status, body }
  }
  return { call, inject, settings, ctx }
}

test('settings are volatile profile fields and custom entry ids round-trip with conflict detection', async () => {
  expect(Config.meta.volatile).toBe(true)
  const { call, settings, ctx } = mount()
  expect(settings.configure).toHaveBeenCalledWith({ auto: false }, ctx.fiber)
  expect((await call('settings.get')).body.value.value).toEqual(SUBCHAT_PREFS_DEFAULTS)
  const result = await call('settings.update', { patch: { panelHome: 'floating' }, expectedRevision: 0 })
  expect(result.status).toBe(200)
  expect(result.body.value).toMatchObject({ value: { panelHome: 'floating' }, revision: 1 })
  expect((await call('settings.update', { patch: {}, expectedRevision: 0 })).status).toBe(409)
})

test('the settings namespace comes from the owning Loader entry on the fiber', async () => {
  // A context-level `entry` is not a thing at runtime: reading one silently
  // unbound the settings face and left every preference unwritable.
  const { call, settings } = mount({
    fiberEntry: { id: 'renamed-entry', options: { id: 'renamed-entry' } },
    settingsNs: 'renamed-entry',
  })
  expect(settings.configure).toHaveBeenCalledTimes(1)
  expect((await call('settings.get')).body.value.value).toEqual(SUBCHAT_PREFS_DEFAULTS)
  expect((await call('settings.update', { patch: { lookupDefault: true }, expectedRevision: 0 })).status).toBe(200)
})

test('a bare mount without an owning entry leaves preferences unavailable but keeps the routes alive', async () => {
  const { call, settings } = mount({ fiberEntry: undefined })
  expect(settings.configure).not.toHaveBeenCalled()
  expect((await call('settings.get')).body.value).toEqual({})
  expect((await call('settings.update', { patch: { lookupDefault: true } })).status).toBe(503)
})

test('a loader that reports the owner id is used when the fiber carries none', async () => {
  const { call, settings } = mount({
    fiberEntry: undefined,
    loaderLocate: 'located-entry',
    settingsNs: 'located-entry',
  })
  expect(settings.configure).toHaveBeenCalledTimes(1)
  expect((await call('settings.get')).body.value.value).toEqual(SUBCHAT_PREFS_DEFAULTS)
})

test('bring-back writes a native V4 source that survives strict persistence validation', async () => {
  const { call, inject } = mount()
  expect((await call('sidechat.inject', { parentSessionId: 'parent', text: 'answer' })).status).toBe(200)
  const message = inject.mock.calls[0][0]
  expect(message.source.kind).toBe('plugin:dsh-side-chat')
  const restore = sessionFormatCatalog.createRestore({ type: 'session', version: 4, id: 'parent', createdAt: 1, isSeeded: false, delegationDepth: 0 }, { recovery: 'strict', validation: 'current' })
  restore.decodeRow({ type: 'user/message', seq: 0, time: 2, data: message, surfaceOp: 'append' })
  expect(restore.finish().events[0].data).toEqual(message)
  const old = sessionFormatCatalog.createRestore({ type: 'session', version: 4, id: 'parent', createdAt: 1, isSeeded: false, delegationDepth: 0 }, { recovery: 'strict', validation: 'current' })
  expect(() => old.decodeRow({ type: 'user/message', seq: 0, time: 2, data: { ...message, source: { kind: 'plugin', plugin: 'dsh-side-chat' } }, surfaceOp: 'append' })).toThrow()
})

test('history reads migrated V3/V4 events and excludes producer-owned injected context', async () => {
  const { call, ctx } = mount()
  const result = await call('sidechat.history', { childId: 'compat' })
  expect(result.status).toBe(200)
  expect(ctx.sessionQuery.readSession).toHaveBeenCalledWith('compat')
  expect(result.body.value.messages).toEqual([{ role: 'user', blocks: [{ type: 'text', text: 'continue' }] }])
})

test('a remote authority reaches the routes only when the runtime declares it', async () => {
  const remote = { host: 'app.internal:8443' }
  expect((await mount().call('settings.get', {}, remote)).status).toBe(403)
  // 0.2.1-rc.1 resolves each --trusted-host value into the webStartup service.
  const startup = mount({ webStartup: { trustedHosts: ['app.internal'] } })
  expect((await startup.call('settings.get', {}, remote)).status).toBe(200)
  // The 0.2.0 line instead resolves webRuntime.trustedHosts into the connection row.
  const row = mount({ loaderEntries: [{ options: { id: 'connection', name: '@deepseek-ai/dsh-client-connection', config: { trustedHosts: ['app.internal'] } } }] })
  expect((await row.call('settings.get', {}, remote)).status).toBe(200)
})

test('the listener bind literal is reachable without a declared authority', async () => {
  const literal = { host: '10.0.0.7:3080' }
  expect((await mount({ bindHost: '10.0.0.7' }).call('settings.get', {}, literal)).status).toBe(200)
  expect((await mount().call('settings.get', {}, literal)).status).toBe(403)
})

test.skipIf(!durableSelectionRuntime)('a 0.2.2+ side chat records its model choice durably instead of rewriting request config', async () => {
  // DSH 0.2.2-alpha.3 moved the live choice onto the agent: `installModelSelection`
  // now takes no selection, and the loop THROWS when an `agent/request` listener
  // proposes a route different from the step's fixed selection. A plugin still
  // passing the mutable ref would keep compiling while silently ignoring every
  // switch, so assert both halves of the contract.
  const select = vi.fn()
  const followup = vi.fn()
  let setupCtx: any
  const { call } = mount({
    agentsCreate: async (createOptions: any) => {
      setupCtx = { on: vi.fn(() => () => {}) }
      await createOptions.setup?.(setupCtx)
      const sessionId = createOptions.sessionId
      return {
        agent: {
          id: sessionId,
          options: createOptions.agentOptions,
          session: { id: sessionId, header: {} },
          status: 'idle',
          ctx: {},
          model: { select },
          followup,
          inject: vi.fn(),
          cancel: vi.fn(),
          whenIdle: async () => {},
        },
        dispose: async () => {},
      }
    },
  })
  const started = await call('sidechat.start', { parentSessionId: 'parent', content: [{ type: 'text', text: 'hi' }] })
  expect(started.status).toBe(200)
  expect(select).toHaveBeenCalledWith({ provider: 'inherited-provider', model: 'inherited-model', reasoningEffort: 'high' })
  expect(setupCtx.on.mock.calls.every(([name]: [string]) => name !== 'agent/request')).toBe(true)
  await call('sidechat.selectModel', { childId: started.body.value.childId, provider: 'other-provider', model: 'other-model' })
  expect(select).toHaveBeenLastCalledWith({ provider: 'other-provider', model: 'other-model' })
})

test('the launching route comes from the parent agent durable selection when recorded', async () => {
  // A model switched in the main conversation is recorded on the agent and only
  // reaches `requestHeader()` after the next request, so a side chat launched
  // right after the switch must read the durable choice.
  const { call } = mount({
    parentAgent: {
      id: 'parent',
      options: { provider: 'stale-provider', model: 'stale-model' },
      session: {
        id: 'parent',
        header: {},
        requestHeader: () => ({ config: { provider: 'stale-provider', model: 'stale-model', reasoningEffort: 'low' } }),
      },
      model: { current: () => ({ provider: 'switched-provider', model: 'switched-model', reasoningEffort: 'high' }) },
      ctx: {},
      inject: vi.fn(),
    },
  })
  const inherited = await call('sidechat.inherit', { parentSessionId: 'parent' })
  expect(inherited.body.value).toEqual({ provider: 'switched-provider', model: 'switched-model', reasoningEffort: 'high' })
})

test('an unevaluated !!js authority node refuses the request instead of failing it', async () => {
  // A Loader row keeps `!!js ctx.webStartup.trustedHosts` as a raw node; reading
  // it as an array would throw inside the fence and answer 500.
  const node = { __jsExpr: 'ctx.webStartup.trustedHosts' }
  const { call } = mount({ loaderEntries: [{ options: { id: 'connection', config: { trustedHosts: node } } }] })
  expect((await call('settings.get', {}, { host: 'app.internal' })).status).toBe(403)
  expect((await call('settings.get')).status).toBe(200)
})
