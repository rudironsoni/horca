import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')

const RENDERER_ENTRIES = [
  'src/renderer/src/main.tsx',
  'src/renderer/src/popout.tsx',
  'src/renderer/src/web/main.tsx'
]

const DAEMON_ENTRIES = ['src/main/daemon/daemon-server.ts']
const FORBIDDEN_PATH_PART = 'xterm-renderer/'
const FORBIDDEN_HEADLESS_PATHS = ['xterm-headless-emulator', 'xterm-env-polyfill']
const FORBIDDEN_PACKAGES_PREFIX = '@xterm/'
const FORBIDDEN_HEADLESS_PACKAGES = ['@xterm/headless', '@xterm/addon-serialize', '@xterm/addon-unicode11']
const FORBIDDEN_BUNDLE_SIGNATURES = [
  'XtermPaneTerminal',
  'registerXtermPaneState',
  'xterm-renderer/xterm-pane-terminal'
]
const FORBIDDEN_HEADLESS_BUNDLE_SIGNATURES = [
  'XtermHeadlessEmulator',
  '@xterm/headless',
  '@xterm/addon-serialize',
  '@xterm/addon-unicode11'
]

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"\n]+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const TYPE_IMPORT_RE = /^\s*import\s+type\s+/m

function isTest(rel) {
  return (
    rel.includes('.test.') ||
    rel.includes('.spec.') ||
    rel.includes('fixture') ||
    rel.includes('test-harness') ||
    rel.includes('/__tests__/')
  )
}

function resolveSpec(worktree, fromRel, spec) {
  const bare = spec.split('?')[0]
  let base
  if (bare.startsWith('@renderer/')) base = join(worktree, 'src/renderer/src', bare.slice('@renderer/'.length))
  else if (bare.startsWith('@/')) base = join(worktree, 'src/renderer/src', bare.slice(2))
  else if (bare.startsWith('.')) base = resolve(join(worktree, dirname(fromRel)), bare)
  else return null
  const cands = []
  const ext = extname(base)
  if (ext) cands.push(base)
  else {
    for (const e of ['.ts', '.tsx', '.js', '.mjs', '.json']) cands.push(base + e)
    for (const e of ['.ts', '.tsx', '.js']) cands.push(join(base, 'index' + e))
  }
  for (const c of cands) {
    if (existsSync(c) && statSync(c).isFile()) return relative(worktree, c).replaceAll('\\', '/')
  }
  return null
}

function walkRuntimeGraph(worktree, entries) {
  const seen = new Set()
  const packages = []
  const stack = [...entries]
  while (stack.length) {
    const rel = stack.pop()
    if (seen.has(rel)) continue
    seen.add(rel)
    const file = join(worktree, rel)
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    IMPORT_RE.lastIndex = 0
    let m
    while ((m = IMPORT_RE.exec(text))) {
      const lineStart = text.lastIndexOf('\n', m.index) + 1
      const line = text.slice(lineStart, m.index + m[0].length)
      if (TYPE_IMPORT_RE.test(line)) continue
      const spec = m[1] || m[2]
      if (!spec.startsWith('.') && !spec.startsWith('@renderer/') && !spec.startsWith('@/')) {
        packages.push({ from: rel, spec })
        continue
      }
      const next = resolveSpec(worktree, rel, spec)
      if (!next || isTest(next)) continue
      stack.push(next)
    }
  }
  return { modules: [...seen], packages }
}

function walkDir(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walkDir(p, acc)
    else if (/\.(js|mjs|cjs|css|html|json)$/.test(name)) acc.push(p)
  }
  return acc
}

function scanBuiltDir(dir, signatures) {
  const files = walkDir(dir)
  const hits = []
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const sig of signatures) {
      if (text.includes(sig)) hits.push({ file: relative(dir, file), signature: sig })
    }
  }
  return { fileCount: files.length, hits }
}

function main() {
  const worktree = process.argv[2]
  if (!worktree) {
    throw new Error(
      'Usage: node scripts/verify-xterm-runtime-reachability.mjs <worktree> [--bundle <dir>]'
    )
  }
  const bundleIdx = process.argv.indexOf('--bundle')
  const bundleDir = bundleIdx >= 0 ? process.argv[bundleIdx + 1] : join(worktree, 'out', 'renderer')

  const renderer = walkRuntimeGraph(worktree, RENDERER_ENTRIES)
  const rendererHits = renderer.modules.filter((p) => p.includes(FORBIDDEN_PATH_PART) || p.includes('xterm-renderer'))
  const rendererPkgHits = renderer.packages.filter((p) => p.spec.startsWith(FORBIDDEN_PACKAGES_PREFIX))
  if (rendererHits.length || rendererPkgHits.length) {
    console.error('[verify-xterm-runtime-reachability] renderer graph FAIL')
    for (const h of rendererHits) console.error(`  ${h}`)
    for (const h of rendererPkgHits) console.error(`  ${h.from} -> ${h.spec}`)
    process.exit(1)
  }
  console.log(
    `[verify-xterm-runtime-reachability] renderer module graph PASS (${renderer.modules.length} modules, 0 xterm)`
  )

  const daemon = walkRuntimeGraph(worktree, DAEMON_ENTRIES)
  const daemonPathHits = daemon.modules.filter((p) =>
    FORBIDDEN_HEADLESS_PATHS.some((part) => p.includes(part))
  )
  const daemonPkgHits = daemon.packages.filter((p) => p.spec.startsWith(FORBIDDEN_PACKAGES_PREFIX))
  if (daemonPathHits.length || daemonPkgHits.length) {
    console.error('[verify-xterm-runtime-reachability] daemon graph FAIL')
    for (const h of daemonPathHits) console.error(`  ${h}`)
    for (const h of daemonPkgHits) console.error(`  ${h.from} -> ${h.spec}`)
    process.exit(1)
  }
  console.log(
    `[verify-xterm-runtime-reachability] daemon module graph PASS (${daemon.modules.length} modules, 0 xterm headless)`
  )

  if (existsSync(bundleDir)) {
    const scan = scanBuiltDir(bundleDir, FORBIDDEN_BUNDLE_SIGNATURES)
    if (scan.hits.length) {
      console.error('[verify-xterm-runtime-reachability] built renderer FAIL')
      for (const h of scan.hits) console.error(`  ${h.file}: ${h.signature}`)
      process.exit(1)
    }
    console.log(
      `[verify-xterm-runtime-reachability] built renderer PASS (${scan.fileCount} files, 0 forbidden signatures)`
    )
  } else {
    console.log(`[verify-xterm-runtime-reachability] no built renderer at ${bundleDir}`)
  }

  const mainBundleIdx = process.argv.indexOf('--main-bundle')
  if (mainBundleIdx >= 0) {
    const mainDir = process.argv[mainBundleIdx + 1]
    const scan = scanBuiltDir(mainDir, FORBIDDEN_HEADLESS_BUNDLE_SIGNATURES)
    if (scan.hits.length) {
      console.error('[verify-xterm-runtime-reachability] built daemon FAIL')
      for (const h of scan.hits) console.error(`  ${h.file}: ${h.signature}`)
      process.exit(1)
    }
    console.log(
      `[verify-xterm-runtime-reachability] built daemon PASS (${scan.fileCount} files, 0 xterm headless signatures)`
    )
  }

  const horcaLeaks = []
  function walkHorca(dir) {
    if (!existsSync(dir)) return
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.isDirectory()) {
        walkHorca(p)
        continue
      }
      if (!p.endsWith('.ts') && !p.endsWith('.tsx')) continue
      const rel = relative(ROOT, p).replaceAll('\\', '/')
      if (isTest(rel) || rel.startsWith('overlay/') || rel.startsWith('migration/')) continue
      const text = readFileSync(p, 'utf8')
      if (text.includes("from '@xterm/") || text.includes('from "@xterm/')) horcaLeaks.push(rel)
    }
  }
  walkHorca(join(ROOT, 'src'))
  if (horcaLeaks.length) {
    console.error('[verify-xterm-runtime-reachability] Horca-owned production @xterm FAIL')
    for (const h of horcaLeaks) console.error(`  ${h}`)
    process.exit(1)
  }
  console.log('[verify-xterm-runtime-reachability] Horca-owned production @xterm imports: 0')

  const asarIdx = process.argv.indexOf('--asar')
  if (asarIdx >= 0) {
    const asarPath = process.argv[asarIdx + 1]
    const listing = execFileSync('npx', ['--yes', 'asar', 'list', asarPath], { encoding: 'utf8' })
    const asarHits = listing.split('\n').filter((ln) => /xterm/i.test(ln) && /headless|addon-serialize|addon-unicode11|addon-fit|addon-search|addon-webgl|addon-ligatures|@xterm\/xterm/.test(ln))
    if (asarHits.length) {
      console.error('[verify-xterm-runtime-reachability] asar FAIL')
      for (const h of asarHits.slice(0, 50)) console.error(`  ${h}`)
      process.exit(1)
    }
    console.log('[verify-xterm-runtime-reachability] asar xterm runtime paths: 0')
  }
}

main()
