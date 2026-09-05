#!/usr/bin/env node
// Fetch the pinned libghostty-vt static lib + headers tarball for the current
// platform/arch into vendor/. Idempotent (skips when stamp matches sha256).
//
// When the manifest has no pinned URL for this target yet, this is a no-op and
// the local `build-libghostty.mjs` path is expected instead.
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const root = dirname(import.meta.dirname)
const manifest = JSON.parse(await readFile(resolve(root, 'vendor-manifest.json'), 'utf8'))
const targets = manifest['ghostty-vt']?.targets ?? {}

const platform = process.platform
const arch = process.arch
const key = `${platform}-${arch}`
const entry = targets[key]

const vendorDir = join(root, 'vendor')
const stamp = join(vendorDir, '.checksum')

if (!entry || !entry.url) {
  console.log(`[ghostty-node] no pinned tarball for ${key}; use build-libghostty.mjs`)
  process.exit(0)
}

if (existsSync(vendorDir) && existsSync(stamp)) {
  if ((await readFile(stamp, 'utf8')).trim() === entry.sha256) {
    console.log(`[ghostty-node] libghostty-vt up to date (${key})`)
    process.exit(0)
  }
}

console.log(`[ghostty-node] downloading libghostty-vt (${key})`)
const response = await fetch(entry.url, { redirect: 'follow' })
if (!response.ok) {
  throw new Error(`download failed: HTTP ${response.status}`)
}
const tarball = Buffer.from(await response.arrayBuffer())

const actual = createHash('sha256').update(tarball).digest('hex')
if (actual !== entry.sha256) {
  throw new Error(`checksum mismatch: expected ${entry.sha256}, got ${actual}`)
}

await rm(vendorDir, { recursive: true, force: true })
await mkdir(vendorDir, { recursive: true })
const tarPath = join(root, 'libghostty-vt.tar.gz')
await writeFile(tarPath, tarball)
execFileSync('tar', ['-xzf', tarPath, '-C', vendorDir])
await rm(tarPath)
await writeFile(stamp, `${entry.sha256}\n`)
console.log('[ghostty-node] libghostty-vt ready')
