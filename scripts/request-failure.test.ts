/**
 * Regression tests for the two request paths that used to fail as host faults:
 *
 * - `sidechat.start` validated and stored the prompt's images AFTER the side
 *   chat had been created and recorded, so a rejected image answered 500 and
 *   left a live, empty side chat (plus a persisted record) behind for a request
 *   that never ran.
 * - `sidechat.history` let the session-query "not found" error escape as a 500
 *   `internal`, even though a missing side chat is an ordinary client-side
 *   absence.
 */
import { Readable } from 'node:stream'
import { expect, test, vi } from 'vitest'

const home = vi.hoisted(() => `${process.env.TEMP ?? process.env.TMP ?? '/tmp'}/dsh-side-chat-request-failure-test`)

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
  created: () => string[]
}

function mount(options: { rejectImages?: boolean; readFailure?: Error } = {}): Harness {
  const created: string[] = []
  let route: any

  const ctx: any = {
    fiber: { entry: { options: { id: 'side-chat-entry' } } },
    get: () => undefined,
    inject: () => {},
    effect: (callback: () => unknown, label?: string) => {
      if (label?.includes('re-archive')) return undefined
      callback()
      return undefined
    },
    agents: {
      get: (id: string) => (id === 'parent-1'
        ? {
            id,
            status: 'idle',
            options: { provider: 'hyper', model: 'v4' },
            session: { header: { cwd: 'C:/work' }, requestHeader: () => ({ config: { provider: 'hyper', model: 'v4' } }) },
            ctx: {},
            followup: vi.fn(),
            inject: vi.fn(),
            cancel: vi.fn(),
            whenIdle: async () => {},
          }
        : undefined),
      create: async (opts: any) => {
        created.push(opts.sessionId)
        const agent = {
          id: opts.sessionId,
          status: 'idle',
          options: opts.agentOptions,
          session: { id: opts.sessionId },
          ctx: {},
          followup: vi.fn(),
          inject: vi.fn(),
          cancel: vi.fn(),
          whenIdle: async () => {},
        }
        opts.setup?.({ on: () => {} })
        return { agent, dispose: async () => {} }
      },
    },
    workspaceRegistry: { archiveSession: async () => {}, unarchiveSession: async () => {} },
    permissionPresets: { current: () => 'workspace-write', set: () => {} },
    agentPresets: { composeFrom: () => undefined },
    attachments: {
      imageLimits: { maxImagesPerMessage: 4 },
      validateImage: async () => {
        if (options.rejectImages === true) throw new Error('Unsupported or malformed image data.')
      },
      saveImage: async () => ({ attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 1, width: 1, height: 1 }),
    },
    sessionQuery: {
      readSession: async (id: string) => {
        if (options.readFailure !== undefined) throw options.readFailure
        return { session: { id }, events: [] }
      },
    },
    sessions: { get: () => undefined },
    webServer: { register: (registered: unknown) => { route = registered; return () => {} } },
  }

  apply(ctx)

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

  return { call, created: () => created }
}

test('a rejected prompt image answers 400 and never leaves a side chat behind', async () => {
  const h = mount({ rejectImages: true })
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [
      { type: 'text', text: 'what is in this image?' },
      { type: 'image', mediaType: 'image/png', data: 'bm90LWFuLWltYWdl' },
    ],
  })

  expect(started.status).toBe(400)
  expect(started.body.error).toEqual({ code: 'bad-image', message: 'Unsupported or malformed image data.' })
  // No agent was created for a prompt that never ran, so no ghost side chat
  // shows up in the panel list either.
  expect(h.created()).toEqual([])
  expect((await h.call('sidechat.list', { parentSessionId: 'parent-1' })).body.value.items).toEqual([])
})

test('history on a missing side chat is a 404, not a host fault', async () => {
  const h = mount({ readFailure: new Error('session "gone" not found') })
  const result = await h.call('sidechat.history', { childId: 'gone' })

  expect(result.status).toBe(404)
  expect(result.body.error).toEqual({ code: 'not-found', message: 'session "gone" not found' })
})

test('a valid image prompt still starts a side chat', async () => {
  const h = mount()
  const started = await h.call('sidechat.start', {
    parentSessionId: 'parent-1',
    content: [
      { type: 'text', text: 'what is in this image?' },
      { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
    ],
  })

  expect(started.status).toBe(200)
  expect(h.created()).toHaveLength(1)
})
