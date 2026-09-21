import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SubprocessHandle } from '../daemon/session-subprocess-handle'
import {
  clearHorcaPtyHandleRegistry,
  createHorcaPtyHandleAdapter,
  lookupHorcaPtyHandle,
  registerHorcaPtyHandle,
  setHorcaPtyProviderLookup
} from './horca-pty-handle-registry'

afterEach(() => {
  clearHorcaPtyHandleRegistry()
  setHorcaPtyProviderLookup(null)
})

function fakeHandle(): SubprocessHandle & { write: ReturnType<typeof vi.fn> } {
  return {
    pid: 9,
    getForegroundProcess: () => 'zsh',
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    terminateOwnedTree: () => 'unavailable' as const,
    signal: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    dispose: vi.fn()
  } as unknown as SubprocessHandle & { write: ReturnType<typeof vi.fn> }
}

describe('lookupHorcaPtyHandle', () => {
  it('returns a registered live SubprocessHandle', () => {
    const handle = fakeHandle()
    registerHorcaPtyHandle('sess-1', handle)
    expect(lookupHorcaPtyHandle('sess-1')).toBe(handle)
  })

  it('adapts a daemon IPtyProvider so Buffer writes stay bytes', () => {
    const writes: Array<string | Buffer> = []
    const exact: Buffer[] = []
    const dataCbs: Array<(payload: { id: string; data: string }) => void> = []
    setHorcaPtyProviderLookup(() => ({
      write: (id, data) => {
        writes.push(data)
        return id === 'sess-2'
      },
      writeExact: (id, data) => {
        if (id !== 'sess-2') {
          return false
        }
        exact.push(data)
        return true
      },
      resize: vi.fn(),
      onData: (cb) => {
        dataCbs.push(cb)
        return () => undefined
      }
    }))
    const handle = lookupHorcaPtyHandle('sess-2')
    expect(handle).not.toBeNull()
    const bytes = Buffer.from([0xc3, 0xa9])
    handle!.write(bytes)
    expect(exact).toEqual([bytes])
    expect(Buffer.isBuffer(exact[0])).toBe(true)
    expect(writes).toEqual([])
    handle!.write('ls\n')
    expect(writes).toEqual(['ls\n'])
    const seen: string[] = []
    handle!.onData((data) => seen.push(data))
    dataCbs[0]?.({ id: 'sess-2', data: 'out' })
    dataCbs[0]?.({ id: 'other', data: 'nope' })
    expect(seen).toEqual(['out'])
  })

  it('createHorcaPtyHandleAdapter rejects Buffer writes without writeExact', () => {
    const adapter = createHorcaPtyHandleAdapter('sess-3', {
      write: () => true,
      resize: () => undefined,
      onData: () => () => undefined
    })
    expect(() => adapter.write(Buffer.from([0xc3, 0xa9]))).toThrow(/writeExact/)
  })
})
