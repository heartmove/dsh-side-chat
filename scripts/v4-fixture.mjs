import { createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'

// A released V3 session restarted after a settled step without turn/end.
export function migratedSession() {
  const catalog = createSessionFormatCatalogWithChildren([])
  const restore = catalog.createRestore({ type: 'session', version: 3, id: 'compat', createdAt: 1, isSeeded: false, delegationDepth: 0 }, { recovery: 'strict', validation: 'current' })
  const user = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }
  const rows = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { ...user, source: { kind: 'plugin', plugin: 'dsh-side-chat', form: 'notice', summary: 'note' } }, surfaceOp: 'append' },
    { type: 'agent/inbox/spliced', data: { target: 'next-turn', removed: [], inserted: [user] } },
    { type: 'turn/start', data: { turn: 2 } },
    { type: 'user/message', data: user, surfaceOp: 'append' },
    { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ]
  rows.forEach((row, seq) => restore.decodeRow({ ...row, seq, time: seq + 2 }))
  return restore.finish()
}
