import type { Terminal } from '@xterm/xterm'
import type { ManagedPaneInternal } from '../pane-manager-types'
import type { PaneTerminal } from '../pane-terminal'
import {
  registerXtermPaneState,
  requireXtermPaneState,
  type XtermPaneState
} from './xterm-pane-state'

export type XtermPaneTestHarness = {
  pane: ManagedPaneInternal
  state: XtermPaneState
  term: Terminal
}

const noopDispose = { dispose: () => undefined }

function defaultState(term: Terminal, partial?: Partial<XtermPaneState>): XtermPaneState {
  return {
    term,
    fitAddon: {
      fit() {},
      proposeDimensions() {
        return undefined
      },
      dispose() {}
    } as unknown as XtermPaneState['fitAddon'],
    searchAddon: {
      findNext() {
        return false
      },
      findPrevious() {
        return false
      },
      clearDecorations() {},
      dispose() {}
    } as unknown as XtermPaneState['searchAddon'],
    serializeAddon: {
      serialize() {
        return ''
      },
      dispose() {}
    } as unknown as XtermPaneState['serializeAddon'],
    unicode11Addon: noopDispose as unknown as XtermPaneState['unicode11Addon'],
    webLinksAddon: noopDispose as unknown as XtermPaneState['webLinksAddon'],
    webglAddon: null,
    ligaturesAddon: null,
    ...partial
  }
}

export function createXtermPaneTestHarness(input: {
  terminal?: PaneTerminal
  term?: Terminal
  state?: Partial<XtermPaneState>
  pane?: Partial<ManagedPaneInternal>
} = {}): XtermPaneTestHarness {
  const term = (input.term ?? (input.terminal as Terminal | undefined) ?? {
    options: {}
  }) as Terminal
  const terminal = (input.terminal ?? (term as unknown as PaneTerminal))
  const state = defaultState(term, input.state)
  registerXtermPaneState(terminal, state)
  const leafId = '11111111-1111-4111-8111-111111111111' as ManagedPaneInternal['leafId']
  const pane = {
    id: 1,
    leafId,
    stablePaneId: leafId,
    terminal,
    container: {} as HTMLElement,
    xtermContainer: {} as HTMLElement,
    linkTooltip: {} as HTMLElement,
    terminalGpuAcceleration: 'off',
    gpuRenderingEnabled: false,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    webglAttachFailedSinceRecovery: false,
    hasComplexScriptOutput: false,
    fitResizeObserver: null,
    pendingObservedFitRafId: null,
    compositionHandler: null,
    pendingSplitScrollState: null,
    debugLabel: null,
    ...input.pane
  } as ManagedPaneInternal
  pane.terminal = terminal
  return { pane, state: requireXtermPaneState(terminal), term }
}

export function attachXtermPaneTestState<T extends { terminal: PaneTerminal }>(
  pane: T,
  state?: Partial<XtermPaneState>
): T {
  if (!pane.terminal || typeof pane.terminal !== 'object') return pane
  const extra = pane as T & {
    fitAddon?: XtermPaneState['fitAddon']
    searchAddon?: XtermPaneState['searchAddon']
    serializeAddon?: XtermPaneState['serializeAddon']
    unicode11Addon?: XtermPaneState['unicode11Addon']
    webLinksAddon?: XtermPaneState['webLinksAddon']
    webglAddon?: XtermPaneState['webglAddon']
    ligaturesAddon?: XtermPaneState['ligaturesAddon']
  }
  const term = (state?.term ?? (pane.terminal as unknown as Terminal))
  registerXtermPaneState(
    pane.terminal,
    defaultState(term, {
      ...(extra.fitAddon ? { fitAddon: extra.fitAddon } : {}),
      ...(extra.searchAddon ? { searchAddon: extra.searchAddon } : {}),
      ...(extra.serializeAddon ? { serializeAddon: extra.serializeAddon } : {}),
      ...(extra.unicode11Addon ? { unicode11Addon: extra.unicode11Addon } : {}),
      ...(extra.webLinksAddon ? { webLinksAddon: extra.webLinksAddon } : {}),
      ...(extra.webglAddon !== undefined ? { webglAddon: extra.webglAddon } : {}),
      ...(extra.ligaturesAddon !== undefined ? { ligaturesAddon: extra.ligaturesAddon } : {}),
      ...state
    })
  )
  return pane
}
