/**
 * Guard the 0.2.1-line model-selection path.
 *
 * DSH 0.2.2-alpha.3 replaced the coupled installer (mutable ref → prompt
 * assembly + `agent/request`) with a durable `agent.model.select()` choice,
 * and the new installer takes no selection. This plugin supports both lines
 * through one capability probe, so the FLOOR line (0.2.1-rc.1, no `AgentModel`
 * export) must still install the two-argument coupler — otherwise a side chat
 * on the oldest supported runtime would assemble prompts for one route and
 * call another.
 */
import { Readable } from 'node:stream'
import { expect, test, vi } from 'vitest'

const { coupler } = vi.hoisted(() => ({ coupler: vi.fn(() => () => {}) }))

// A 0.2.1-shaped agent package: the coupled installer only, no `AgentModel`.
vi.mock('@deepseek-ai/dsh-agent', () => ({ installModelSelection: coupler }))

const { apply } = await import('../src/index.ts')

function mount() {
  let route: any
  const followup = vi.fn()
  const parent = {
    id: 'parent',
    options: { provider: 'p1', model: 'm1' },
    session: {
      id: 'parent',
      header: {},
      requestHeader: () => ({ config: { provider: 'p1', model: 'm1', reasoningEffort: 'high' } }),
    },
    ctx: {},
    inject: vi.fn(),
  }
  const ctx: any = {
    fiber: { entry: { options: { id: 'side-chat' } } },
    settings: {
      configure: () => () => {},
      describe: () => [],
      update: vi.fn(),
    },
    get: () => undefined,
    inject: (_deps: unknown, callback: (c: any) => void) => callback(ctx),
    effect: (callback: () => unknown) => callback(),
    agents: {
      get: (id: string) => (id === 'parent' ? parent : undefined),
      create: async (createOptions: any) => {
        await createOptions.setup?.({ on: vi.fn(() => () => {}) })
        const id = createOptions.sessionId
        return {
          agent: {
            id,
            options: createOptions.agentOptions,
            session: { id, header: {} },
            status: 'idle',
            ctx: {},
            followup,
            inject: vi.fn(),
            cancel: vi.fn(),
            whenIdle: async () => {},
          },
          dispose: async () => {},
        }
      },
    },
    agentPresets: { composeFrom: vi.fn() },
    permissionPresets: { current: () => 'custom', set: vi.fn() },
    attachments: { imageLimits: { maxImagesPerMessage: 5, maxMessageImageBytes: 1_000_000, mediaTypes: ['image/png'] } },
    workspaceRegistry: { archiveSession: async () => {}, unarchiveSession: async () => {} },
    sessionQuery: { readSession: async () => ({ session: {}, events: [] }) },
    webServer: { register: (r: any) => { route = r; return () => {} } },
  }
  apply(ctx)
  return {
    async start() {
      const req: any = Readable.from([Buffer.from(JSON.stringify({ parentSessionId: 'parent', content: [{ type: 'text', text: 'hi' }] }))])
      req.headers = { host: 'localhost' }
      req.method = 'POST'
      req.url = '/sidechat/api/sidechat.start'
      let status: number | undefined
      let body: any
      await route.handler(req, { writeHead: (s: number) => { status = s }, end: (s: string) => { body = JSON.parse(s) } })
      return { status, body }
    },
  }
}

test('the 0.2.1 line still receives the mutable selection ref', async () => {
  process.env.DSH_HOME = process.env.DSH_HOME ?? 'C:\\Temp'
  const started = await mount().start()
  expect(started.status).toBe(200)
  expect(coupler).toHaveBeenCalledTimes(1)
  const [agentCtx, selection] = coupler.mock.calls[0] as any
  expect(agentCtx).toBeDefined()
  expect(selection.current).toEqual({ provider: 'p1', model: 'm1', reasoningEffort: 'high' })
})
