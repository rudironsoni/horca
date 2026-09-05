#!/usr/bin/env node
// Build the static libghostty-vt for the current host from the pinned Ghostty
// commit in vendor-manifest.json, using a pinned zig (0.15.x).
//
// CI builds these into per-target tarballs whose sha256 lands back in
// vendor-manifest.json (see download-libs.mjs). This script is the local
// / CI build path when no tarball is pinned yet.
import { execFileSync, execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFile } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const root = dirname(import.meta.dirname)
const manifest = JSON.parse(await readFile(resolve(root, 'vendor-manifest.json')))
const pinned = manifest['ghostty-vt']
const commit = pinned.commit

const srcDir = join(root, 'vendor-src')
const vendorDir = join(root, 'vendor')
const includeSrc = join(srcDir, 'zig-out', 'include')

function zig() {
  // Prefer brew's keg-only zig@0.15 (the pinned major), else `zig` on PATH.
  const brew = '/opt/homebrew/opt/zig@0.15/bin/zig'
  if (existsSync(brew)) {
    return brew
  }
  return execSync('which zig').toString().trim()
}

function ensureSource() {
  if (!existsSync(join(srcDir, '.git'))) {
    throw new Error(
      `vendor-src missing; run: git clone https://github.com/ghostty-org/ghostty.git vendor-src && git -C vendor-src checkout ${commit}`
    )
  }
}

function build() {
  execFileSync(zig(), ['build', '-Demit-lib-vt=true', '-Dsimd=false', '--release=fast'], {
    cwd: srcDir,
    stdio: 'inherit'
  })
}

async function stage() {
  mkdirSync(join(vendorDir, 'include'), { recursive: true })
  mkdirSync(join(vendorDir, 'lib'), { recursive: true })
  cpSync(includeSrc, join(vendorDir, 'include'), { recursive: true })
  for (const f of ['libghostty-vt.a']) {
    const p = join(srcDir, 'zig-out', 'lib', f)
    if (existsSync(p)) {
      cpSync(p, join(vendorDir, 'lib', f))
    }
  }
  const lib = join(vendorDir, 'lib', 'libghostty-vt.a')
  const sha = createHash('sha256')
    .update(await readFile(lib))
    .digest('hex')
  console.log(`staged ${lib} sha256=${sha}`)
}

ensureSource()
build()
await stage()
