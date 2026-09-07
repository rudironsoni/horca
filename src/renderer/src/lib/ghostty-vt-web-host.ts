import { setGhosttyVtHost, tryGetGhosttyVtHost } from '../../../ghostty-vt/host-singleton'
import { GhosttyVtHost } from '../../../ghostty-vt/wasm-host'
import vtWasmUrl from '../../../ghostty-vt/ghostty-vt.wasm?url'
import trampolineWasmUrl from '../../../ghostty-vt/write-pty-trampoline.wasm?url'

let hostPromise: Promise<GhosttyVtHost> | null = null

export function primeGhosttyVtHost(): Promise<GhosttyVtHost> {
  const existing = tryGetGhosttyVtHost()
  if (existing) {
    return Promise.resolve(existing)
  }
  if (!hostPromise) {
    hostPromise = Promise.all([
      fetch(vtWasmUrl).then((response) => response.arrayBuffer()),
      fetch(trampolineWasmUrl).then((response) => response.arrayBuffer())
    ]).then(([vt, trampoline]) => {
      const host = new GhosttyVtHost(vt, trampoline)
      setGhosttyVtHost(host)
      return host
    })
  }
  return hostPromise
}
