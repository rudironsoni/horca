import { describe, expect, it, vi } from 'vitest'
import type { IPtyProvider } from '../../types'
import { HerdrPtyProviderIo } from './herdr-pty-provider-io.ts'

class TestHerdrPtyProviderIo extends HerdrPtyProviderIo {
  constructor(fallback: IPtyProvider) {
    super()
    this.fallback = fallback
  }
}

function createFallbackProvider(): IPtyProvider {
  return {
    spawn: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    getCwd: vi.fn().mockResolvedValue('/fallback-cwd'),
    getForegroundProcess: vi.fn().mockResolvedValue('zsh'),
    confirmForegroundProcess: vi.fn().mockResolvedValue('zsh'),
    hasChildProcesses: vi.fn().mockResolvedValue(true),
    setPtyBackgrounded: vi.fn(),
    getBufferSnapshot: vi.fn().mockResolvedValue({ data: 'fallback-buffer', lastActivityAt: 99 }),
    canProvideAuthoritativeBufferSnapshot: vi.fn().mockReturnValue(true),
    clearBuffer: vi.fn()
  } as unknown as IPtyProvider
}

describe('HerdrPtyProviderIo fallback inspection', () => {
  it('forwards inspection and backgrounding to the fallback for non-Herdr PTY ids', async () => {
    const fallback = createFallbackProvider()
    const provider = new TestHerdrPtyProviderIo(fallback)

    await expect(provider.getForegroundProcess('orca-pty-1')).resolves.toBe('zsh')
    expect(fallback.getForegroundProcess).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.hasChildProcesses('orca-pty-1')).resolves.toBe(true)
    expect(fallback.hasChildProcesses).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.getCwd('orca-pty-1')).resolves.toBe('/fallback-cwd')
    expect(fallback.getCwd).toHaveBeenCalledWith('orca-pty-1')

    await expect(provider.getBufferSnapshot('orca-pty-1')).resolves.toEqual({
      data: 'fallback-buffer',
      lastActivityAt: 99
    })
    expect(fallback.getBufferSnapshot).toHaveBeenCalledWith('orca-pty-1', undefined)
    expect(provider.canProvideAuthoritativeBufferSnapshot('orca-pty-1')).toBe(true)

    provider.setPtyBackgrounded('orca-pty-1', true)
    expect(fallback.setPtyBackgrounded).toHaveBeenCalledWith('orca-pty-1', true)

    await expect(provider.confirmForegroundProcess('orca-pty-1')).resolves.toBe('zsh')
    expect(fallback.confirmForegroundProcess).toHaveBeenCalledWith('orca-pty-1')

    await provider.clearBuffer('orca-pty-1')
    expect(fallback.clearBuffer).toHaveBeenCalledWith('orca-pty-1')
  })

  it('does not inspect the fallback for Herdr-owned ids', async () => {
    const fallback = createFallbackProvider()
    const provider = new TestHerdrPtyProviderIo(fallback)

    await expect(provider.getForegroundProcess('herdr:session-1')).resolves.toBeNull()
    expect(fallback.getForegroundProcess).not.toHaveBeenCalled()

    provider.setPtyBackgrounded('herdr:session-1', true)
    expect(fallback.setPtyBackgrounded).not.toHaveBeenCalled()
  })
})
