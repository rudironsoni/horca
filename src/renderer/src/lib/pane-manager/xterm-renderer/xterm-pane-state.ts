import type { FitAddon } from '@xterm/addon-fit'
import type { LigaturesAddon } from '@xterm/addon-ligatures'
import type { SearchAddon } from '@xterm/addon-search'
import type { SerializeAddon } from '@xterm/addon-serialize'
import type { Unicode11Addon } from '@xterm/addon-unicode11'
import type { WebLinksAddon } from '@xterm/addon-web-links'
import type { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal } from '@xterm/xterm'
import type { PaneTerminal } from '../pane-terminal'

export type XtermPaneState = {
  term: Terminal
  fitAddon: FitAddon
  searchAddon: SearchAddon
  serializeAddon: SerializeAddon
  unicode11Addon: Unicode11Addon
  webLinksAddon: WebLinksAddon
  webglAddon: WebglAddon | null
  ligaturesAddon: LigaturesAddon | null
}

const STATES_KEY = '__horcaXtermPaneStates'

function paneStates(): WeakMap<PaneTerminal, XtermPaneState> {
  const g = globalThis as typeof globalThis & {
    [STATES_KEY]?: WeakMap<PaneTerminal, XtermPaneState>
  }
  // ponytail: vitest can evaluate this module twice; share the WeakMap.
  g[STATES_KEY] ??= new WeakMap<PaneTerminal, XtermPaneState>()
  return g[STATES_KEY]
}

export function registerXtermPaneState(terminal: PaneTerminal, state: XtermPaneState): void {
  paneStates().set(terminal, state)
}

export function unregisterXtermPaneState(terminal: PaneTerminal): void {
  paneStates().delete(terminal)
}

export function requireXtermPaneState(terminal: PaneTerminal): XtermPaneState {
  const state = paneStates().get(terminal)
  if (!state) {
    throw new Error('xterm pane state is not registered for this terminal')
  }
  return state
}
