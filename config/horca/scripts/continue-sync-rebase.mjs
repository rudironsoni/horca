#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLED_PSL = `const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'psl',`
const BUNDLED_TLDTS = `const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'tldts',`
export const PNPM_LOCKFILE_ONLY_COMMAND = 'corepack'
export const PNPM_LOCKFILE_ONLY_ARGS = ['pnpm', 'install', '--lockfile-only', '--ignore-scripts']

export function git(cwd, args, extraEnv = {}) {
  return spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...extraEnv }
  })
}

export function rebaseInProgress(cwd) {
  return (
    existsSync(resolve(cwd, '.git/rebase-merge')) || existsSync(resolve(cwd, '.git/rebase-apply'))
  )
}

export function listUnmerged(cwd) {
  const stdout = git(cwd, ['diff', '--name-only', '--diff-filter=U']).stdout.trim()
  return stdout === '' ? [] : stdout.split('\n')
}

export function pathsDeletedByTheirs(cwd) {
  const stages = new Map()
  for (const line of git(cwd, ['ls-files', '-u']).stdout.split('\n').filter(Boolean)) {
    const tab = line.indexOf('\t')
    const stage = metaStage(line.slice(0, tab))
    const path = line.slice(tab + 1)
    const set = stages.get(path) ?? new Set()
    set.add(stage)
    stages.set(path, set)
  }
  return [...stages.entries()]
    .filter(([, set]) => set.has('1') && set.has('2') && !set.has('3'))
    .map(([path]) => path)
}

function metaStage(meta) {
  return meta.trim().split(/\s+/)[2]
}

export function preferUpstreamTldtsInBundledMain(source) {
  return source.replace(BUNDLED_PSL, BUNDLED_TLDTS)
}

function runPnpmLockfileOnly(cwd) {
  return spawnSync(PNPM_LOCKFILE_ONLY_COMMAND, PNPM_LOCKFILE_ONLY_ARGS, {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  })
}

export function resolveOneSyncRebaseStop(cwd = process.cwd()) {
  if (!rebaseInProgress(cwd)) {
    return 'complete'
  }

  for (const path of pathsDeletedByTheirs(cwd)) {
    const removed = git(cwd, ['rm', '-f', '--', path])
    if (removed.status !== 0) {
      return 'unresolved'
    }
  }

  if (listUnmerged(cwd).includes('electron.vite.config.ts')) {
    const checkout = git(cwd, ['checkout', '--theirs', '--', 'electron.vite.config.ts'])
    if (checkout.status !== 0) {
      return 'unresolved'
    }
    const file = resolve(cwd, 'electron.vite.config.ts')
    writeFileSync(file, preferUpstreamTldtsInBundledMain(readFileSync(file, 'utf8')))
    git(cwd, ['add', '--', 'electron.vite.config.ts'])
  }

  const remaining = listUnmerged(cwd)
  if (remaining.length === 1 && remaining[0] === 'pnpm-lock.yaml') {
    const reset = git(cwd, ['checkout', '--ours', '--', 'pnpm-lock.yaml'])
    if (reset.status !== 0) {
      return 'unresolved'
    }
    const install = runPnpmLockfileOnly(cwd)
    if (install.status !== 0) {
      return 'unresolved'
    }
    git(cwd, ['add', '--', 'pnpm-lock.yaml'])
  }

  if (listUnmerged(cwd).length > 0) {
    return 'unresolved'
  }

  const continued = git(cwd, ['rebase', '--continue'], { GIT_EDITOR: 'true' })
  if (continued.status !== 0) {
    return 'unresolved'
  }
  return rebaseInProgress(cwd) ? 'continued' : 'complete'
}

const invokedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  process.exit(resolveOneSyncRebaseStop() === 'unresolved' ? 1 : 0)
}
