import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

const scriptPath = join(import.meta.dirname, 'horca-bump-homebrew-cask.sh')

const SAMPLE_CASK = `cask "horca" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0-horca.0"
  sha256 arm:   "REPLACE_WITH_ARM64_SHA256",
         intel: "REPLACE_WITH_X64_SHA256"

  url "https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg"
end
`

const SAMPLE_BETA_CASK = `cask "horca@beta" do
  arch arm: "arm64", intel: "x64"

  version "0.0.0-horca.0-beta.0"
  sha256 arm:   "REPLACE_WITH_ARM64_SHA256",
         intel: "REPLACE_WITH_X64_SHA256"

  url "https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg"
end
`

function writeFakeGh(binDir) {
  const ghPath = join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/usr/bin/env bash
set -euo pipefail
dir=""
pattern=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) dir="$2"; shift 2 ;;
    --pattern) pattern="$2"; shift 2 ;;
    --repo) shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$dir"
case "$pattern" in
  *arm64*) printf 'arm-dmg' >"$dir/horca-macos-arm64.dmg" ;;
  *x64*) printf 'x64-dmg' >"$dir/horca-macos-x64.dmg" ;;
  *) echo "unexpected pattern: $pattern" >&2; exit 1 ;;
esac
`
  )
  chmodSync(ghPath, 0o755)
}

function runBump(cwd, env) {
  return execFileSync('bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

describe('horca-bump-homebrew-cask', () => {
  it('normalizes legacy depends_on macos syntax when bumping', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-macos-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    mkdirSync(binDir)
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFakeGh(binDir)
    writeFileSync(
      join(tapDir, 'Casks/horca.rb'),
      `${SAMPLE_CASK}\n  depends_on macos: ">= :big_sur"\n`
    )
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')

    runBump(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      VERSION: '1.4.178-horca.2',
      TAP_DIR: tapDir,
      GITHUB_OUTPUT: outputPath
    })

    const cask = readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')
    expect(cask).toContain('depends_on macos: :big_sur')
    expect(cask).not.toContain('depends_on macos: ">=')
  })

  it('rewrites version and sha256s from the published DMGs', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    mkdirSync(binDir)
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFakeGh(binDir)
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')

    const stdout = runBump(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      VERSION: '1.4.178-horca.2',
      TAP_DIR: tapDir,
      GITHUB_OUTPUT: outputPath
    })

    const cask = readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')
    const shaArm = createHash('sha256').update('arm-dmg').digest('hex')
    const shaX64 = createHash('sha256').update('x64-dmg').digest('hex')
    expect(stdout).toContain('target: 1.4.178-horca.2')
    expect(cask).toContain('version "1.4.178-horca.2"')
    expect(cask).toContain(`sha256 arm:   "${shaArm}",`)
    expect(cask).toContain(`intel: "${shaX64}"`)
    expect(readFileSync(outputPath, 'utf8')).toContain('changed=true')
  })

  it('is a no-op when the cask is already at VERSION', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-noop-'))
    const tapDir = join(root, 'tap')
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFileSync(
      join(tapDir, 'Casks/horca.rb'),
      SAMPLE_CASK.replace('0.0.0-horca.0', '1.4.178-horca.1')
    )
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')

    runBump(root, {
      VERSION: '1.4.178-horca.1',
      TAP_DIR: tapDir,
      GITHUB_OUTPUT: outputPath
    })

    expect(readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')).toContain(
      'REPLACE_WITH_ARM64_SHA256'
    )
    expect(readFileSync(outputPath, 'utf8')).toContain('changed=false')
  })

  it('rejects a non-Horca version', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-bad-'))
    const tapDir = join(root, 'tap')
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)

    expect(() =>
      runBump(root, {
        VERSION: '1.4.178',
        TAP_DIR: tapDir
      })
    ).toThrow(/horca/)
  })

  it('rejects a beta version when bumping the stable cask', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-stable-beta-'))
    const tapDir = join(root, 'tap')
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)
    writeFileSync(join(tapDir, 'Casks/horca@beta.rb'), SAMPLE_BETA_CASK)

    expect(() =>
      runBump(root, {
        VERSION: '1.4.178-horca.2-beta.1',
        TAP_DIR: tapDir,
        CASK_TOKEN: 'horca'
      })
    ).toThrow(/horca\.<N>/)
    expect(readFileSync(join(tapDir, 'Casks/horca@beta.rb'), 'utf8')).toBe(SAMPLE_BETA_CASK)
    expect(readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')).toBe(SAMPLE_CASK)
  })

  it('rejects a stable version when bumping horca@beta', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-beta-stable-'))
    const tapDir = join(root, 'tap')
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)
    writeFileSync(join(tapDir, 'Casks/horca@beta.rb'), SAMPLE_BETA_CASK)

    expect(() =>
      runBump(root, {
        VERSION: '1.4.178-horca.2',
        TAP_DIR: tapDir,
        CASK_TOKEN: 'horca@beta'
      })
    ).toThrow(/beta/)
    expect(readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')).toBe(SAMPLE_CASK)
  })

  it('rewrites only horca@beta.rb for a beta version', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-beta-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    mkdirSync(binDir)
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    writeFakeGh(binDir)
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)
    writeFileSync(join(tapDir, 'Casks/horca@beta.rb'), SAMPLE_BETA_CASK)
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')

    runBump(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      VERSION: '1.4.178-horca.2-beta.1',
      TAP_DIR: tapDir,
      CASK_TOKEN: 'horca@beta',
      GITHUB_OUTPUT: outputPath
    })

    const shaArm = createHash('sha256').update('arm-dmg').digest('hex')
    const shaX64 = createHash('sha256').update('x64-dmg').digest('hex')
    const betaCask = readFileSync(join(tapDir, 'Casks/horca@beta.rb'), 'utf8')
    expect(betaCask).toContain('version "1.4.178-horca.2-beta.1"')
    expect(betaCask).toContain(`sha256 arm:   "${shaArm}",`)
    expect(betaCask).toContain(`intel: "${shaX64}"`)
    expect(readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')).toBe(SAMPLE_CASK)
    expect(readFileSync(outputPath, 'utf8')).toContain('changed=true')
  })

  it('copies a missing tap cask from staging then fills version and sha256', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-bump-copy-'))
    const binDir = join(root, 'bin')
    const tapDir = join(root, 'tap')
    const stagingDir = join(root, 'staging')
    mkdirSync(binDir)
    mkdirSync(join(tapDir, 'Casks'), { recursive: true })
    mkdirSync(stagingDir)
    writeFakeGh(binDir)
    writeFileSync(join(tapDir, 'Casks/horca.rb'), SAMPLE_CASK)
    writeFileSync(join(stagingDir, 'horca@beta.rb'), SAMPLE_BETA_CASK)
    const outputPath = join(root, 'github-output')
    writeFileSync(outputPath, '')

    runBump(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      VERSION: '1.4.178-horca.2-beta.1',
      TAP_DIR: tapDir,
      CASK_TOKEN: 'horca@beta',
      STAGING_CASK: join(stagingDir, 'horca@beta.rb'),
      GITHUB_OUTPUT: outputPath
    })

    expect(readFileSync(join(tapDir, 'Casks/horca@beta.rb'), 'utf8')).toContain(
      'version "1.4.178-horca.2-beta.1"'
    )
    expect(readFileSync(join(tapDir, 'Casks/horca.rb'), 'utf8')).toBe(SAMPLE_CASK)
    expect(readFileSync(join(stagingDir, 'horca@beta.rb'), 'utf8')).toBe(SAMPLE_BETA_CASK)
    expect(readFileSync(outputPath, 'utf8')).toContain('changed=true')
  })
})
