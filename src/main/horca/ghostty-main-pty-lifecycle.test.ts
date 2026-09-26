import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearHorcaPtyHandleRegistry,
  lookupHorcaPtyHandle,
  setHorcaPtyProviderLookup
} from './horca-pty-handle-registry'

afterEach(() => {
  clearHorcaPtyHandleRegistry()
  setHorcaPtyProviderLookup(null)
})

describe('MAIN Ghostty PTY adapter lifecycle', () => {
  it('binds two remote session ids to Buffer writeExact without latin1 string hops', () => {
    const exact: Array<{ id: string; bytes: number[] }> = []
    const strings: Array<{ id: string; data: string }> = []
    setHorcaPtyProviderLookup(() => ({
      write: (id, data) => {
        strings.push({ id, data })
        return true
      },
      writeExact: (id, data) => {
        exact.push({ id, bytes: [...data] })
        return true
      },
      resize: vi.fn(),
      onData: () => () => undefined
    }))
    const a = lookupHorcaPtyHandle('remote-a')
    const b = lookupHorcaPtyHandle('remote-b')
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    expect(a).not.toBe(b)
    a!.write(Buffer.from([0xc3, 0xa9]))
    b!.write(Buffer.from([0x03]))
    a!.write('ls\n')
    expect(exact).toEqual([
      { id: 'remote-a', bytes: [0xc3, 0xa9] },
      { id: 'remote-b', bytes: [0x03] }
    ])
    expect(strings).toEqual([{ id: 'remote-a', data: 'ls\n' }])
  })
})
