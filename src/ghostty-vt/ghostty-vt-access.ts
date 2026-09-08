import type { GhosttyTerminal } from './ghostty-terminal'
import type { GhosttyVtHost } from './wasm-host'

type Binding = { host: GhosttyVtHost; term: number }

const bindings = new WeakMap<GhosttyTerminal, Binding>()

export function bindGhosttyVt(engine: GhosttyTerminal, host: GhosttyVtHost, term: number): void {
  bindings.set(engine, { host, term })
}

export function rebindGhosttyVt(engine: GhosttyTerminal, term: number): void {
  const current = bindings.get(engine)
  if (!current) {
    throw new Error('GhosttyTerminal is not bound')
  }
  bindings.set(engine, { host: current.host, term })
}

export function unbindGhosttyVt(engine: GhosttyTerminal): void {
  bindings.delete(engine)
}

export function ghosttyVt(engine: GhosttyTerminal): Binding {
  const binding = bindings.get(engine)
  if (!binding) {
    throw new Error('GhosttyTerminal is not bound')
  }
  return binding
}
