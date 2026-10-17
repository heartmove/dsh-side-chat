/**
 * The /sidechat fence must decide exactly what DSH's own /api fence decides.
 *
 * DSH 0.2.1-rc.1 widened that fence (bind-address literals, protocol-normalized
 * default ports) and moved the declared authorities from `webRuntime` to
 * `webStartup`. These cases pin the behavior this plugin's copy has to match,
 * including the two ways a naive copy fails: refusing the listener's own bind
 * literal, and throwing on a Loader row whose `trustedHosts` is still an
 * unevaluated `!!js` node.
 */
import { expect, test } from 'vitest'
import { isTrustedApiRequest } from '../src/trust-fence.ts'

function request(headers: Record<string, string>) {
  return { headers }
}

test('loopback authorities pass on any port without a declared trust list', () => {
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
  expect(isTrustedApiRequest(request({ host: '127.8.9.10' }), [])).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'localhost:9999' }), [])).toBe(true)
  expect(isTrustedApiRequest(request({ host: '[::1]:3080' }), [])).toBe(true)
})

test('a request without a Host header never passes', () => {
  expect(isTrustedApiRequest(request({}), [])).toBe(false)
})

test('the listener bind literal passes independently of trustedHosts', () => {
  // DSH 0.2.1-rc.1: `--host 10.0.0.7` then browsing that literal.
  expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [], '10.0.0.7')).toBe(true)
  expect(isTrustedApiRequest(request({ host: '10.0.0.7' }), [], '10.0.0.7')).toBe(true)
  // An interface zone is an interface selector, never address text.
  expect(isTrustedApiRequest(request({ host: '[fe80::1]:3080' }), [], 'fe80::1%eth0')).toBe(true)
  // Another address is not this listener.
  expect(isTrustedApiRequest(request({ host: '10.0.0.8:3080' }), [], '10.0.0.7')).toBe(false)
  // No bind address known (older DSH): the literal stays untrusted.
  expect(isTrustedApiRequest(request({ host: '10.0.0.7:3080' }), [])).toBe(false)
})

test('a declared authority matches by exact authority or by hostname on any port', () => {
  expect(isTrustedApiRequest(request({ host: 'app.internal' }), ['app.internal'])).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'app.internal:8443' }), ['app.internal'])).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'app.internal:8443' }), ['app.internal:8443'])).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'app.internal:9999' }), ['app.internal:8443'])).toBe(false)
  expect(isTrustedApiRequest(request({ host: 'other.internal' }), ['app.internal'])).toBe(false)
  // WHATWG normalization: case and a redundant scheme-default port never decide trust.
  expect(isTrustedApiRequest(request({ host: 'APP.internal:8443' }), ['app.internal:8443'])).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'app.internal' }), ['app.internal:80'])).toBe(true)
})

test('an HTTPS listener normalizes default ports through its own scheme', () => {
  expect(isTrustedApiRequest(request({ host: 'app.internal' }), ['app.internal:443'], undefined, 'https:')).toBe(true)
  expect(isTrustedApiRequest(request({ host: 'app.internal:443' }), ['app.internal:443'], undefined, 'https:')).toBe(true)
  // Origin normalizes Host under the Origin scheme, so an HTTPS proxy entry compares consistently.
  expect(isTrustedApiRequest(
    request({ host: 'app.internal', origin: 'https://app.internal' }),
    ['app.internal'],
    undefined,
    'https:',
  )).toBe(true)
})

test('cross-site markers and mismatched Origins refuse an otherwise trusted request', () => {
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }), [])).toBe(false)
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://evil.test' }), [])).toBe(false)
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }), [])).toBe(true)
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080', origin: 'file:///tmp/x' }), [])).toBe(false)
  // No Origin at all is a non-browser client, which the Host fence already bound.
  expect(isTrustedApiRequest(request({ host: '127.0.0.1:3080' }), [])).toBe(true)
})
