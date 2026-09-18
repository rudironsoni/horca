#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { computeBuildIdentityRecord } from '../../../scripts/build-identity.mjs'

const repoRoot = join(import.meta.dirname, '..', '..', '..')
const stableTag = /^v(\d+)\.(\d+)\.(\d+)-horca\.(\d+)$/
const betaTag = /^v(\d+)\.(\d+)\.(\d+)-horca-beta\.(\d+)$/

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`)
  }
  return result.stdout.trim()
}

function output(name, value) {
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}

function packageVersion(commit) {
  return JSON.parse(git(['show', `${commit}:package.json`])).version
}

export function parseStableVersion(tag) {
  return tag.match(/^v?(\d+\.\d+\.\d+)$/)?.[1] ?? null
}

export function compareVersion(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  const length = Math.max(leftParts.length, rightParts.length)
  for (let i = 0; i < length; i += 1) {
    const delta = (leftParts[i] ?? 0) - (rightParts[i] ?? 0)
    if (delta !== 0) {
      return delta
    }
  }
  return 0
}

export function highestReleasedHorcaCore(tags) {
  let highest = null
  for (const tag of tags) {
    const match = stableTag.exec(tag) ?? betaTag.exec(tag)
    if (!match) {
      continue
    }
    const core = `${match[1]}.${match[2]}.${match[3]}`
    if (highest === null || compareVersion(core, highest) > 0) {
      highest = core
    }
  }
  return highest
}

export function selectReleaseCore(packageVer, orcaStableVersion, releasedFloor = null) {
  const packageCore = packageVer.match(/^(\d+\.\d+\.\d+)/)?.[1]
  const orcaCore = parseStableVersion(orcaStableVersion ?? '')
  const candidates = [packageCore, orcaCore, releasedFloor].filter(Boolean)
  if (candidates.length === 0) {
    return null
  }
  return candidates.reduce((highest, candidate) =>
    compareVersion(candidate, highest) > 0 ? candidate : highest
  )
}

export function caskVersionFromRuby(source) {
  return source.match(/^\s*version\s+"([^"]+)"/m)?.[1] ?? null
}

export function parseHorcaReleaseVersion(version) {
  const match = version.trim().match(/^(\d+\.\d+\.\d+)(?:-horca(?:-beta)?\.(\d+))?$/)
  if (!match) {
    return null
  }
  return { core: match[1], suffix: match[2] ? Number(match[2]) : 0 }
}

export function pinnedUpstreamShaFromLock(lock) {
  const parsed = typeof lock === 'string' ? JSON.parse(lock) : lock
  const commit = parsed?.commit
  if (typeof commit !== 'string' || commit.length !== 40) {
    throw new Error(`Invalid commit in upstream.lock.json: ${commit}`)
  }
  return commit
}

export function publishRequested(value = process.env.PUBLISH) {
  return value === 'true' || value === '1'
}

export function tapHasReachedRequestedVersion(tapVersion, requestedVersion) {
  if (tapVersion === requestedVersion) {
    return true
  }
  const tap = parseHorcaReleaseVersion(tapVersion)
  const requested = parseHorcaReleaseVersion(requestedVersion)
  if (!tap || !requested) {
    return false
  }
  const coreDelta = compareVersion(tap.core, requested.core)
  if (coreDelta !== 0) {
    return coreDelta > 0
  }
  return tap.suffix >= requested.suffix
}

function highestLocalStableVersion() {
  const versions = git(['tag', '--list', 'v*'])
    .split('\n')
    .flatMap((tag) => {
      const version = parseStableVersion(tag)
      return version ? [version] : []
    })
  versions.sort((left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  })
  return versions.at(-1) ?? null
}

async function latestOrcaStableVersion() {
  const release = await github('/repos/stablyai/orca/releases/latest')
  return parseStableVersion(release?.tag_name ?? '') ?? highestLocalStableVersion()
}

function resolveSource(sourceRef, channel, publish) {
  git(['fetch', '--no-prune-tags', 'origin', '+refs/heads/*:refs/remotes/origin/*'])
  git(['fetch', '--no-prune-tags', 'origin', 'refs/tags/*:refs/tags/*'])
  let sourceSha
  if (/^[a-f0-9]{40}$/.test(sourceRef)) {
    sourceSha = git(['rev-parse', `${sourceRef}^{commit}`])
  } else {
    if (!sourceRef || sourceRef.startsWith('-')) {
      throw new Error(`Invalid source branch: ${sourceRef}`)
    }
    git(['check-ref-format', '--branch', sourceRef])
    sourceSha = git(['rev-parse', `refs/remotes/origin/${sourceRef}^{commit}`])
  }
  const mainSha = git(['rev-parse', 'refs/remotes/origin/main'])
  if (publish && channel === 'stable' && sourceSha !== mainSha) {
    throw new Error('Stable releases must use current origin/main')
  }
  if (channel === 'beta' && sourceSha === mainSha) {
    throw new Error('Beta releases must not use current origin/main')
  }
  const remoteBranches = git(['branch', '-r', '--contains', sourceSha])
  if (!remoteBranches.split('\n').some((line) => line.trim().startsWith('origin/'))) {
    throw new Error(`Source is not reachable from an origin branch: ${sourceSha}`)
  }
  return sourceSha
}

function listedHorcaTags(channel) {
  const pattern = channel === 'stable' ? stableTag : betaTag
  return git(['tag', '--list', channel === 'stable' ? 'v*-horca.*' : 'v*-horca-beta.*'])
    .split('\n')
    .filter((tag) => pattern.test(tag))
}

function findVersion(channel, sourceSha, core, tags) {
  const pattern = channel === 'stable' ? stableTag : betaTag
  const existing = tags.find((tag) => git(['rev-list', '-n', '1', tag]) === sourceSha)
  if (existing) {
    return existing
  }
  const numbers = tags.flatMap((tag) => {
    const match = tag.match(pattern)
    return match && `${match[1]}.${match[2]}.${match[3]}` === core ? [Number(match[4])] : []
  })
  return `v${core}-${channel === 'stable' ? 'horca' : 'horca-beta'}.${Math.max(0, ...numbers) + 1}`
}

async function github(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (process.env.GH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GH_TOKEN}`
  }
  const response = await fetch(`https://api.github.com${path}`, {
    headers
  })
  if (response.status === 404) {
    return undefined
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${path}`)
  }
  return response.json()
}

async function metadata() {
  const channel = process.env.CHANNEL
  if (!['stable', 'beta'].includes(channel)) {
    throw new Error(`Invalid channel: ${channel}`)
  }
  const publish = publishRequested()
  const sourceSha = resolveSource(process.env.SOURCE_REF, channel, publish)
  const head = git(['rev-parse', 'HEAD'])
  if (head !== sourceSha) {
    throw new Error(`Checkout HEAD ${head} is not source ${sourceSha}`)
  }
  const sourceVersion = packageVersion(sourceSha)
  const orcaStableVersion = await latestOrcaStableVersion()
  const tags = listedHorcaTags(channel)
  const core = selectReleaseCore(sourceVersion, orcaStableVersion, highestReleasedHorcaCore(tags))
  if (!core) {
    throw new Error(`Cannot derive release core from ${sourceVersion}`)
  }
  const lock = JSON.parse(git(['show', `${sourceSha}:upstream.lock.json`]))
  const upstreamSha = pinnedUpstreamShaFromLock(lock)
  const identity = computeBuildIdentityRecord(repoRoot)
  if (identity.upstreamSha !== upstreamSha) {
    throw new Error(
      `BuildIdentity upstream ${identity.upstreamSha} does not match lock ${upstreamSha}`
    )
  }
  const tag = findVersion(channel, sourceSha, core, tags)
  const release = await github(`/repos/${process.env.GITHUB_REPOSITORY}/releases/tags/${tag}`)
  if (release && release.target_commitish !== sourceSha) {
    const taggedSha = git(['rev-list', '-n', '1', tag])
    if (taggedSha !== sourceSha) {
      throw new Error(`${tag} points to ${taggedSha}, not ${sourceSha}`)
    }
  }
  const alreadyPublished = Boolean(publish && release && !release.draft)
  output('channel', channel)
  output('prerelease', String(channel === 'beta'))
  output('publish', String(publish))
  output('tag', tag)
  output('version', tag.slice(1))
  output('source_sha', sourceSha)
  output('upstream_sha', upstreamSha)
  output('upstream_version', orcaStableVersion ?? 'unknown')
  output('build_identity', identity.buildIdentity)
  output('published', String(alreadyPublished))
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function manifest(directory) {
  const channel = process.env.CHANNEL
  const buildIdentity = process.env.BUILD_IDENTITY
  if (!buildIdentity) {
    throw new Error('BUILD_IDENTITY is required for the release manifest')
  }
  if (!/^[a-f0-9]{40}$/.test(process.env.UPSTREAM_SHA ?? '')) {
    throw new Error(`Invalid UPSTREAM_SHA: ${process.env.UPSTREAM_SHA}`)
  }
  const names = ['horca-macos-arm64.dmg', 'horca-macos-x64.dmg']
  const artifacts = names.map((name) => {
    const path = join(directory, name)
    return {
      name,
      platform: 'macos',
      arch: name.includes('arm64') ? 'arm64' : 'x64',
      size: statSync(path).size,
      sha256: sha256(path),
      signed: true,
      notarized: true
    }
  })
  const release = {
    schemaVersion: 1,
    channel,
    tag: process.env.TAG,
    version: process.env.VERSION,
    sourceSha: process.env.SOURCE_SHA,
    upstreamSha: process.env.UPSTREAM_SHA,
    upstreamVersion: process.env.UPSTREAM_VERSION,
    buildIdentity,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    artifacts
  }
  writeFileSync(join(directory, 'horca-release.json'), `${JSON.stringify(release, null, 2)}\n`)
  writeFileSync(
    join(directory, 'SHA256SUMS'),
    `${artifacts.map((item) => `${item.sha256}  ${item.name}`).join('\n')}\n`
  )
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'metadata') {
    await metadata()
  } else if (command === 'manifest') {
    manifest(...args)
  } else if (command === 'tap-has') {
    const requested = args[0]
    if (!requested) {
      throw new Error('tap-has requires the requested version')
    }
    const tapVersion = caskVersionFromRuby(readFileSync(0, 'utf8'))
    if (!tapVersion || !tapHasReachedRequestedVersion(tapVersion, requested)) {
      process.exit(1)
    }
  } else {
    throw new Error(`Unknown command: ${command}`)
  }
}
