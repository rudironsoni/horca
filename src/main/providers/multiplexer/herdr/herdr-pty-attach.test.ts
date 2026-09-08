import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import type { HerdrHostTransport, HerdrTerminalController } from './herdr-runtime-contract'
import type { HerdrPtyBinding } from './herdr-pty-types'
import {
  applyHerdrPaneSize,
  openSharedHerdrPaneController,
  readExclusiveHerdrPaneBytes,
  writeSharedHerdrInput
} from './herdr-pty-attach'
import { handlerTransport } from './herdr-sdk-test-host'

describe('openSharedHerdrPaneController', () => {
  it('observes so a Herdr TUI can keep exclusive control', () => {
    const observer = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: vi.fn(() => () => undefined),
      onClosed: vi.fn(() => () => undefined)
    } as unknown as HerdrTerminalController
    const transport = {
      controlTerminal: vi.fn(() => observer)
    } as unknown as HerdrHostTransport
    const controller = openSharedHerdrPaneController(transport, 'orca', 'w1:p1', {
      cols: 80,
      rows: 24
    })
    expect(controller).toBe(observer)
    expect(transport.controlTerminal).toHaveBeenCalledWith('orca', 'w1:p1', {
      cols: 80,
      rows: 24,
      observe: true
    })
  })
})

describe('applyHerdrPaneSize', () => {
  it('pulses exclusive control so observe can still share with a Herdr TUI', async () => {
    const exclusive = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: (listener: (frame: { type: 'terminal.frame' }) => void) => {
        queueMicrotask(() => listener({ type: 'terminal.frame' }))
        return () => undefined
      },
      onClosed: vi.fn(() => () => undefined)
    } as unknown as HerdrTerminalController
    const transport = {
      controlTerminal: vi.fn(() => exclusive)
    } as unknown as HerdrHostTransport
    const binding = {
      detached: false,
      cols: 160,
      rows: 48,
      sessionName: 'orca',
      paneId: 'w1:p1',
      transport
    } as unknown as HerdrPtyBinding
    applyHerdrPaneSize(binding)
    applyHerdrPaneSize(binding)
    binding.cols = 80
    binding.rows = 24
    expect(transport.controlTerminal).toHaveBeenCalledTimes(1)
    expect(transport.controlTerminal).toHaveBeenCalledWith('orca', 'w1:p1', {
      cols: 160,
      rows: 48
    })
    await Promise.resolve()
    expect(exclusive.resize).toHaveBeenCalledWith(160, 48)
    expect(exclusive.release).toHaveBeenCalled()
  })
})

describe('writeSharedHerdrInput', () => {
  it('types through pane.send_text so observe does not steal exclusive control', async () => {
    const { transport, requestMock } = handlerTransport({
      'pane.send_text': () => undefined
    })
    const binding = {
      sessionName: 'orca',
      paneId: 'w1:p1',
      transport
    } as unknown as HerdrPtyBinding
    await writeSharedHerdrInput(binding, 'hello')
    expect(requestMock).toHaveBeenCalledWith('orca', 'pane.send_text', {
      paneId: 'w1:p1',
      text: 'hello'
    })
  })
})

describe('readExclusiveHerdrPaneBytes', () => {
  it('reads unread PTY bytes from a short exclusive attach', async () => {
    const unread = 'x'.repeat(64)
    const exclusive = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: (listener: (frame: { bytes: string }) => void) => {
        queueMicrotask(() => listener({ bytes: Buffer.from(unread, 'utf8').toString('base64') }))
        return () => undefined
      },
      onClosed: vi.fn(() => () => undefined)
    } as unknown as HerdrTerminalController
    const transport = {
      controlTerminal: vi.fn(() => exclusive)
    } as unknown as HerdrHostTransport
    const binding = {
      detached: false,
      cols: 80,
      rows: 24,
      sessionName: 'orca',
      paneId: 'w1:p2',
      transport
    } as unknown as HerdrPtyBinding
    const bytes = await readExclusiveHerdrPaneBytes(binding, 512 * 1024)
    expect(bytes).toBe(unread)
    expect(transport.controlTerminal).toHaveBeenCalledWith('orca', 'w1:p2', {
      cols: 80,
      rows: 24
    })
    expect(exclusive.release).toHaveBeenCalled()
  })
})
