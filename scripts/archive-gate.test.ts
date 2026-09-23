/**
 * DSH 0.1.7 admits no model step for a session in the workspace archive set:
 * its archived-session gate answers `{ kind: 'reject' }` on `agent/pre-step`,
 * which ends the turn as `blocked` before the first request. A side chat is
 * archived to stay out of every list, so the host half must lift that archive
 * for exactly as long as a turn has to run and restore it once the agent
 * settles. These tests pin that flow: unarchive strictly before the delivery,
 * no archive while a turn is outstanding, archive again at the last settle.
 */
import { Readable } from 'node:stream'
import { expect, test, vi } from 'vitest'

const home = vi.hoisted(() => `${process.env.TEMP ?? process.env.TMP ?? '/tmp'}/dsh-side-chat-archive-gate-test`)

// Keep the durable record file out of the real harness home.
vi.mock('@deepseek-ai/dsh-home-paths', () => ({
  dshHomePath: (...parts: string[]) => [home, ...parts].join('/'),
}))

// The model-selection installer is a DSH-monorepo export; the request-only
// fallback path is enough here and needs nothing from the agent context.
vi.mock('@deepseek-ai/dsh-agent', () => ({ installModelSelection: undefined }))

const { apply } = await import('../src/index.ts')

interface Harness {
  call: (method: string, payload?: unknown) => Promise<{ status?: number; body: any }>
  log: string[]
  settle: (childId: string) => Promise<void>
}

function mount(options: { failUnarchive?: boolean } = {}): Harness {
  const log: string[] = []
  const idle = new Map<string, Array<() => void>>()
  const agents = new Map<string, any>()
  let route: any

  agents.set('parent-1', {
    id: 'parent-1',
    status: 'idle',
    options: { provider: 'hyper', model: 'v4', maxTokens: 4096 },
    session: {
      header: { cwd: 'C:/work' },
      requestHeader: () => ({ config: { provider: 'hyper', model: 'v4', reasoningEffort: 'high' } }),
    },
    ctx: {},
    followup: vi.fn(),
    inject: vi.fn(),
    cancel: vi.fn(),
    whenIdle: async () => {},
  })

  const ctx: any = {
    // The Loader records the owning entry on the FIBER; a bare `ctx.entry` does
    // not exist at runtime (see settingsNamespaceOf).
    fiber: { entry: { options: { id: 'side-chat-entry' } } },
    get: () => undefined,
    inject: () => {},
    effect: (callback: () => unknown, label?: string) => {
      if (label?.includes('re-archive')) return undefined
      callback()
      return undefined
    },
    agents: {
      get: (id: string) => agents.get(id),
      create: async (options: any) => {
        const agent = {
          id: options.sessionId,
          status: 'idle',
          options: options.agentOptions,
          session: { id: options.sessionId },
          ctx: {},
          followup: () => { log.push(`followup:${options.sessionId}`) },
          inject: vi.fn(),
          cancel: vi.fn(),
          whenIdle: () => new Promise<void>((resolve) => {
            const queue = idle.get(options.sessionId) ?? []
            queue.push(resolve)
            idle.set(options.sessionId, queue)
          }),
        }
        agents.set(options.sessionId, agent)
        options.setup?.({ on: () => {} })
        return { agent, dispose: async () => { log.push(`dispose:${options.sessionId}`) } }
      },
    },
    workspaceRegistry: {
      archiveSession: async (id: string) => { log.push(`archive:${id}`) },
      unarchiveSession: async (id: string) => {
        log.push(`unarchive:${id}`)
        if (options.failUnarchive === true) throw new Error('registry unavailable')
      },
    },
    permissionPresets: { current: () => 'workspace-write', set: () => {} },
    agentPresets: { composeFrom: () => undefined },
    attachments: { imageLimits: { maxImagesPerMessage: 4 } },
    sessions: { get: () => undefined },
    webServer: { register: (registered: unknown) => { route = registered; return () => {} } },
  }

  apply(ctx)

  const settle = async (childId: string) => {
    const queue = idle.get(childId) ?? []
    const next = queue.shift()
    idle.set(childId, queue)
    next?.()
    // Let the settle continuation and the queued registry write run.
    await new Promise((resolve) => setImmediate(resolve))
    await new Promise((resolve) => setImmediate(resolve))
  }

  const call = async (method: string, payload: unknown = {}) => {
    const req: any = Readable.from([Buffer.from(JSON.stringify(payload))])
    req.headers = { host: 'localhost' }
    req.method = 'POST'
    req.url = `/sidechat/api/${method}`
    let status: number | undefined
    let body: any
    await route.handler(req, {
      writeHead: (code: number) => { status = code },
      end: (chunk: string) => { body = JSON.parse(chunk) },
    })
    return { status, body }
  }

  return { call, log, settle }
}

test('the first prompt is delivered only after the session is unarchived, and re-archived at settle', async () => {
  const h = mount()
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [{ type: 'text', text: 'hello' }],
  })
  expect(started.status).toBe(200)
  const childId = started.body.value.childId

  // Unarchive strictly precedes the delivery that opens the turn; archiving
  // before it is exactly what DSH 0.1.7 answers with `blocked`.
  expect(h.log).toEqual([`unarchive:${childId}`, `followup:${childId}`])

  await h.settle(childId)
  expect(h.log).toEqual([`unarchive:${childId}`, `followup:${childId}`, `archive:${childId}`])
})

test('a followup sent mid-turn keeps the session unarchived until the last settle', async () => {
  const h = mount()
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [{ type: 'text', text: 'first' }],
  })
  const childId = started.body.value.childId
  await h.call('sidechat.followup', { childId, content: [{ type: 'text', text: 'second' }] })
  expect(h.log).toEqual([`unarchive:${childId}`, `followup:${childId}`, `unarchive:${childId}`, `followup:${childId}`])

  // The first turn settling must not hide a session the second turn still runs in.
  await h.settle(childId)
  expect(h.log).not.toContain(`archive:${childId}`)

  await h.settle(childId)
  expect(h.log).toEqual([
    `unarchive:${childId}`,
    `followup:${childId}`,
    `unarchive:${childId}`,
    `followup:${childId}`,
    `archive:${childId}`,
  ])
})

test('a later turn re-lifts the archive the previous settle restored', async () => {
  const h = mount()
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [{ type: 'text', text: 'first' }],
  })
  const childId = started.body.value.childId
  await h.settle(childId)
  await h.call('sidechat.followup', { childId, content: [{ type: 'text', text: 'again' }] })

  expect(h.log.slice(-2)).toEqual([`unarchive:${childId}`, `followup:${childId}`])
  await h.settle(childId)
  expect(h.log.filter((entry) => entry === `archive:${childId}`)).toHaveLength(2)
})

test('a failed restore refuses the delivery instead of opening a turn the gate would block', async () => {
  const h = mount({ failUnarchive: true })
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [{ type: 'text', text: 'hello' }],
  })

  expect(started.status).not.toBe(200)
  expect(h.log.some((entry) => entry.startsWith('followup:'))).toBe(false)
})
