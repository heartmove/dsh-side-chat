/**
 * Verify the plugin against every DSH line it claims to support.
 *
 * `devDependencies` track the CURRENT DSH line (see AGENTS.md rule 4) while the
 * declared peer window is the open range `>=<floor>`. A version-line move is
 * therefore a two-line check: the new line must be green, and the floor line
 * must stay green (code that only compiles against the newest API has silently
 * broken the promise made by `>=<floor>`).
 *
 * This script performs that check mechanically: for each line it rewrites every
 * `@deepseek-ai/dsh*` devDependency, re-derives the matching `cordis` /
 * `schemastery` pins from that line's own published `@deepseek-ai/dsh` manifest,
 * runs `pnpm install` → `typecheck` → `test` → `build`, and finally restores
 * `package.json` and reinstalls the original line. Everything is restored even
 * when a line fails, so the checkout is never left on a swapped manifest.
 *
 * `pnpm install` needs registry metadata: prerelease DSH versions are younger
 * than pnpm's default `minimumReleaseAge`, and a lagging mirror (npmmirror) may
 * not carry the version at all, so this script defaults to registry.npmjs.org.
 *
 * Usage:
 *   node scripts/verify-dsh-lines.mjs                     # current line, then floor
 *   node scripts/verify-dsh-lines.mjs --lines 0.2.2-rc.1,0.2.1-rc.1
 *   node scripts/verify-dsh-lines.mjs --runtime <dsh-install-root>   # real web shell for check-seed-exports
 *   node scripts/verify-dsh-lines.mjs --dry-run           # print the plan only
 *
 * Options:
 *   --lines <a,b>       Lines to verify (default: the pinned devDependency line, then the peer floor)
 *   --runtime <root>    DSH install root exported as `DSH_INSTALL` for the build gates
 *   --registry <url>    Registry for install and metadata (default https://registry.npmjs.org/)
 *   --dry-run           Show the plan (including resolved cordis/schemastery pins) without touching anything
 *   --keep              Leave the LAST tested line installed instead of restoring the original
 *   --continue          Keep testing remaining lines after one fails
 *   --no-pairing        Do not re-derive cordis/schemastery pins; keep the current ones
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))
const MANIFEST = new URL('../package.json', import.meta.url)
const DEFAULT_REGISTRY = 'https://registry.npmjs.org/'

/** Packages DSH itself polices; every one of them is pinned to the tested line. */
const DSH_PEER = /^@deepseek-ai\/dsh(?:-|$)/

/** Windows installs pnpm as a .cmd shim, which only a shell can run; POSIX uses the binary directly. */
const PNPM = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

/**
 * Quote one argument for the shell line below. Every argument this script passes
 * is a package name, a version range, a flag, or a registry URL, so the simple
 * form is enough; anything with spaces or quotes is wrapped defensively.
 */
function quoteArg(value) {
  return /^[A-Za-z0-9@._:/=+~-]+$/.test(value) ? value : `"${String(value).replace(/"/g, '\\"')}"`
}

const argv = process.argv.slice(2)

function flag(name) {
  return argv.includes(`--${name}`)
}

function option(name) {
  const at = argv.indexOf(`--${name}`)
  if (at === -1) return undefined
  const value = argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`--${name} needs a value`)
  return value
}

/**
 * Run pnpm through a shell line (pnpm ships as a .cmd shim on Windows, which
 * cannot be spawned directly). Arguments are quoted by {@link quoteArg}, so no
 * unescaped interpolation reaches the shell.
 */
function shell(args, stdio = 'inherit') {
  return execSync([PNPM, ...args.map(quoteArg)].join(' '), {
    cwd: REPO_ROOT,
    stdio,
    env: { ...process.env, ...(runtime === undefined ? {} : { DSH_INSTALL: runtime }) },
  })
}

/**
 * Read one DSH line's own manifest straight from the registry.
 *
 * Deliberately not `npm view`: this only needs an HTTP GET, works on every
 * platform without a shell (npm/pnpm ship as .cmd shims on Windows), and keeps
 * the script free of a semver dependency.
 */
async function registryManifest(line) {
  const base = registry.replace(/\/+$/, '')
  const response = await fetch(`${base}/@deepseek-ai%2Fdsh/${line}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for @deepseek-ai/dsh@${line}`)
  return response.json()
}

/** Read the original manifest once; every swap starts from these bytes. */
const original = readFileSync(MANIFEST, 'utf8')
const manifest = JSON.parse(original)

const registry = option('registry') ?? DEFAULT_REGISTRY
const runtime = option('runtime') ?? process.env.DSH_INSTALL
const dryRun = flag('dry-run')
const derivePairing = !flag('no-pairing')

/** The line this checkout currently installs. */
const currentLine = manifest.devDependencies['@deepseek-ai/dsh-agent']
if (typeof currentLine !== 'string') throw new Error('package.json has no @deepseek-ai/dsh-agent devDependency to treat as the current line')

/** The declared peer floor (`>=X`), which the manifest gate guarantees to be single and shared. */
const floors = [...new Set(Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => DSH_PEER.test(name))
  .map(([, range]) => range.replace(/^>=/, '')))]
if (floors.length !== 1) throw new Error(`peerDependencies must share one floor, found: ${floors.join(', ') || '(none)'}`)
const floor = floors[0]

const requested = option('lines')
const lines = requested === undefined
  ? [...new Set([currentLine, floor])]
  : requested.split(',').map((line) => line.trim()).filter((line) => line !== '')

/**
 * Pin `cordis` and `schemastery` to the ranges the tested DSH line itself
 * declares (a range alias is what pnpm resolves, so no version guessing is
 * needed). Failure keeps the current pins and says so.
 */
async function pairingFor(line) {
  const keep = {
    cordis: manifest.devDependencies.cordis,
    schemastery: manifest.dependencies.schemastery,
  }
  if (!derivePairing) return { ...keep, source: 'kept (--no-pairing)' }
  try {
    const deps = (await registryManifest(line)).dependencies ?? {}
    const cordis = deps['@deepseek-ai/cordis']
    const schemastery = deps['@deepseek-ai/schemastery']
    return {
      cordis: typeof cordis === 'string' ? `npm:@deepseek-ai/cordis@${cordis}` : keep.cordis,
      schemastery: typeof schemastery === 'string' ? `npm:@deepseek-ai/schemastery@${schemastery}` : keep.schemastery,
      source: 'from the @deepseek-ai/dsh manifest',
    }
  } catch (error) {
    console.warn(`verify-dsh-lines: could not read the ${line} manifest (${String(error.message ?? error)}); keeping current pins`)
    return { ...keep, source: 'kept (metadata unavailable)' }
  }
}

/** One manifest with every dsh devDependency on `line` and the line's cordis/schemastery pins. */
function manifestFor(line, pairing) {
  const next = structuredClone(manifest)
  for (const name of Object.keys(next.devDependencies ?? {})) {
    if (DSH_PEER.test(name)) next.devDependencies[name] = line
  }
  next.devDependencies.cordis = pairing.cordis
  next.dependencies.schemastery = pairing.schemastery
  return `${JSON.stringify(next, null, 2)}\n`
}

function install() {
  shell(['install', '--registry', registry])
}

function restore() {
  writeFileSync(MANIFEST, original)
  install()
}

const plan = await Promise.all(lines.map(async (line) => ({ line, pairing: await pairingFor(line) })))

console.log(`verify-dsh-lines: DSH lines ${plan.map(({ line }) => line).join(' → ')} (registry ${registry}${runtime === undefined ? '' : `, runtime ${runtime}`})`)
for (const { line, pairing } of plan) {
  console.log(`  - ${line}: cordis ${pairing.cordis}, schemastery ${pairing.schemastery} [${pairing.source}]`)
}
/** Run every planned line, restoring the manifest afterwards. */
async function runLines() {
  const results = []
  const keep = flag('keep')
  try {
    for (const { line, pairing } of plan) {
      console.log(`\n=== ${line} ===`)
      writeFileSync(MANIFEST, manifestFor(line, pairing))
      try {
        install()
        shell(['typecheck'])
        shell(['test'])
        shell(['build'])
        results.push({ line, ok: true })
        console.log(`=== ${line}: OK ===`)
      } catch (error) {
        results.push({ line, ok: false })
        console.error(`=== ${line}: FAILED ===`)
        if (!flag('continue')) throw error
      }
    }
  } finally {
    if (keep) console.log('verify-dsh-lines: --keep — leaving the last tested line installed')
    else {
      restore()
      console.log('verify-dsh-lines: restored package.json and reinstalled the original line')
    }
  }

  const failed = results.filter(({ ok }) => !ok)
  for (const { line, ok } of results) console.log(`verify-dsh-lines: ${ok ? 'PASS' : 'FAIL'} ${line}`)
  if (failed.length > 0) {
    console.error(`verify-dsh-lines: ${failed.length} line(s) failed — fix the code, or move the peer floor if the older line is no longer supported`)
    process.exitCode = 1
    return
  }
  console.log('verify-dsh-lines: every declared DSH line is green')
}

if (dryRun) {
  // Set the exit code instead of calling process.exit(): on Windows, forcing an
  // exit while a keep-alive socket from the metadata fetch is closing trips a
  // libuv handle assertion.
  console.log('verify-dsh-lines: dry run — nothing installed or written')
} else {
  await runLines()
}
