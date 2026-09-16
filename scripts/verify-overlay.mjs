import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'

const ROOT = resolve(import.meta.dirname, '..')
const MANIFEST_FILE = process.env.HORCA_OVERLAY_MANIFEST
  ? resolve(process.env.HORCA_OVERLAY_MANIFEST)
  : resolve(ROOT, 'overlay', 'manifest.json')
const CACHE_DIR = resolve(ROOT, '.cache', 'upstream.git')

function getWorktreeDelta(worktreePath) {
  const status = execSync(`git status --porcelain=v2`, {
    cwd: worktreePath,
    encoding: 'utf8'
  }).trim()

  if (!status) {
    return { modified: [], added: [], deleted: [], renamed: [], untracked: [] }
  }

  const lines = status.split('\n')
  const delta = { modified: [], added: [], deleted: [], renamed: [], untracked: [] }

  for (const line of lines) {
    if (line.startsWith('1 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      const filename = parts[8]
      if (xy.includes('M')) delta.modified.push(filename)
      if (xy.includes('A')) delta.added.push(filename)
      if (xy.includes('D')) delta.deleted.push(filename)
      if (xy.includes('R')) delta.renamed.push(filename)
    } else if (line.startsWith('? ')) {
      const filename = line.slice(2)
      if (filename === '.horca-build-identity.json') continue
      delta.untracked.push(filename)
    } else if (line.startsWith('2 ')) {
      const parts = line.split(' ')
      const filename = parts[9]
      delta.renamed.push(filename)
    }
  }

  return delta
}

function verifyOverlay(worktreePath) {
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'))
  const { overrides = [] } = manifest

  const delta = getWorktreeDelta(worktreePath)
  const allChanges = [
    ...delta.modified.map(f => ({ type: 'modified', path: f })),
    ...delta.added.map(f => ({ type: 'added', path: f })),
    ...delta.deleted.map(f => ({ type: 'deleted', path: f })),
    ...delta.renamed.map(f => ({ type: 'renamed', path: f })),
    ...delta.untracked.map(f => ({ type: 'untracked', path: f }))
  ]

  if (allChanges.length === 0 && overrides.length === 0) {
    console.log('[verify-overlay] No overlays declared, worktree clean - PASS')
    return { success: true, changes: [], undeclared: [] }
  }

  const expectedPaths = new Set()
  for (const override of overrides) {
    if (override.target) {
      expectedPaths.add(override.target)
    }
    if (override.source && (override.mode === 'add' || override.mode === 'replace')) {
      expectedPaths.add(override.target)
    }
  }

  const undeclared = allChanges.filter(c => !expectedPaths.has(c.path))

  if (undeclared.length > 0) {
    console.error('[verify-overlay] UNDECLARED CHANGES DETECTED:')
    for (const u of undeclared) {
      console.error(`  ${u.type}: ${u.path}`)
    }
    return { success: false, changes: allChanges, undeclared }
  }

  // Postconditions: prove each declared override produced its deterministic result.
  for (const override of overrides) {
    if (override.mode !== 'substitute') continue
    const targetPath = resolve(worktreePath, override.target)
    if (!existsSync(targetPath)) {
      console.error(`[verify-overlay] POSTCONDITION FAILED: ${override.target} missing`)
      return { success: false, changes: allChanges, undeclared: [], postconditionFailed: override.target }
    }
    const content = readFileSync(targetPath, 'utf8')
    const post = override.postcondition ?? {}
    if (post.mustOccurExactlyOnce !== undefined) {
      const count = content.split(post.mustOccurExactlyOnce).length - 1
      if (count !== 1) {
        console.error(`[verify-overlay] POSTCONDITION FAILED: ${override.target} replace sentinel count=${count}`)
        return { success: false, changes: allChanges, undeclared: [], postconditionFailed: override.target }
      }
    }
    if (post.mustNotOccur !== undefined && content.includes(post.mustNotOccur)) {
      console.error(`[verify-overlay] POSTCONDITION FAILED: ${override.target} find sentinel still present`)
      return { success: false, changes: allChanges, undeclared: [], postconditionFailed: override.target }
    }
    if (post.resultingBlobSha256 !== undefined) {
      const digest = createHash('sha256').update(content).digest('hex')
      if (digest !== post.resultingBlobSha256) {
        console.error(
          `[verify-overlay] POSTCONDITION FAILED: ${override.target} blob sha256 ${digest} != ${post.resultingBlobSha256}`
        )
        return { success: false, changes: allChanges, undeclared: [], postconditionFailed: override.target }
      }
      console.log(`[verify-overlay] ${override.target} postcondition blob sha256 OK`)
    }
  }

  console.log('[verify-overlay] All changes match declared overlays - PASS')
  return { success: true, changes: allChanges, undeclared: [] }
}

function verifyWorktreeCleanup() {
  const list = execSync(`git worktree list --porcelain`, {
    cwd: CACHE_DIR,
    encoding: 'utf8'
  }).trim()

  const worktrees = list.split('\n\n').filter(Boolean)
  const paths = worktrees.map(w => {
    const match = w.match(/worktree (.+)/)
    return match ? match[1] : null
  }).filter(Boolean)

  console.log('[verify-overlay] Current worktree registrations:', paths.length)
  for (const p of paths) {
    console.log(`  ${p}`)
  }
  return paths
}

function main() {
  const worktreePath = process.argv[2]
  if (!worktreePath) {
    throw new Error('Usage: verify-overlay.mjs <worktree-path>')
  }

  const result = verifyOverlay(worktreePath)
  verifyWorktreeCleanup()
  
  if (!result.success) {
    process.exit(1)
  }
}

main()
