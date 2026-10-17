/**
 * Guard the declared DSH compatibility window.
 *
 * DSH refuses to install or activate a bundle whose `@deepseek-ai/dsh*`
 * peerDependencies do not accept the running runtime (dsh-app-boot's
 * `evaluatePluginCompatibility`). It evaluates those ranges with
 * `semver.satisfies(version, range, { includePrerelease: true })`, which makes
 * two mistakes expensive:
 *
 * 1. A caret range is a closed window. `^0.2.0-rc.1` stops at 0.2.0, so the
 *    next DSH minor — even the next prerelease of the *current* minor — is
 *    rejected outright. The desktop profile log shows a sibling plugin being
 *    refused on 0.2.0-rc.2 exactly this way (`^0.1.7-0`).
 * 2. An exact pin (`0.2.0-rc.2`) is a window one version wide.
 *
 * The policy this script enforces: every DSH peer is a single open lower bound
 * (`>=<floor>`), one shared floor across all peers, mirrored in
 * `dsh.plugin.json`'s `engines.dsh`. `>=` has no upper bound, so every later
 * DSH — prereleases included — is accepted without touching the manifest again.
 * The floor is the oldest DSH the current code is known to work with; it moves
 * up only when a breaking DSH change forces a code change and a republish.
 *
 * Usage:
 *   node scripts/check-dsh-compat.mjs [--dsh-version <exact>]
 *
 * Runtime under test: `--dsh-version`, else `$DSH_INSTALL` (a DSH install root),
 * else the pinned devDependency line in this repo. No process is spawned, so
 * the check also runs in confined sandboxes and in CI.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Peer names DSH itself polices: the runtime and its scoped packages. */
const POLICED_PEER = /^@deepseek-ai\/dsh(?:-|$)/

/** The one accepted peer form: an open lower bound on an exact version. */
const OPEN_FLOOR = /^>=(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/** Parse an exact semantic version, or null when it is not one. */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value ?? '')
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] === undefined ? null : match[4].split('.'),
  }
}

/** SemVer prerelease precedence: numeric identifiers rank below alphanumeric. */
function comparePrerelease(left, right) {
  if (left === null && right === null) return 0
  // A release outranks every prerelease of the same major.minor.patch.
  if (left === null) return 1
  if (right === null) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index]
    const b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const aNumeric = /^\d+$/.test(a)
    const bNumeric = /^\d+$/.test(b)
    if (aNumeric && bNumeric) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1
      continue
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    if (a !== b) return a < b ? -1 : 1
  }
  return 0
}

/** Standard SemVer precedence. */
function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  return comparePrerelease(left.pre, right.pre)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Resolve the DSH runtime version to test the declared window against.
 * @returns {{ version: string, source: string } | null}
 */
function resolveRuntime() {
  const argv = process.argv.slice(2)
  const flag = argv.indexOf('--dsh-version')
  if (flag !== -1) {
    const version = argv[flag + 1]
    if (version === undefined) throw new Error('--dsh-version needs an exact version')
    return { version, source: '--dsh-version' }
  }
  const install = process.env.DSH_INSTALL
  if (install !== undefined && install !== '') {
    const manifest = join(install, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    if (existsSync(manifest)) return { version: readJson(manifest).version, source: `$DSH_INSTALL (${manifest})` }
  }
  // The pinned devDependency line is the version this repo compiles against.
  const pinned = join(REPO_ROOT, 'node_modules', '@deepseek-ai', 'dsh-session', 'package.json')
  if (existsSync(pinned)) return { version: readJson(pinned).version, source: 'pinned devDependency (@deepseek-ai/dsh-session)' }
  return null
}

const manifest = readJson(join(REPO_ROOT, 'package.json'))
const pluginManifest = readJson(join(REPO_ROOT, 'dsh.plugin.json'))
const failures = []

const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => POLICED_PEER.test(name))
if (peers.length === 0) failures.push('package.json declares no @deepseek-ai/dsh* peerDependencies to check')

const floors = new Map()
for (const [name, range] of peers) {
  const open = OPEN_FLOOR.exec(range)
  if (open === null) {
    failures.push(
      `${name}: peer range ${JSON.stringify(range)} is not an open lower bound — use ">=<floor>" (a caret, exact pin, or upper bound closes the window and DSH then rejects newer runtimes)`,
    )
    continue
  }
  floors.set(name, open[1])
}

const distinctFloors = [...new Set(floors.values())]
if (distinctFloors.length > 1) {
  failures.push(`dsh peers disagree on the floor: ${distinctFloors.sort().join(', ')} — keep one shared floor`)
}
const floor = distinctFloors.sort()[0]
if (floor !== undefined) {
  const parsed = parseVersion(floor)
  if (parsed === null) failures.push(`floor ${JSON.stringify(floor)} is not an exact semantic version`)
  const engines = pluginManifest.engines?.dsh
  if (engines !== `>=${floor}`) {
    failures.push(`dsh.plugin.json engines.dsh is ${JSON.stringify(engines)}, expected ${JSON.stringify(`>=${floor}`)}`)
  }
}

const runtime = resolveRuntime()
if (runtime === null) {
  console.warn('check-dsh-compat: SKIP floor/runtime comparison — no DSH runtime found (set --dsh-version or DSH_INSTALL)')
} else if (floor !== undefined) {
  const parsedRuntime = parseVersion(runtime.version)
  const parsedFloor = parseVersion(floor)
  if (parsedRuntime === null) {
    failures.push(`runtime version ${JSON.stringify(runtime.version)} from ${runtime.source} is not an exact semantic version`)
  } else if (parsedFloor !== null && compareVersions(parsedFloor, parsedRuntime) > 0) {
    failures.push(`floor ${floor} is newer than the tested runtime ${runtime.version} (${runtime.source}) — the declared window excludes it`)
  }
}

for (const failure of failures) console.error(`check-dsh-compat: FAIL ${failure}`)
if (failures.length > 0) {
  console.error(`check-dsh-compat: ${failures.length} compatibility-policy violation(s)`)
  process.exit(1)
}

console.log(`check-dsh-compat: ${peers.length} dsh peer(s) declared as open lower bound >=${floor}`)
console.log(
  runtime === null
    ? 'check-dsh-compat: runtime comparison skipped'
    : `check-dsh-compat: OK — floor ${floor} <= runtime ${runtime.version} (${runtime.source}); every newer DSH is accepted`,
)
