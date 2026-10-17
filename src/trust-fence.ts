/**
 * Browser-trust fence for the /sidechat routes, behaviorally identical to the
 * /api gateway's fence (dsh-client-connection's `api-request-trust`).
 *
 * DSH 0.2.1-rc.1 widened that fence in two ways this copy has to follow:
 *
 * 1. The listener's own bind IP literal is accepted on any port, independently
 *    of `trustedHosts` (`--host 10.0.0.7` then browsing that literal). The
 *    0.2.0 line instead folded LAN literals into `trustedHosts` through the
 *    `webRuntime` service, which is why this fence takes the bind address as an
 *    explicit input rather than inferring it from the authority list.
 * 2. Host and Origin normalize through the listener protocol (`--tls-cert`),
 *    so a default port is stripped under the scheme that actually served the
 *    request rather than always under `http:`.
 *
 * The declared authorities themselves moved from `webRuntime.trustedHosts` to
 * `webStartup.trustedHosts`; the host half resolves them (see `trustedHostsOf`)
 * and this module stays a pure decision function.
 *
 * Self-contained copy, since the DSH connection package exports no such helper
 * through a specifier a third-party host plugin may import.
 */
import type { IncomingHttpHeaders } from 'node:http'

/** One request's trust-relevant facts (headers only). */
export interface ApiTrustRequest {
  headers: IncomingHttpHeaders
}

/** Listener protocol, matching the webserver's own vocabulary. */
export type ApiTrustProtocol = 'http:' | 'https:'

/** The listener protocol assumed when a runtime exposes none (pre-0.2.1 DSH). */
export const DEFAULT_TRUST_PROTOCOL: ApiTrustProtocol = 'http:'

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function parseAuthority(authority: string, scheme: ApiTrustProtocol = DEFAULT_TRUST_PROTOCOL): URL | undefined {
  try {
    return new URL(`${scheme}//${authority}`)
  } catch {
    return undefined
  }
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Text of an entry's authority as it compares against a request authority.
 * A port the entry names explicitly is kept; a port the entry omits resolves
 * through the opposite scheme's default, so `host:80` reads as an exact
 * authority while a bare `host` stays port-less and matches any port.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const opposite: ApiTrustProtocol = entryUrl.protocol === 'http:' ? 'https:' : 'http:'
  const port = entryUrl.port !== '' ? entryUrl.port : parseAuthority(entry, opposite)?.port ?? ''
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[], protocol: ApiTrustProtocol): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry, protocol)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Whether a parsed authority names the deployment's own bind address. A browser
 * dialing that literal sends it as Host, and accepting it grants nothing
 * further: the literal is no rebinding target, the Origin and cross-site checks
 * still apply, and it stays outside `trustedHosts`. Matching ignores the port,
 * like a port-less entry, and any `%zone` id (an interface selector, not
 * address text).
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Compare Host under the Origin's HTTP(S) scheme so default ports normalize
 * consistently. The transport may remain HTTP behind an HTTPS proxy.
 */
function isSameAuthorityOrigin(origin: string, host: string): boolean {
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return false
  }
  const scheme: ApiTrustProtocol | undefined = originUrl.protocol === 'https:'
    ? 'https:'
    : originUrl.protocol === 'http:'
      ? 'http:'
      : undefined
  if (scheme === undefined) return false
  const hostUrl = parseAuthority(host, scheme)
  return hostUrl !== undefined && originUrl.host === hostUrl.host
}

/**
 * Decide whether one sidechat request may reach the plugin routes.
 * @param request - node HTTP request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @param bindHost - the listener's own bind IP literal, accepted on any port independently of `trustedHosts`.
 * @param protocol - listener protocol for default Host ports; HTTP when the runtime exposes none.
 * @returns true when the Host is ours (loopback, the bind address, or trusted) and browser markers are same-origin.
 */
export function isTrustedApiRequest(
  request: ApiTrustRequest,
  trustedHosts: readonly string[],
  bindHost?: string,
  protocol: ApiTrustProtocol = DEFAULT_TRUST_PROTOCOL,
): boolean {
  const host = header(request.headers, 'host')
  if (host === undefined) return false
  const hostUrl = parseAuthority(host, protocol)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname)
    && !isTrustedAuthority(hostUrl, trustedHosts, protocol)
    && !isBindAddressAuthority(hostUrl, bindHost)) return false
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return true
  return isSameAuthorityOrigin(origin, host)
}
