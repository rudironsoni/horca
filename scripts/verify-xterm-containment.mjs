import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const rules = JSON.parse(readFileSync(resolve(ROOT, 'config/horca/xterm-containment.json'), 'utf8'))

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, acc)
    else if (p.endsWith('.ts') || p.endsWith('.tsx')) acc.push(p)
  }
  return acc
}

function isTest(rel) {
  return (
    rel.includes('.test.') ||
    rel.endsWith('.spec.ts') ||
    rel.endsWith('.spec.tsx') ||
    rel.includes('fixture') ||
    rel.includes('test-harness')
  )
}

function main() {
  const worktree = process.argv[2]
  const scope = process.argv.includes('--renderer') ? 'renderer' : 'headless'
  if (!worktree) throw new Error('Usage: node scripts/verify-xterm-containment.mjs <worktree> [--headless|--renderer]')
  const allow = new Set(
    scope === 'renderer' ? rules.rendererImplementation : rules.headlessImplementation
  )
  const roots =
    scope === 'renderer'
      ? [resolve(worktree, 'src/renderer')]
      : [resolve(worktree, 'src/main'), resolve(worktree, 'src/shared')]
  const leaks = []
  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = relative(worktree, file).replaceAll('\\', '/')
      if (isTest(rel)) continue
      if (allow.has(rel)) continue
      if (scope === 'headless' && rel.startsWith('src/renderer/')) continue
      const text = readFileSync(file, 'utf8')
      if (text.includes("from '@xterm/") || text.includes('from "@xterm/')) {
        leaks.push(rel)
      }
      if (
        scope === 'renderer' &&
        !allow.has(rel) &&
        (text.includes('xterm-pane-state') || text.includes('requireXtermPaneState'))
      ) {
        leaks.push(`${rel} (XtermPaneState accessor)`)
      }
    }
  }
  if (leaks.length) {
    console.error(`[verify-xterm-containment] ${scope} FAIL`)
    for (const l of leaks) console.error(`  ${l}`)
    process.exit(1)
  }
  console.log(`[verify-xterm-containment] ${scope} PASS`)
}

main()
