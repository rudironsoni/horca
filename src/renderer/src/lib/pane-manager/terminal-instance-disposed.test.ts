import { describe, expect, it } from 'vitest'
import { isTerminalInstanceDisposed } from './terminal-instance-disposed'

describe('isTerminalInstanceDisposed', () => {
  it('reads the public isDisposed flag on Ghostty panes', () => {
    expect(isTerminalInstanceDisposed({ isDisposed: true })).toBe(true)
    expect(isTerminalInstanceDisposed({ isDisposed: false })).toBe(false)
  })

  it('falls back to the historical _core store flag', () => {
    expect(isTerminalInstanceDisposed({ _core: { _store: { _isDisposed: true } } })).toBe(true)
    expect(isTerminalInstanceDisposed({ _core: { _store: { _isDisposed: false } } })).toBe(false)
    expect(isTerminalInstanceDisposed(null)).toBe(false)
  })
})
