import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  caskVersionFromRuby,
  highestReleasedHorcaCore,
  parseStableVersion,
  pinnedUpstreamShaFromLock,
  publishRequested,
  selectReleaseCore,
  tapHasReachedRequestedVersion
} from './prepare-release.mjs'

const script = new URL('./prepare-release.mjs', import.meta.url).pathname

test('uses the latest Orca stable release as the Horca core', () => {
  assert.equal(parseStableVersion('v1.4.193'), '1.4.193')
  assert.equal(parseStableVersion('v1.4.178-rc.2'), null)
  assert.equal(selectReleaseCore('1.4.178-rc.2', 'v1.4.193'), '1.4.193')
  assert.equal(selectReleaseCore('1.4.178-rc.2', null), '1.4.178')
  assert.equal(selectReleaseCore('1.4.210', 'v1.4.201'), '1.4.210')
  assert.equal(selectReleaseCore('1.4.197', 'v1.4.201', '1.4.202'), '1.4.202')
  assert.equal(
    highestReleasedHorcaCore(['v1.4.201-horca.4', 'v1.4.202-horca.2', 'v1.4.201-horca-beta.9']),
    '1.4.202'
  )
})

test('treats a newer Homebrew cask as already confirming the requested release', () => {
  const cask = 'cask "horca" do\n  version "1.4.202-horca.2"\nend\n'
  assert.equal(caskVersionFromRuby(cask), '1.4.202-horca.2')
  assert.equal(tapHasReachedRequestedVersion('1.4.202-horca.2', '1.4.202-horca.2'), true)
  assert.equal(tapHasReachedRequestedVersion('1.4.202-horca.2', '1.4.201-horca.4'), true)
  assert.equal(tapHasReachedRequestedVersion('1.4.202-horca.2', '1.4.202-horca.3'), false)
  assert.equal(tapHasReachedRequestedVersion('1.4.201-horca.4', '1.4.202-horca.2'), false)

  const reached = spawnSync(process.execPath, [script, 'tap-has', '1.4.201-horca.4'], {
    encoding: 'utf8',
    input: 'cask "horca" do\n  version "1.4.202-horca.2"\nend\n'
  })
  assert.equal(reached.status, 0, reached.stderr)

  const missing = spawnSync(process.execPath, [script, 'tap-has', '1.4.202-horca.3'], {
    encoding: 'utf8',
    input: 'cask "horca" do\n  version "1.4.202-horca.2"\nend\n'
  })
  assert.equal(missing.status, 1)
})

test('reads the pinned Orca SHA from upstream.lock.json', () => {
  assert.equal(
    pinnedUpstreamShaFromLock({
      repository: 'https://github.com/stablyai/orca.git',
      commit: 'c'.repeat(40)
    }),
    'c'.repeat(40)
  )
  assert.equal(publishRequested('true'), true)
  assert.equal(publishRequested('false'), false)
  assert.throws(() => pinnedUpstreamShaFromLock({ commit: 'short' }))
})

test('writes a verifiable macOS release manifest', () => {
  const directory = mkdtempSync(join(tmpdir(), 'horca-release-test-'))
  for (const name of ['horca-macos-arm64.dmg', 'horca-macos-x64.dmg']) {
    writeFileSync(join(directory, name), name)
  }
  const result = spawnSync(process.execPath, [script, 'manifest', directory], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CHANNEL: 'stable',
      TAG: 'v1.4.203-horca.1',
      VERSION: '1.4.203-horca.1',
      SOURCE_SHA: 'a'.repeat(40),
      UPSTREAM_SHA: 'b'.repeat(40),
      UPSTREAM_VERSION: '1.4.203',
      BUILD_IDENTITY: 'd'.repeat(16),
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'rudironsoni/horca',
      GITHUB_RUN_ID: '123'
    }
  })
  assert.equal(result.status, 0, result.stderr)

  const manifest = JSON.parse(readFileSync(join(directory, 'horca-release.json'), 'utf8'))
  assert.equal(manifest.channel, 'stable')
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.upstreamSha, 'b'.repeat(40))
  assert.equal(manifest.buildIdentity, 'd'.repeat(16))
  assert.equal(manifest.artifacts.length, 2)
  assert.equal(manifest.artifacts[0].signed, true)
  assert.equal(manifest.artifacts[0].notarized, true)
  assert.equal(manifest.artifacts[1].arch, 'x64')
  assert.match(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), /horca-macos-x64\.dmg/)
  assert.doesNotMatch(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'), /windows/)
})
