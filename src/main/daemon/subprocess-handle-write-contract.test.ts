import { describe, expect, it, vi } from 'vitest'
import type * as pty from 'node-pty'
import { createDaemonPtySubprocessHandle } from './pty-subprocess/subprocess-handle'
import { mockPtyProcess } from './pty-subprocess-test-harness'

vi.mock('./pty-subprocess/foreground-process-tracker', () => ({
  createPtyForegroundProcessTracker: () => ({
    recordOutput: vi.fn(),
    markDead: vi.fn(),
    getForegroundProcess: () => null
  })
}))

describe('SubprocessHandle write contract', () => {
  function createHandle(proc: ReturnType<typeof mockPtyProcess>) {
    return createDaemonPtySubprocessHandle({
      process: proc as unknown as pty.IPty,
      shellPath: 'bash',
      spawnCwd: process.cwd(),
      env: {},
      startupCommandDeliveredInShellArgs: false,
      reportsChildExitStatus: true,
      sessionId: 'write-contract',
      startupAgentRecognition: null
    })
  }

  it('forwards Buffer bytes to IPty.write without decoding', () => {
    const proc = mockPtyProcess(7)
    const handle = createHandle(proc)
    const payload = Buffer.from([0xc3, 0xa9])
    handle.write(payload)
    expect(proc.write).toHaveBeenCalledOnce()
    const received = proc.write.mock.calls[0][0] as unknown
    expect(Buffer.isBuffer(received)).toBe(true)
    expect(Buffer.from(received as Buffer).equals(payload)).toBe(true)
  })

  it('forwards string writes as strings', () => {
    const proc = mockPtyProcess(8)
    const handle = createHandle(proc)
    handle.write('echo hello')
    expect(proc.write).toHaveBeenCalledWith('echo hello')
  })

  it('does not deliver consumer onExit after dispose', () => {
    const proc = mockPtyProcess(9)
    const handle = createHandle(proc)
    const codes: number[] = []
    handle.onExit((code) => codes.push(code))
    handle.dispose()
    proc._simulateExit(0)
    expect(codes).toEqual([])
  })

  it('does not deliver consumer onData after dispose', () => {
    const proc = mockPtyProcess(10)
    const handle = createHandle(proc)
    const chunks: string[] = []
    handle.onData((data) => chunks.push(data))
    handle.dispose()
    proc._simulateData('after')
    expect(chunks).toEqual([])
  })
})
