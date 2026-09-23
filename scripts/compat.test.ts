import { Readable } from 'node:stream'
import { expect, test, vi } from 'vitest'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { SettingsConflictError } from '@deepseek-ai/dsh-settings'
import { apply, Config } from '../src/index.ts'
import { SUBCHAT_PREFS_DEFAULTS } from '../src/settings-shared.ts'
import { migratedSession } from './v4-fixture.mjs'

function mount(options: { fiberEntry?: unknown; loaderLocate?: string; settingsNs?: string } = {}) {
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
  // The Loader puts the owning entry on the FIBER (`fiber.entry`); it is not a
  // plain `ctx.entry`. `fiberEntry: undefined` models a bare mount.
  const fiberEntry = 'fiberEntry' in options ? options.fiberEntry : { options: { id: 'custom-side-chat' } }
  const ctx: any = {
    fiber: { entry: fiberEntry },
    settings,
    get: (name: string) => name === 'loader' && options.loaderLocate !== undefined
      ? { locate: () => options.loaderLocate }
      : undefined,
    inject: (_deps, callback) => callback(ctx),
    effect: (callback, label) => label?.includes('re-archive') ? undefined : callback(),
    agents: { get: () => ({ inject }) },
    sessionQuery: { readSession: vi.fn(async () => artifact) },
    webServer: { register: (r) => { route = r; return () => {} } },
  }
  apply(ctx)
  async function call(method: string, payload = {}) {
    const req: any = Readable.from([Buffer.from(JSON.stringify(payload))])
    req.headers = { host: 'localhost' }
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
