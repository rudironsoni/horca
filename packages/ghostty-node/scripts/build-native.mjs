#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = dirname(import.meta.dirname)
const vendorLib = join(root, 'vendor', 'lib', 'libghostty-vt.a')

if (!existsSync(vendorLib)) {
  console.error(
    '[ghostty-node] vendor/lib/libghostty-vt.a missing; run: pnpm -w --filter @horca/ghostty-node build:libghostty'
  )
  process.exit(1)
}

execFileSync('node-gyp', ['rebuild'], { cwd: root, stdio: 'inherit', shell: false })
console.log('[ghostty-node] native addon built')
