import { describe, expect, it } from 'vitest'
import { safeFind } from './terminal-search-safe-find'

describe('safeFind', () => {
  it('returns false for the terminal decoration positive-integer crash', () => {
    expect(
      safeFind(() => {
        throw new Error('This API only accepts positive integers')
      }, 'needle')
    ).toBe(false)
  })

  it('returns false for GhosttyTerminal is not bound and does not throw', () => {
    expect(() =>
      safeFind(() => {
        throw new Error('GhosttyTerminal is not bound')
      }, 'needle')
    ).not.toThrow()
    expect(
      safeFind(() => {
        throw new Error('GhosttyTerminal is not bound')
      }, 'needle')
    ).toBe(false)
  })

  it('rethrows unrelated search errors', () => {
    expect(() =>
      safeFind(() => {
        throw new Error('search WASM exploded')
      }, 'needle')
    ).toThrow('search WASM exploded')
  })

  it('returns the search hit when find succeeds', () => {
    expect(safeFind(() => true, 'needle')).toBe(true)
  })
})
