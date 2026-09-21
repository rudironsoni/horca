import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { SubprocessHandle } from '../daemon/session-subprocess-handle'
import {
  createHorcaGhosttyPassthruEngine,
  HORCA_GHOSTTY_ENGINE_PLACEMENT
} from './ghostty-passthru-engine'

const instances: FakeGhostty[] = []

class FakeGhostty extends EventEmitter {
  static lastOpts: { engine: string; passthru: boolean } | undefined
  attach = vi.fn()
  ptyData = vi.fn()
  destroy = vi.fn()
  constructor(opts: { engine: string; passthru: boolean }) {
    super()
    FakeGhostty.lastOpts = opts
    instances.push(this)
  }
}

function fakeHandle() {
  let onData: ((d: string) => void) | null = null
  const handle = {
    pid: 1,
    getForegroundProcess: () => 'zsh',
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    terminateOwnedTree: () => ({ kind: 'unavailable' as const }),
    signal: vi.fn(),
    onData: (cb: (d: string) => void) => {
      onData = cb
    },
    onExit: vi.fn(),
    dispose: vi.fn(),
    emitData: (d: string) => onData?.(d)
  }
  return handle as typeof handle & SubprocessHandle
}

describe('createHorcaGhosttyPassthruEngine', () => {
  it('places Ghostty on MAIN passthru and writes pty_write_cb as Buffer', () => {
    instances.length = 0
    const handle = fakeHandle()
    const engine = createHorcaGhosttyPassthruEngine(
      handle,
      FakeGhostty as unknown as Parameters<typeof createHorcaGhosttyPassthruEngine>[1]
    )
    expect(engine.placement).toBe(HORCA_GHOSTTY_ENGINE_PLACEMENT)
    expect(FakeGhostty.lastOpts).toEqual({ engine: 'main', passthru: true })
    const term = instances[0]
    expect(term).toBeDefined()
    handle.emitData('abc')
    expect(term.ptyData).toHaveBeenCalledWith(Buffer.from('abc', 'latin1'))
    const ghosttyBytes = Buffer.from([0xc3, 0xa9])
    term.emit('pty-write', ghosttyBytes)
    expect(handle.write).toHaveBeenCalledWith(ghosttyBytes)
    expect(Buffer.isBuffer(handle.write.mock.calls[0][0])).toBe(true)
    term.emit('pty-resize', { cols: 100, rows: 30 })
    expect(handle.resize).toHaveBeenCalledWith(100, 30)
  })
})
