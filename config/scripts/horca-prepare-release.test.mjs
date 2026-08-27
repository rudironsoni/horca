import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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

function writeFakeGh(binDir, ndjson = '') {
  const ghPath = join(binDir, 'gh')
  writeFileSync(
    ghPath,
    `#!/bin/sh
cat <<'GH_NDJSON'
${ndjson}
GH_NDJSON
`
  )
  chmodSync(ghPath, 0o755)
  return ghPath
}

function seedPrepareRepo() {
  const root = mkdtempSync(join(tmpdir(), 'horca-prepare-'))
  const binDir = join(root, 'bin')
  mkdirSync(binDir)
  git(root, 'init', '-b', 'main')
  writeFileSync(join(root, 'package.json'), '{"version":"1.4.178"}\n')
  git(root, 'add', 'package.json')
  git(root, 'commit', '-m', 'base')
  const contained = git(root, 'rev-parse', 'HEAD')
  git(root, 'update-ref', 'refs/remotes/origin/upstream-main', contained)
  writeFileSync(join(root, 'horca.txt'), 'fork\n')
  git(root, 'add', 'horca.txt')
  git(root, 'commit', '-m', 'horca only')
  return { root, binDir, source: git(root, 'rev-parse', 'HEAD') }
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
      NOTES_PATH: join(root, 'release-notes.md'),
      HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main'
    })

    expect(output).toContain(`upstream_sha=${contained}`)
    expect(output).not.toContain(`upstream_sha=${tip}`)
    expect(output).toMatch(/version=1\.4\.178-horca\.1/)
  })

  it('fails when SOURCE_SHA shares no history with the upstream tip', () => {
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
        NOTES_PATH: join(root, 'release-notes.md'),
        HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main'
      })
      throw new Error('expected prepare to fail')
    } catch (error) {
      expect(String(error.stderr ?? error.message)).toMatch(/shares no history/)
    }
  })
})

describe('horca-prepare-release channel versions', () => {
  const stableAndBetaNdjson = [
    '{"tag_name":"v1.4.178-horca.1","body":"","draft":false,"created_at":"2026-01-01T00:00:00Z"}',
    '{"tag_name":"v1.4.178-horca.2-beta.1","body":"","draft":false,"created_at":"2026-01-02T00:00:00Z"}'
  ].join('\n')

  it('ignores beta tags when computing the next stable N', () => {
    const { root, binDir, source } = seedPrepareRepo()
    writeFakeGh(binDir, stableAndBetaNdjson)

    const output = runPrepare(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      SOURCE_SHA: source,
      BUILDS_REPO: 'rudironsoni/orca',
      NOTES_PATH: join(root, 'release-notes.md'),
      HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main'
    })

    expect(output).toMatch(/^version=1\.4\.178-horca\.2$/m)
    expect(output).not.toContain('beta')
  })

  it('uses the pending stable N and next M for beta', () => {
    const { root, binDir, source } = seedPrepareRepo()
    writeFakeGh(binDir, stableAndBetaNdjson)

    const output = runPrepare(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      SOURCE_SHA: source,
      BUILDS_REPO: 'rudironsoni/orca',
      NOTES_PATH: join(root, 'release-notes.md'),
      HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main',
      HORCA_CHANNEL: 'beta',
      HORCA_BRANCH: 'feature/beta-math'
    })

    expect(output).toContain('version=1.4.178-horca.2-beta.2')
    expect(output).toContain('tag=v1.4.178-horca.2-beta.2')
    const notes = readFileSync(join(root, 'release-notes.md'), 'utf8')
    expect(notes).toContain('Channel: beta')
    expect(notes).toContain('Branch: feature/beta-math')
    expect(notes).toContain('brew install --cask rudironsoni/tap/horca@beta')
    expect(notes).not.toContain('rudironsoni/tap/horca`')
  })

  it('starts beta.1 on the pending N when no betas exist yet', () => {
    const { root, binDir, source } = seedPrepareRepo()
    writeFakeGh(binDir, '')

    const output = runPrepare(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      SOURCE_SHA: source,
      BUILDS_REPO: 'rudironsoni/orca',
      NOTES_PATH: join(root, 'release-notes.md'),
      HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main',
      HORCA_CHANNEL: 'beta'
    })

    expect(output).toContain('version=1.4.178-horca.1-beta.1')
  })

  it('ignores draft betas and betas for an already-released N', () => {
    const { root, binDir, source } = seedPrepareRepo()
    writeFakeGh(
      binDir,
      [
        '{"tag_name":"v1.4.178-horca.1","body":"","draft":false,"created_at":"2026-01-01T00:00:00Z"}',
        '{"tag_name":"v1.4.178-horca.2-beta.1","body":"","draft":true,"created_at":"2026-01-02T00:00:00Z"}',
        '{"tag_name":"v1.4.178-horca.1-beta.9","body":"","draft":false,"created_at":"2026-01-03T00:00:00Z"}'
      ].join('\n')
    )

    const output = runPrepare(root, {
      PATH: `${binDir}:${process.env.PATH}`,
      SOURCE_SHA: source,
      BUILDS_REPO: 'rudironsoni/orca',
      NOTES_PATH: join(root, 'release-notes.md'),
      HORCA_UPSTREAM_TIP_REF: 'origin/upstream-main',
      HORCA_CHANNEL: 'beta'
    })

    expect(output).toContain('version=1.4.178-horca.2-beta.1')
  })

  it('rejects an unknown HORCA_CHANNEL', () => {
    try {
      runPrepare(process.cwd(), {
        SOURCE_SHA: 'a'.repeat(40),
        BUILDS_REPO: 'rudironsoni/orca',
        HORCA_CHANNEL: 'nightly'
      })
      throw new Error('expected prepare to fail')
    } catch (error) {
      expect(String(error.stderr ?? error.message)).toMatch(/stable or beta/)
    }
  })
})
