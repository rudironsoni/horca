import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

// Gate B2 Candidate B: compose the Horca probe into the disposable generated
// Orca workspace and regenerate a combined deterministic lock.
//
// Mutations to the generated view (all attributable to this composition):
//   pnpm-workspace.yaml  : add the probe as a workspace member
//   .horca/probes/...    : copied probe package (package.json + src)
//   pnpm-lock.yaml       : regenerated combined lock
//
// Upstream tracked files are never mutated outside the disposable worktree.

const ROOT = resolve(import.meta.dirname, '..')
const PROBE_SRC = resolve(ROOT, 'migration/probes/gate-b2/horca-probe')
const PROBE_DEST_REL = '.horca/probes/gate-b2/horca-probe'

function main() {
  const worktree = process.argv[2]
  if (!worktree || !existsSync(worktree)) {
    throw new Error('Usage: compose-candidate-b.mjs <worktree>')
  }

  const dest = resolve(worktree, PROBE_DEST_REL)
  mkdirSync(resolve(dest, 'src'), { recursive: true })
  copyFileSync(resolve(PROBE_SRC, 'package.json'), resolve(dest, 'package.json'))
  copyFileSync(resolve(PROBE_SRC, 'src/index.ts'), resolve(dest, 'src/index.ts'))

  const workspaceFile = resolve(worktree, 'pnpm-workspace.yaml')
  const ws = readFileSync(workspaceFile, 'utf8')
  const anchor = '  - native/windows-registry'
  if (ws.split(anchor).length - 1 !== 1) {
    throw new Error('pnpm-workspace.yaml anchor not unique; refusing to compose')
  }
  if (!ws.includes(PROBE_DEST_REL)) {
    writeFileSync(workspaceFile, ws.replace(anchor, `${anchor}\n  - ${PROBE_DEST_REL}`))
  }

  // Regenerate the combined lock deterministically.
  execSync('pnpm install --lockfile-only', { cwd: worktree, stdio: 'inherit' })
  console.log('[compose-candidate-b] composed probe into workspace and regenerated combined lock')
}

main()
