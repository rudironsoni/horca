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
  return gitPathExists(cwd, 'rebase-merge') || gitPathExists(cwd, 'rebase-apply')
}

function gitPathExists(cwd, name) {
  const reported = git(cwd, ['rev-parse', '--git-path', name]).stdout.trim()
  return reported !== '' && existsSync(resolve(cwd, reported))
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

const GEOMETRY_TEST_PATH = 'src/renderer/src/assets/terminal-container-geometry.test.ts'
const TERMINAL_CSS_PATH = 'src/renderer/src/assets/terminal.css'
const MOBILE_APP_JSON_PATH = 'mobile/app.json'
const PAINT_CONTAINMENT = `  /* Why (#10481): a blinking cursor otherwise invalidates paint all the way up
     the pane ancestry. The link tooltip and drag handle are .pane siblings, so
     clipping to this box costs no visible chrome. */
  contain: paint;`

export function geometryItBlocks(source) {
  const blocks = []
  const startRe = /^  it\((['"])([^'"]+)\1/gm
  for (const match of source.matchAll(startRe)) {
    const from = match.index
    const end = source.indexOf('\n  })', from)
    if (end === -1) {
      continue
    }
    blocks.push({
      title: match[2],
      block: source.slice(from, end + '\n  })'.length)
    })
  }
  return blocks
}

export function mergeTerminalContainerGeometryTests(ours, theirs) {
  const seen = new Set()
  const tests = []
  for (const source of [theirs, ours]) {
    for (const test of geometryItBlocks(source)) {
      if (seen.has(test.title)) {
        continue
      }
      seen.add(test.title)
      tests.push(test)
    }
  }
  let merged = `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
${tests.map((test) => test.block).join('\n\n')}
})
`
  if (merged.includes('orca-terminal-container')) {
    merged = retargetGeometryTestXtermSelectors(merged)
  }
  return merged.endsWith('\n') ? merged : `${merged}\n`
}

export function retargetGeometryTestXtermSelectors(source) {
  return source
    .replaceAll('\\.xterm-helper-textarea', '\\.orca-terminal-helper-textarea')
    .replaceAll('\\.xterm-container', '\\.orca-terminal-container')
}

export function keepPaintContainmentInOverlayTerminalCss(ours, theirs) {
  if (theirs.includes('contain: paint') || !ours.includes('contain: paint')) {
    return theirs
  }
  const widthMarker = 'width: calc(100% - var(--pane-padding-x, 4px));'
  const widthAt = theirs.indexOf(widthMarker)
  if (widthAt === -1) {
    return theirs
  }
  const close = theirs.indexOf('\n}', widthAt)
  if (close === -1) {
    return theirs
  }
  return `${theirs.slice(0, close)}\n${PAINT_CONTAINMENT}${theirs.slice(close)}`
}

export function keepHorcaMobileIdentityWithUpstreamVersion(ours, theirs) {
  const oursVersion = /"version": "([^"]+)"/.exec(ours)?.[1]
  if (!oursVersion || !/"name": "Horca"/.test(theirs) || !/"slug": "horca-mobile"/.test(theirs)) {
    return theirs
  }
  return theirs.replace(/"version": "[^"]+"/, `"version": "${oursVersion}"`)
}

function stagedFile(cwd, stage, path) {
  const shown = git(cwd, ['show', `:${stage}:${path}`])
  if (shown.status !== 0) {
    return null
  }
  return shown.stdout
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

  if (listUnmerged(cwd).includes(GEOMETRY_TEST_PATH)) {
    const ours = stagedFile(cwd, '2', GEOMETRY_TEST_PATH)
    const theirs = stagedFile(cwd, '3', GEOMETRY_TEST_PATH)
    if (ours === null || theirs === null) {
      return 'unresolved'
    }
    writeFileSync(
      resolve(cwd, GEOMETRY_TEST_PATH),
      mergeTerminalContainerGeometryTests(ours, theirs)
    )
    git(cwd, ['add', '--', GEOMETRY_TEST_PATH])
  }

  if (listUnmerged(cwd).includes(TERMINAL_CSS_PATH)) {
    const ours = stagedFile(cwd, '2', TERMINAL_CSS_PATH)
    const theirs = stagedFile(cwd, '3', TERMINAL_CSS_PATH)
    if (ours === null || theirs === null) {
      return 'unresolved'
    }
    writeFileSync(
      resolve(cwd, TERMINAL_CSS_PATH),
      keepPaintContainmentInOverlayTerminalCss(ours, theirs)
    )
    git(cwd, ['add', '--', TERMINAL_CSS_PATH])
  }

  if (listUnmerged(cwd).includes(MOBILE_APP_JSON_PATH)) {
    const ours = stagedFile(cwd, '2', MOBILE_APP_JSON_PATH)
    const theirs = stagedFile(cwd, '3', MOBILE_APP_JSON_PATH)
    if (ours === null || theirs === null) {
      return 'unresolved'
    }
    writeFileSync(
      resolve(cwd, MOBILE_APP_JSON_PATH),
      keepHorcaMobileIdentityWithUpstreamVersion(ours, theirs)
    )
    git(cwd, ['add', '--', MOBILE_APP_JSON_PATH])
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
  if (continued.status === 0) {
    return rebaseInProgress(cwd) ? 'continued' : 'complete'
  }
  if (rebaseInProgress(cwd) && listUnmerged(cwd).length > 0) {
    return 'continued'
  }
  return 'unresolved'
}

const invokedAsScript =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (invokedAsScript) {
  process.exit(resolveOneSyncRebaseStop() === 'unresolved' ? 1 : 0)
}
