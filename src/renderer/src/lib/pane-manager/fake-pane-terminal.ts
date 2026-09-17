import type { PaneTerminal } from './pane-terminal'
import { registerXtermPaneState } from './xterm-renderer/xterm-pane-state'

export function registerMockXtermPaneState<T extends { terminal?: PaneTerminal }>(pane: T): T {
  if (!pane.terminal || typeof pane.terminal !== 'object') return pane
  const extra = pane as T & {
    fitAddon?: unknown
    searchAddon?: unknown
    serializeAddon?: unknown
    unicode11Addon?: unknown
    webLinksAddon?: unknown
    webglAddon?: unknown
    ligaturesAddon?: unknown
  }
  registerXtermPaneState(pane.terminal, {
    term: pane.terminal as never,
    fitAddon: (extra.fitAddon ?? { fit() {}, proposeDimensions() {} }) as never,
    searchAddon: (extra.searchAddon ?? {
      findNext() { return false },
      findPrevious() { return false },
      clearDecorations() {},
      dispose() {}
    }) as never,
    serializeAddon: (extra.serializeAddon ?? { serialize() { return '' }, dispose() {} }) as never,
    unicode11Addon: (extra.unicode11Addon ?? { dispose() {} }) as never,
    webLinksAddon: (extra.webLinksAddon ?? { dispose() {} }) as never,
    webglAddon: (extra.webglAddon ?? null) as never,
    ligaturesAddon: (extra.ligaturesAddon ?? null) as never
  })
  return pane
}

export function createFakePaneTerminal(overrides: Partial<PaneTerminal> = {}): PaneTerminal {
  const noopDisp = { dispose: () => undefined }
  const terminal: PaneTerminal = {
    cols: 80,
    rows: 24,
    element: undefined,
    options: {},
    buffer: { active: { cursorX: 0, cursorY: 0, baseY: 0, viewportY: 0, getLine: () => undefined } },
    modes: {},
    parser: {
      registerOscHandler: () => noopDisp,
      registerCsiHandler: () => noopDisp
    },
    write: () => undefined,
    input: () => undefined,
    focus: () => undefined,
    blur: () => undefined,
    dispose: () => undefined,
    resize: () => undefined,
    refresh: () => undefined,
    fit: () => undefined,
    proposeDimensions: () => ({ cols: 80, rows: 24 }),
    serialize: () => '',
    findNext: () => false,
    findPrevious: () => false,
    clearSearch: () => undefined,
    hasSelection: () => false,
    getSelection: () => '',
    clearSelection: () => undefined,
    selectAll: () => undefined,
    scrollToBottom: () => undefined,
    scrollToLine: () => undefined,
    registerLinkProvider: () => noopDisp,
    onResize: () => noopDisp,
    onSelectionChange: () => noopDisp,
    onData: () => noopDisp,
    onTitleChange: () => noopDisp,
    onRender: () => noopDisp,
    attachCustomKeyEventHandler: () => undefined,
    ...overrides
  }
  return terminal
}
