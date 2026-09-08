#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { deletedPathsFromPatch } from './ghostty-port-patch.mjs'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const outputRoot = join(repoRoot, 'out', 'horca-mobile')
const mobileOutput = join(outputRoot, 'mobile')
const ghosttyPortPatch = join(import.meta.dirname, 'ghostty-port.patch')
const downstreamPatches = [ghosttyPortPatch]
const downstreamFiles = [
  {
    source: join(import.meta.dirname, 'ios-scene-lifecycle.js'),
    destination: join(mobileOutput, 'plugins', 'ios-scene-lifecycle.js')
  },
  {
    source: join(import.meta.dirname, 'pnpm-lock.yaml'),
    destination: join(mobileOutput, 'pnpm-lock.yaml')
  }
]

function trackedFiles(prefix) {
  return execFileSync('git', ['ls-files', '-z', prefix], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  })
    .split('\0')
    .filter(Boolean)
}

function copyTracked(prefix) {
  for (const path of trackedFiles(prefix)) {
    const source = join(repoRoot, path)
    if (!existsSync(source)) {
      continue
    }
    const destination = join(outputRoot, path)
    mkdirSync(dirname(destination), { recursive: true })
    cpSync(source, destination)
  }
}

if (dirname(outputRoot) !== join(repoRoot, 'out') || !outputRoot.endsWith(`${sep}horca-mobile`)) {
  throw new Error(`Refusing to replace unexpected output path: ${outputRoot}`)
}
rmSync(outputRoot, { recursive: true, force: true })
copyTracked('mobile')
copyTracked('src/shared')
for (const file of downstreamFiles) {
  mkdirSync(dirname(file.destination), { recursive: true })
  cpSync(file.source, file.destination)
}
for (const patch of downstreamPatches) {
  const deletedPaths = deletedPathsFromPatch(readFileSync(patch, 'utf8'))
  // Full-file deletes and the lockfile cannot match drifting upstream content.
  for (const path of deletedPaths) {
    const destination = join(outputRoot, path)
    if (existsSync(destination)) {
      unlinkSync(destination)
    }
  }
  const applyDirectory = relative(repoRoot, outputRoot)
  execFileSync(
    'git',
    [
      'apply',
      '--binary',
      '--unidiff-zero',
      '-p1',
      `--directory=${applyDirectory}`,
      '--exclude=*pnpm-lock.yaml',
      ...deletedPaths.map((path) => `--exclude=${join(applyDirectory, path)}`),
      patch
    ],
    { cwd: repoRoot, stdio: 'inherit', maxBuffer: 64 * 1024 * 1024 }
  )
}

console.log(`Materialized Horca mobile at ${relative(repoRoot, mobileOutput)}`)
