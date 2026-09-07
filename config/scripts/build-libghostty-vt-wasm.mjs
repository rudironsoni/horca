#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dirname, '../..')
const outDir = join(repoRoot, 'src/ghostty-vt')
const revision = readFileSync(join(outDir, 'GHOSTTY_VT_PIN.txt'), 'utf8')
  .split('\n')
  .find((line) => line.startsWith('revision='))
  ?.slice('revision='.length)
if (!revision) {
  throw new Error('src/ghostty-vt/REVISION is missing revision=')
}

const sourceDir = process.env.GHOSTTY_SRC
if (!sourceDir) {
  throw new Error('Set GHOSTTY_SRC to a ghostty-org/ghostty checkout at the pinned revision')
}
const built = spawnSync(
  'zig',
  [
    'build',
    '--build-file',
    join(sourceDir, 'build.zig'),
    '--cache-dir',
    join(sourceDir, '.zig-cache'),
    '--prefix',
    join(sourceDir, 'zig-out'),
    '-Demit-lib-vt',
    '-Dtarget=wasm32-freestanding',
    '-Doptimize=ReleaseSmall'
  ],
  { stdio: 'inherit' }
)
if (built.status !== 0) {
  process.exit(built.status ?? 1)
}
mkdirSync(outDir, { recursive: true })
copyFileSync(join(sourceDir, 'zig-out/bin/ghostty-vt.wasm'), join(outDir, 'ghostty-vt.wasm'))
const tramp = spawnSync(
  'zig',
  [
    'build-exe',
    join(outDir, 'write-pty-trampoline.zig'),
    '-target',
    'wasm32-freestanding',
    '-fno-entry',
    '--export=trampoline',
    `-femit-bin=${join(outDir, 'write-pty-trampoline.wasm')}`,
    '-OReleaseSmall'
  ],
  { stdio: 'inherit' }
)
if (tramp.status !== 0) {
  process.exit(tramp.status ?? 1)
}
writeFileSync(join(outDir, '.built-revision'), `${revision}\n`)
