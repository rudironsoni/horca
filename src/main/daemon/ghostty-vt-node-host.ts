import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getGhosttyVtHostOrThrow,
  setGhosttyVtHost,
  tryGetGhosttyVtHost
} from '../../ghostty-vt/host-singleton'
import { GhosttyVtHost } from '../../ghostty-vt/wasm-host'

const WASM_NAME = 'ghostty-vt.wasm'
const TRAMPOLINE_NAME = 'write-pty-trampoline.wasm'

function resolveGhosttyVtWasmDir(): string {
  const here = import.meta.dirname
  const candidates = [
    join(here, '../../ghostty-vt'),
    here,
    join(here, '..'),
    join(here, '../ghostty-vt')
  ]
  for (const dir of candidates) {
    if (existsSync(join(dir, WASM_NAME)) && existsSync(join(dir, TRAMPOLINE_NAME))) {
      return dir
    }
  }
  throw new Error(`libghostty-vt WASM not found next to ${here}`)
}

export function getGhosttyVtHost(): GhosttyVtHost {
  const existing = tryGetGhosttyVtHost()
  if (existing) {
    return existing
  }
  const dir = resolveGhosttyVtWasmDir()
  const host = new GhosttyVtHost(
    readFileSync(join(dir, WASM_NAME)),
    readFileSync(join(dir, TRAMPOLINE_NAME))
  )
  setGhosttyVtHost(host)
  return getGhosttyVtHostOrThrow()
}
