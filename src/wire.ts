/**
 * Wire helpers for the /sidechat JSON API: bounded body reading, response
 * writing, and the shared error envelope. Mirrors the /sidebar wire helpers
 * (loopback + trusted-host fence), kept self-contained so the plugin never
 * depends on the DSH gateway internals.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** One API failure with its wire code and HTTP status. */
export class SidechatError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

/** Body size bound of one JSON request. */
const MAX_BODY_BYTES = 1 << 20

/** Read and parse the JSON request body (bounded; malformed → bad-request). */
export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    total += buffer.length
    if (total > MAX_BODY_BYTES) {
      throw new SidechatError('bad-request', 'request body too large')
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SidechatError('bad-request', 'request body is not valid JSON')
  }
}

/** Write a JSON response with the given status. */
export function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(payload)
}

/** Write the success envelope. */
export function writeOk(res: ServerResponse, value: unknown): void {
  writeJson(res, 200, { ok: true, value })
}

/** Write the failure envelope for any thrown value (unknown → internal 500). */
export function writeError(res: ServerResponse, error: unknown): void {
  if (error instanceof SidechatError) {
    writeJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeJson(res, 500, { ok: false, error: { code: 'internal', message } })
}

/** Narrow an unknown payload value to a string, else throw bad-request. */
export function requireString(payload: unknown, key: string): string {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  if (typeof value !== 'string' || value === '') {
    throw new SidechatError('bad-request', `missing or invalid "${key}"`)
  }
  return value
}

/** Narrow an unknown payload value to a boolean (default false). */
export function optionalBoolean(payload: unknown, key: string): boolean {
  const record = payload as Record<string, unknown> | null
  const value = record?.[key]
  return value === true
}
