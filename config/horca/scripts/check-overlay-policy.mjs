#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const policy = JSON.parse(
  readFileSync(join(repoRoot, 'config', 'horca', 'overlay-policy.json'), 'utf8')
)
const upstreamRef = process.env.HORCA_UPSTREAM_REF || policy.upstreamRef

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function isForkOnly(path) {
  return (
    policy.forkOnlyPaths.includes(path) ||
    policy.forkOnlyPrefixes.some((prefix) => path.startsWith(prefix))
  )
}

const allowedOverlays = new Map()
for (const [topic, paths] of Object.entries(policy.allowedOverlays)) {
  for (const path of paths) {
    if (allowedOverlays.has(path)) {
      throw new Error(`Overlay ${path} is assigned to more than one topic`)
    }
    allowedOverlays.set(path, topic)
  }
}

const changes = git(['diff', '--name-status', `${upstreamRef}...HEAD`])
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [status, ...paths] = line.split('\t')
    return { status: status[0], path: paths.at(-1) }
  })

const failures = []
let forkOnlyFiles = 0
let modifiedUpstreamFiles = 0
let deletedUpstreamFiles = 0

for (const change of changes) {
  if (change.status === 'A' && isForkOnly(change.path)) {
    forkOnlyFiles += 1
    continue
  }
  if (change.status === 'D') {
    deletedUpstreamFiles += 1
    failures.push(`Deleted upstream file: ${change.path}`)
    continue
  }
  modifiedUpstreamFiles += 1
  const denied = policy.deniedOverlayPrefixes.find((prefix) => change.path.startsWith(prefix))
  if (denied) {
    failures.push(`Denied overlay (${denied}): ${change.path}`)
  } else if (!allowedOverlays.has(change.path)) {
    failures.push(`Unregistered upstream overlay: ${change.path}`)
  }
}

const changedPaths = new Set(changes.map((change) => change.path))
const stale = [...allowedOverlays.keys()].filter((path) => !changedPaths.has(path))

console.log('Horca downstream delta')
console.log(`Upstream: ${upstreamRef}@${git(['rev-parse', '--short=12', upstreamRef])}`)
console.log(`Fork-only files: ${forkOnlyFiles}`)
console.log(`Modified upstream files: ${modifiedUpstreamFiles}`)
console.log(`Deleted upstream files: ${deletedUpstreamFiles}`)
for (const [topic, paths] of Object.entries(policy.allowedOverlays)) {
  const active = paths.filter((path) => changedPaths.has(path)).length
  console.log(`Overlay topic ${topic}: ${active}`)
}
if (stale.length > 0) {
  console.log(`Stale policy entries: ${stale.length}`)
  for (const path of stale) {
    console.log(`  ${path}`)
  }
}
if (failures.length > 0) {
  console.error('\nOverlay policy failed:')
  for (const failure of failures) {
    console.error(`  ${failure}`)
  }
  process.exit(1)
}
