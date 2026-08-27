import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const scriptPath = join(import.meta.dirname, 'horca-brew-style-cask.sh')

function writeFakeBrew(binDir, brewRoot, logPath) {
  const brewPath = join(binDir, 'brew')
  writeFileSync(
    brewPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$BREW_LOG"
if [ "\${1:-}" = "--repository" ] || [ "\${1:-}" = "--repo" ]; then
  if [ "\${2:-}" = "rudironsoni/tap" ]; then
    printf '%s\\n' "$BREW_ROOT/Library/Taps/rudironsoni/homebrew-tap"
    exit 0
  fi
  printf '%s\\n' "$BREW_ROOT"
  exit 0
fi
`
  )
  chmodSync(brewPath, 0o755)
  writeFileSync(logPath, '')
  return { BREW_ROOT: brewRoot, BREW_LOG: logPath }
}

function runStyle(cwd, env) {
  return execFileSync('bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

describe('horca-brew-style-cask', () => {
  it('symlinks the tap checkout and styles the tap-qualified cask', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-brew-style-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    const brewRoot = join(root, 'brew')
    mkdirSync(binDir)
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFileSync(join(tapDir, 'Casks/horca@beta.rb'), 'cask "horca@beta" do\nend\n')
    const logPath = join(root, 'brew.log')
    const brewEnv = writeFakeBrew(binDir, brewRoot, logPath)

    runStyle(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      CASK_TOKEN: 'horca@beta',
      TAP_DIR: tapDir,
      ...brewEnv
    })

    const tapLink = join(brewRoot, 'Library/Taps/rudironsoni/homebrew-tap')
    expect(lstatSync(tapLink).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(tapLink, 'Casks/horca@beta.rb'), 'utf8')).toContain('horca@beta')
    expect(readFileSync(logPath, 'utf8')).toContain('style --fix --cask rudironsoni/tap/horca@beta')
    expect(readFileSync(logPath, 'utf8')).toContain('style --cask rudironsoni/tap/horca@beta')
    expect(readFileSync(logPath, 'utf8')).toContain('audit --cask rudironsoni/tap/horca@beta')
  })

  it('replaces an existing tap clone with a symlink to TAP_DIR', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-brew-style-replace-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    const brewRoot = join(root, 'brew')
    const stale = join(brewRoot, 'Library/Taps/rudironsoni/homebrew-tap')
    mkdirSync(binDir)
    mkdirSync(tapDir)
    mkdirSync(join(stale, 'Casks'), { recursive: true })
    writeFileSync(join(stale, 'Casks/stale.rb'), 'stale\n')
    writeFileSync(join(tapDir, 'fresh.txt'), 'fresh\n')
    const logPath = join(root, 'brew.log')
    const brewEnv = writeFakeBrew(binDir, brewRoot, logPath)

    runStyle(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      CASK_TOKEN: 'horca',
      TAP_DIR: tapDir,
      ...brewEnv
    })

    expect(lstatSync(stale).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(stale, 'fresh.txt'), 'utf8')).toBe('fresh\n')
  })

  it('rejects an unknown cask token', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-brew-style-bad-'))
    expect(() =>
      runStyle(root, {
        CASK_TOKEN: 'orca',
        TAP_DIR: root
      })
    ).toThrow(/horca@beta/)
  })
})
