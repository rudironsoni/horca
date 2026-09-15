import { describe, expect, it } from 'vitest'
import type { GhosttyTerminal } from './ghostty-terminal'
import {
  clearSelection,
  findNext,
  findPrevious,
  readGridLine,
  readScrollbar,
  scrollViewport
} from './ghostty-terminal-ops'

function disposedUnboundEngine(): GhosttyTerminal {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ops only read isDisposed and must not call ghosttyVt; this stub has no WeakMap bind.
  return { isDisposed: true } as GhosttyTerminal
}

describe('ghostty-terminal-ops disposed engine', () => {
  it('does not throw findNext on a disposed unbound engine', () => {
    const engine = disposedUnboundEngine()
    expect(() => findNext(engine, 'needle')).not.toThrow()
    expect(findNext(engine, 'needle')).toBe(false)
  })

  it('does not throw findPrevious on a disposed unbound engine', () => {
    const engine = disposedUnboundEngine()
    expect(() => findPrevious(engine, 'needle')).not.toThrow()
    expect(findPrevious(engine, 'needle')).toBe(false)
  })

  it('does not throw scrollViewport on a disposed unbound engine', () => {
    const engine = disposedUnboundEngine()
    expect(() => scrollViewport(engine, 'DELTA', 1)).not.toThrow()
  })

  it('no-ops selection, scrollbar, and grid reads on a disposed unbound engine', () => {
    const engine = disposedUnboundEngine()
    expect(() => clearSelection(engine)).not.toThrow()
    expect(readScrollbar(engine)).toEqual({ total: 0, offset: 0, len: 0 })
    expect(readGridLine(engine, 0)).toBeUndefined()
  })
})
