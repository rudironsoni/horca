import type { PaneTerminal } from './pane-terminal'

export function registerMockXtermPaneState<T extends { terminal?: PaneTerminal }>(pane: T): T {
  const terminal = pane.terminal as (PaneTerminal & Record<string, unknown>) | undefined
  if (!terminal) return pane
  const extra = pane as T & {
    fitAddon?: { fit?: PaneTerminal['fit']; proposeDimensions?: PaneTerminal['proposeDimensions'] }
    serializeAddon?: { serialize?: PaneTerminal['serialize'] }
  }
  if (extra.fitAddon?.fit) terminal.fit = extra.fitAddon.fit
  if (extra.fitAddon?.proposeDimensions) terminal.proposeDimensions = extra.fitAddon.proposeDimensions
  if (extra.serializeAddon?.serialize) terminal.serialize = extra.serializeAddon.serialize
  if (typeof terminal.onRender !== 'function') {
    terminal.onRender = () => ({ dispose: () => undefined })
  }
  return pane
}

export function createFakePaneTerminal(overrides: Partial<PaneTerminal> = {}): PaneTerminal {
  const noopDisp = { dispose: () => undefined }
  const terminal: PaneTerminal = {
    cols: 80,
    rows: 24,
    element: undefined,
    options: {},
    buffer: {
      active: {
        cursorX: 0,
        cursorY: 0,
        baseY: 0,
        viewportY: 0,
        type: 'normal',
        getLine: () => undefined
      }
    },
    modes: {},
    parser: {
      registerOscHandler: () => noopDisp,
      registerCsiHandler: () => noopDisp
    },
    write: () => undefined,
    input: () => undefined,
    paste: () => undefined,
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
