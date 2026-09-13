import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PNPM_LOCKFILE_ONLY_ARGS,
  PNPM_LOCKFILE_ONLY_COMMAND,
  preferUpstreamTldtsInBundledMain,
  resolveOneSyncRebaseStop
} from './continue-sync-rebase.mjs'

const tempDirs = []

after(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'horca-continue-rebase-'))
  tempDirs.push(root)
  git(root, ['init', '--quiet', '-b', 'main'])
  git(root, ['config', 'user.name', 'Rudimar Ronsoni'])
  git(root, ['config', 'user.email', 'rudimar@outlook.com'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

describe('continue-sync-rebase', () => {
  it('keeps overlay Ghostty bundling and takes upstream tldts', () => {
    const source = [
      'const BUNDLED_MAIN_DEPENDENCIES = new Set([',
      "  'psl',",
      "  'zod',",
      "  '@herdr/sdk'",
      '])'
    ].join('\n')

    assert.equal(
      preferUpstreamTldtsInBundledMain(source),
      [
        'const BUNDLED_MAIN_DEPENDENCIES = new Set([',
        "  'tldts',",
        "  'zod',",
        "  '@herdr/sdk'",
        '])'
      ].join('\n')
    )
  })

  it('regenerates lockfiles through corepack pnpm', () => {
    assert.equal(PNPM_LOCKFILE_ONLY_COMMAND, 'corepack')
    assert.deepEqual(PNPM_LOCKFILE_ONLY_ARGS, [
      'pnpm',
      'install',
      '--lockfile-only',
      '--ignore-scripts'
    ])
  })

  it('keeps overlay deletions and retargets psl to tldts', () => {
    const root = initRepo()
    writeFileSync(join(root, 'keep.txt'), 'base\n')
    writeFileSync(join(root, 'drop.txt'), 'xterm\n')
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'psl'\n])\n"
    )
    git(root, ['add', 'keep.txt', 'drop.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'base'])

    git(root, ['checkout', '--quiet', '-b', 'overlay'])
    writeFileSync(join(root, 'keep.txt'), 'overlay\n')
    git(root, ['rm', '--quiet', 'drop.txt'])
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'psl',\n  '@herdr/sdk'\n])\n"
    )
    git(root, ['add', 'keep.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'overlay'])

    git(root, ['checkout', '--quiet', 'main'])
    writeFileSync(join(root, 'drop.txt'), 'upstream edited xterm\n')
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'tldts',\n  'zod'\n])\n"
    )
    git(root, ['add', 'drop.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'upstream'])

    const rebase = spawnSync('git', ['rebase', 'main', 'overlay'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(rebase.status, 0)
    assert.equal(resolveOneSyncRebaseStop(root), 'complete')
    const bundled = git(root, ['show', 'HEAD:electron.vite.config.ts'])
    assert.equal(bundled.includes("'tldts'"), true)
    assert.equal(bundled.includes('@herdr/sdk'), true)
    assert.equal(bundled.includes("'psl'"), false)
    const missing = spawnSync('git', ['show', 'HEAD:drop.txt'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
  })
})
