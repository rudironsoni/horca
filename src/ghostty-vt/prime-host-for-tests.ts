import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GhosttyVtHost } from './wasm-host'
import { setGhosttyVtHost, tryGetGhosttyVtHost } from './host-singleton'

export function primeGhosttyVtHostForTests(): void {
  if (tryGetGhosttyVtHost()) return
  const dir = dirname(fileURLToPath(import.meta.url))
  setGhosttyVtHost(
    new GhosttyVtHost(
      readFileSync(join(dir, 'ghostty-vt.wasm')),
      readFileSync(join(dir, 'write-pty-trampoline.wasm'))
    )
  )
}
