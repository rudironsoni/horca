import type { GhosttyVtHost } from './wasm-host'

let host: GhosttyVtHost | null = null

export function setGhosttyVtHost(next: GhosttyVtHost): void {
  host = next
}

export function getGhosttyVtHostOrThrow(): GhosttyVtHost {
  if (!host) {
    throw new Error('libghostty-vt WASM host is not primed')
  }
  return host
}

export function tryGetGhosttyVtHost(): GhosttyVtHost | null {
  return host
}
