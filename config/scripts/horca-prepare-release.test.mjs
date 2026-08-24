import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const scriptPath = join(import.meta.dirname, 'horca-prepare-release.sh')

function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.email=test@example.com', '-c', 'user.name=test', ...args],
    {
      cwd,
      encoding: 'utf8'
    }
  ).trim()
}

function writeFakeGh(binDir) {
  const ghPath = join(binDir, 'gh')
  writeFileSync(ghPath, '#!/bin/sh\nexit 0\n')
  chmodSync(ghPath, 0o755)
  return ghPath
}

function runPrepare(cwd, env) {
  return execFileSync('bash', [scriptPath], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  })
}

describe('horca-prepare-release provenance', () => {
  it('records the contained upstream SHA when main lags the mirror tip', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-prepare-'))
    const binDir = join(root, 'bin')
    mkdirSync(binDir)
    writeFakeGh(binDir)

    git(root, 'init', '-b', 'main')
    writeFileSync(join(root, 'package.json'), '{"version":"1.4.178"}\n')
    git(root, 'add', 'package.json')
    git(root, 'commit', '-m', 'base')
    const contained = git(root, 'rev-parse', 'HEAD')

    git(root, 'checkout', '-b', 'upstream-main')
    writeFileSync(join(root, 'upstream.txt'), 'ahead\n')
    git(root, 'add', 'upstream.txt')
    git(root, 'commit', '-m', 'upstream ahead')
    const tip = git(root, 'rev-parse', 'HEAD')
    git(root, 'update-ref', 'refs/remotes/origin/upstream-main', tip)

    git(root, 'checkout', 'main')
    writeFileSync(join(root, 'horca.txt'), 'fork\n')
    git(root, 'add', 'horca.txt')
    git(root, 'commit', '-m', 'horca only')
    const source = git(root, 'rev-parse', 'HEAD')

    expect(source).toHaveLength(40)
    expect(tip).not.toBe(contained)

    const output = runPrepare(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      SOURCE_SHA: source,
      BUILDS_REPO: 'rudironsoni/orca',
      NOTES_PATH: join(root, 'release-notes.md')
    })

    expect(output).toContain(`upstream_sha=${contained}`)
    expect(output).not.toContain(`upstream_sha=${tip}`)
    expect(output).toMatch(/version=1\.4\.178-horca\.1/)
  })

  it('fails when SOURCE_SHA shares no history with origin/upstream-main', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-prepare-unrelated-'))
    const binDir = join(root, 'bin')
    mkdirSync(binDir)
    writeFakeGh(binDir)

    git(root, 'init', '-b', 'main')
    writeFileSync(join(root, 'package.json'), '{"version":"1.4.178"}\n')
    git(root, 'add', 'package.json')
    git(root, 'commit', '-m', 'base')
    git(root, 'update-ref', 'refs/remotes/origin/upstream-main', git(root, 'rev-parse', 'HEAD'))

    git(root, 'checkout', '--orphan', 'unrelated')
    writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n')
    git(root, 'add', 'package.json')
    git(root, 'commit', '-m', 'unrelated')
    const foreign = git(root, 'rev-parse', 'HEAD')

    try {
      runPrepare(root, {
        PATH: `${binDir}:${process.env.PATH}`,
        SOURCE_SHA: foreign,
        BUILDS_REPO: 'rudironsoni/orca',
        NOTES_PATH: join(root, 'release-notes.md')
      })
      throw new Error('expected prepare to fail')
    } catch (error) {
      expect(String(error.stderr ?? error.message)).toMatch(/shares no history/)
    }
  })
})
