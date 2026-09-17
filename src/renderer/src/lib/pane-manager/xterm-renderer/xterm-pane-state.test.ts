import { describe, expect, it } from 'vitest'
import type { PaneTerminal } from '../pane-terminal'
import {
  registerXtermPaneState,
  requireXtermPaneState,
  unregisterXtermPaneState,
  type XtermPaneState
} from './xterm-pane-state'

function fakeTerminal(): PaneTerminal {
  return { cols: 80, rows: 24 } as PaneTerminal
}

function fakeState(): XtermPaneState {
  return { term: {} } as XtermPaneState
}

describe('XtermPaneState lifecycle', () => {
  it('registers once and require returns the same object', () => {
    const terminal = fakeTerminal()
    const state = fakeState()
    registerXtermPaneState(terminal, state)
    expect(requireXtermPaneState(terminal)).toBe(state)
    unregisterXtermPaneState(terminal)
  })

  it('fails after dispose/unregister', () => {
    const terminal = fakeTerminal()
    registerXtermPaneState(terminal, fakeState())
    unregisterXtermPaneState(terminal)
    expect(() => requireXtermPaneState(terminal)).toThrow(/not registered/)
  })

  it('keeps pane A and pane B independent', () => {
    const a = fakeTerminal()
    const b = fakeTerminal()
    const stateA = fakeState()
    const stateB = fakeState()
    registerXtermPaneState(a, stateA)
    registerXtermPaneState(b, stateB)
    expect(requireXtermPaneState(a)).toBe(stateA)
    expect(requireXtermPaneState(b)).toBe(stateB)
    expect(stateA).not.toBe(stateB)
    unregisterXtermPaneState(a)
    expect(() => requireXtermPaneState(a)).toThrow(/not registered/)
    expect(requireXtermPaneState(b)).toBe(stateB)
    unregisterXtermPaneState(b)
  })

  it('does not recover stale state after recreate', () => {
    const first = fakeTerminal()
    const stale = fakeState()
    registerXtermPaneState(first, stale)
    unregisterXtermPaneState(first)
    const second = fakeTerminal()
    const fresh = fakeState()
    registerXtermPaneState(second, fresh)
    expect(requireXtermPaneState(second)).toBe(fresh)
    expect(requireXtermPaneState(second)).not.toBe(stale)
    unregisterXtermPaneState(second)
  })
})
