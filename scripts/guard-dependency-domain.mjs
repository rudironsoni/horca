import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Gate B2 hardening: dependency-domain mutation guard.
//
// Candidate A requires that Horca dependency operations NEVER mutate
// upstream/root-owned dependency metadata. This wrapper hashes the protected
// files, runs a command, and fails if any protected file changed. It does NOT
// restore anything: the failure must remain visible.
//
// Usage:
//   node scripts/guard-dependency-domain.mjs --root <dir> --cwd <dir> \
//     [--worktree <dir>] -- <command...>

const args = process.argv.slice(2)
function take(flag) {
  const i = args.indexOf(flag)
  if (i === -1) return undefined
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const root = take('--root')
const cwd = take('--cwd')
const worktree = take('--worktree')
const sep = args.indexOf('--')
if (!root || !cwd || sep === -1) {
  console.error('Usage: guard-dependency-domain.mjs --root <dir> --cwd <dir> [--worktree <dir>] -- <command...>')
  process.exit(2)
}
const command = args.slice(sep + 1)

const protectedRel = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']
const protectedFiles = [
  ...protectedRel.map((f) => resolve(root, f)),
  ...(worktree ? protectedRel.map((f) => resolve(worktree, f)) : [])
].filter((f) => existsSync(f))

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}
function snapshot() {
  const map = new Map()
  for (const f of protectedFiles) map.set(f, digest(f))
  return map
}

const before = snapshot()
console.log(`[guard] protecting ${protectedFiles.length} dependency file(s)`)
console.log(`[guard] running: ${command.join(' ')} (cwd=${cwd})`)

let exitCode = 0
try {
  execFileSync(command[0], command.slice(1), { cwd, stdio: 'inherit' })
} catch (e) {
  exitCode = typeof e.status === 'number' ? e.status : 1
}

const after = snapshot()
const changed = []
for (const [f, d] of before) {
  if (after.get(f) !== d) changed.push(f)
}

if (changed.length > 0) {
  console.error('[guard] FAIL: protected dependency metadata mutated by a Horca dependency operation:')
  for (const f of changed) console.error(`  ${f}`)
  process.exit(1)
}
console.log('[guard] PASS: protected dependency metadata byte-identical')

// command failure is reported, but only after isolation is verified
process.exit(exitCode)
