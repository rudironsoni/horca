import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { computeBuildIdentityRecord } from './build-identity.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const CACHE_DIR = resolve(ROOT, '.cache', 'upstream.git')
const WORKTREES_DIR = resolve(ROOT, '.cache', 'worktrees')

function main() {
  const record = computeBuildIdentityRecord(ROOT)
  const { upstreamSha, overlayDigest, depLockDigest, productDigest, productionDigest, buildIdentity } = record
  const runId = process.env.GITHUB_RUN_ID || process.env.BUILD_ID || `local-${Date.now()}`
  const worktreePath = resolve(WORKTREES_DIR, upstreamSha, `${overlayDigest}-${runId}`)

  console.log(`[materialize] Upstream SHA: ${upstreamSha}`)
  console.log(`[materialize] Overlay digest: ${overlayDigest}`)
  console.log(`[materialize] Build identity: ${buildIdentity}`)
  console.log(`[materialize] Materializing to: ${worktreePath}`)

  // Ensure worktrees directory exists
  mkdirSync(WORKTREES_DIR, { recursive: true })

  // Remove existing worktree at this path if present (Git-aware cleanup)
  if (existsSync(worktreePath)) {
    console.log(`[materialize] Removing existing worktree at ${worktreePath}`)
    try {
      execSync(`git worktree remove --force ${worktreePath}`, {
        cwd: CACHE_DIR,
        stdio: 'inherit'
      })
    } catch {
      // Fallback if worktree remove fails
      rmSync(worktreePath, { recursive: true, force: true })
    }
  }

  // Prune stale worktree metadata
  execSync(`git worktree prune --expire now`, { cwd: CACHE_DIR, stdio: 'pipe' })

  // Create detached worktree at exact locked commit
  execSync(`git worktree add --detach ${worktreePath} ${upstreamSha}`, {
    cwd: CACHE_DIR,
    stdio: 'inherit'
  })

  // Verify worktree HEAD matches locked SHA
  const head = execSync(`git rev-parse HEAD`, { cwd: worktreePath, encoding: 'utf8' }).trim()
  if (head !== upstreamSha) {
    throw new Error(`Worktree HEAD (${head}) does not match locked SHA (${upstreamSha})`)
  }

  // Verify worktree is clean before overlays
  const statusBefore = execSync(`git status --porcelain`, { cwd: worktreePath, encoding: 'utf8' }).trim()
  if (statusBefore) {
    throw new Error(`Worktree not clean before overlays:\n${statusBefore}`)
  }

  // Write build identity file for downstream tooling
  writeFileSync(
    resolve(worktreePath, '.horca-build-identity.json'),
    JSON.stringify({ ...record, runId }, null, 2)
  )

  console.log(`[materialize] Worktree created and verified at ${worktreePath}`)
  console.log(`[materialize] BuildIdentity: ${buildIdentity}`)

  // Output path for orchestration
  process.stdout.write(worktreePath)
}

main()
