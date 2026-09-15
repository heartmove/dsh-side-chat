/**
 * Guard the frozen web-shell module table.
 *
 * The client bundles externalize the platform modules listed in
 * `CLIENT_EXTERNALS` (see tsdown.config.ts). At runtime the browser resolves
 * those specifiers against the module table the DSH web shell freezes at boot —
 * NOT against the `@deepseek-ai/dsh-*` packages this repo compiles against.
 * TypeScript therefore cannot see it when a newer DSH drops an export: the
 * build stays green while `require(...)<Member>` is `undefined` in the browser
 * and React throws "Element type is invalid" (this is exactly how
 * `IconSendOutline16` broke on DSH 0.1.6).
 *
 * This script re-reads the real shell bundle, extracts the seed table and each
 * seed module's export names, and fails when a built bundle reaches for a
 * member the target shell does not have.
 *
 * Usage:
 *   node scripts/check-seed-exports.mjs [--shell <path-to-index-*.js>] [--dump]
 *
 * Target discovery order: `--shell`, `$DSH_WEB_SHELL`, `$DSH_INSTALL`, then
 * `dsh` resolved on PATH. When no target is found the check SKIPS with a
 * warning (exit 0) so a checkout without a DSH install — CI included — still
 * builds; the guard is only meaningful against a real install.
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Bundle files the client build emits, relative to the repo root. */
const BUNDLES = ['lib/client.js', 'lib/client-registry.js']

/** Seed specifiers whose member surface this guard polices (react is stable). */
const POLICED = /^@deepseek-ai\//

/** `let <binding> = require("<spec>");` in a factory head. */
const REQUIRE_RE = /let\s+([A-Za-z_$][\w$]*)\s*=\s*require\("([^"]+)"\)/g

/** `Object.freeze(Object.defineProperty({__proto__:null, ...` namespace object. */
const NAMESPACE_RE =
  /([A-Za-z_$][\w$]*)\s*=\s*Object\.freeze\(Object\.defineProperty\(\{__proto__:null,([\s\S]*?)\},Symbol\.toStringTag,\{value:"Module"\}\)\)/g

const argv = process.argv.slice(2)
const dump = argv.includes('--dump')
const shellFlag = argv.indexOf('--shell')

/** Candidate shell-bundle paths for one DSH install root. */
function shellsUnder(installRoot) {
  const assets = join(
    installRoot,
    'node_modules',
    '@deepseek-ai',
    'dsh',
    'node_modules',
    '@deepseek-ai',
    'dsh-web-frontend',
    'dist',
    'assets',
  )
  if (!existsSync(assets)) return []
  return readdirSync(assets)
    .filter((name) => /^index-.*\.js$/.test(name))
    .map((name) => join(assets, name))
}

/** Locate the web shell bundle, or null when no install is available. */
function findShell() {
  if (shellFlag !== -1) {
    const explicit = argv[shellFlag + 1]
    if (explicit === undefined || !existsSync(explicit)) {
      throw new Error(`--shell path does not exist: ${explicit}`)
    }
    return explicit
  }
  if (process.env.DSH_WEB_SHELL !== undefined && existsSync(process.env.DSH_WEB_SHELL)) {
    return process.env.DSH_WEB_SHELL
  }
  const roots = []
  if (process.env.DSH_INSTALL !== undefined) roots.push(process.env.DSH_INSTALL)
  // `dsh` on PATH -> <prefix>/node_modules/@deepseek-ai/dsh (possibly via shim).
  try {
    const which = process.platform === 'win32' ? 'where' : 'which'
    const found = execFileSync(which, ['dsh'], { encoding: 'utf8' }).split(/\r?\n/)[0]?.trim()
    if (found !== undefined && found !== '') {
      let real = found
      try {
        real = realpathSync(found)
      } catch {}
      // .../node_modules/@deepseek-ai/dsh/<entry> -> install root is 4 levels up.
      const marker = join('node_modules', '@deepseek-ai', 'dsh')
      const at = real.lastIndexOf(marker)
      if (at !== -1) roots.push(real.slice(0, at))
      roots.push(dirname(real))
    }
  } catch {}
  for (const root of roots) {
    const found = shellsUnder(root)
    if (found.length > 0) {
      // Newest build wins when several assets are present.
      return found.sort().at(-1)
    }
  }
  return null
}

/** Export names of every frozen namespace object in the shell, keyed by binding. */
function namespacesOf(shellSource) {
  const byBinding = new Map()
  for (const match of shellSource.matchAll(NAMESPACE_RE)) {
    const [, binding, body] = match
    const names = new Set()
    for (const key of body.matchAll(/(?:^|,)([A-Za-z_$][\w$]*):/g)) names.add(key[1])
    if (names.size > 0) byBinding.set(binding, names)
  }
  return byBinding
}

/** Seed specifier -> export-name set, read out of the shell's module table. */
function seedExports(shellSource) {
  const namespaces = namespacesOf(shellSource)
  const table = new Map()
  for (const match of shellSource.matchAll(/"(@deepseek-ai\/[^"]+)":([A-Za-z_$][\w$]*)/g)) {
    const [, spec, binding] = match
    const names = namespaces.get(binding)
    if (names !== undefined && !table.has(spec)) table.set(spec, names)
  }
  return table
}

/** Members a built bundle reaches for on each seed module it requires. */
function bundleUsage(source) {
  const usages = new Map()
  const bindings = new Map()
  for (const match of source.matchAll(REQUIRE_RE)) {
    const [, binding, spec] = match
    // Re-required bindings are fine; the last one wins.
    bindings.set(binding, spec)
  }
  for (const [binding, spec] of bindings) {
    if (!POLICED.test(spec)) continue
    const members = usages.get(spec) ?? new Set()
    const memberRe = new RegExp(`\\b${binding.replace(/\$/g, '\\$')}\\.([A-Za-z_$][\\w$]*)`, 'g')
    for (const hit of source.matchAll(memberRe)) members.add(hit[1])
    if (members.size > 0) usages.set(spec, members)
  }
  // Inline `require("<spec>").<Member>` reaches as well.
  for (const hit of source.matchAll(/require\("([^"]+)"\)\.([A-Za-z_$][\w$]*)/g)) {
    const [, spec, member] = hit
    if (!POLICED.test(spec)) continue
    const members = usages.get(spec) ?? new Set()
    members.add(member)
    usages.set(spec, members)
  }
  return usages
}

const shell = findShell()
if (shell === null) {
  console.warn(
    'check-seed-exports: SKIP — no DSH web shell found. Set DSH_INSTALL (or --shell) to a DSH install to police the frozen module table.',
  )
  process.exit(0)
}

const shellSource = readFileSync(shell, 'utf8')
const seed = seedExports(shellSource)
console.log(`check-seed-exports: target ${shell}`)
console.log(`check-seed-exports: ${seed.size} seed module(s) in the frozen table`)

if (dump) {
  for (const [spec, names] of [...seed].sort()) {
    console.log(`  ${spec} (${names.size}): ${[...names].sort().join(', ')}`)
  }
  process.exit(0)
}

let failures = 0
let checked = 0
for (const relative of BUNDLES) {
  const path = join(REPO_ROOT, relative)
  if (!existsSync(path)) {
    console.warn(`check-seed-exports: ${relative} not built yet — run tsdown first`)
    continue
  }
  const usages = bundleUsage(readFileSync(path, 'utf8'))
  for (const [spec, members] of usages) {
    const available = seed.get(spec)
    if (available === undefined) {
      // Not a seed word in this shell: either inlined at build time or truly
      // absent. Report rather than guess.
      console.warn(`check-seed-exports: WARN ${relative} requires "${spec}", which is not in the frozen table`)
      continue
    }
    checked += 1
    const missing = [...members].filter((member) => !available.has(member)).sort()
    if (missing.length > 0) {
      failures += 1
      console.error(
        `check-seed-exports: FAIL ${relative} uses ${missing.map((m) => `"${spec}".${m}`).join(', ')} — not exported by the shell's ${basename(shell)}`,
      )
      console.error(
        `  The build compiled against the linked DSH checkout, but the browser resolves "${spec}" from the shell. Pick an export the target DSH still ships, or drop the dependency.`,
      )
    }
  }
}

if (failures > 0) {
  console.error(`check-seed-exports: ${failures} incompatible seed-module reference(s)`)
  process.exit(1)
}
console.log(`check-seed-exports: OK — ${checked} seed-module reference group(s) verified against the frozen table`)
