import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import { activeRendererPtys, visibleRendererPtys } from '../../../ipc/pty/delivery/visibility-state'
import {
  clearHiddenRendererPtyDeliveryState,
  markHiddenRendererPty
} from '../../../ipc/pty-hidden-delivery-gate'
import type { HerdrPtyBinding } from './herdr-pty-types'
import { handlerTransport } from './herdr-sdk-test-host'
import { startHerdrPaneScrollbackDrain } from './herdr-pty-scrollback-drain'
import type { HerdrTerminalController, HerdrTerminalFrame } from './herdr-runtime-contract'

function exclusiveBytes(text: string): HerdrTerminalController {
  return {
    write: vi.fn(),
    resize: vi.fn(),
    release: vi.fn(),
    onFrame: (listener: (frame: HerdrTerminalFrame) => void) => {
      queueMicrotask(() =>
        listener({
          type: 'terminal.frame',
          seq: 1,
          encoding: 'ansi',
          width: 80,
          height: 24,
          full: false,
          bytes: Buffer.from(text, 'utf8').toString('base64')
        })
      )
      return () => undefined
    },
    onClosed: vi.fn(() => () => undefined)
  } as unknown as HerdrTerminalController
}

describe('startHerdrPaneScrollbackDrain', () => {
  it('emits exclusive unread PTY bytes observe frames omit', async () => {
    const unread = 'x'.repeat(512 * 1024)
    const { transport } = handlerTransport({})
    transport.controlTerminal = vi.fn(() => exclusiveBytes(unread))
    const emitData = vi.fn()
    const binding = {
      id: 'herdr:test',
      snapshot: 'prompt$ ',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      paneId: 'w1:p1',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(binding, emitData)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
    await Promise.resolve()
    expect(emitData).toHaveBeenCalledWith({
      id: 'herdr:test',
      data: unread,
      sequenceChars: unread.length
    })
    vi.useRealTimers()
    visibleRendererPtys.clear()
    for (const stop of binding.unsubscribe) {
      stop()
    }
  })

  it('keeps exclusive drain for hidden PTYs after the unread budget', async () => {
    const unread = 'x'.repeat(512 * 1024)
    const { transport } = handlerTransport({})
    transport.controlTerminal = vi.fn(() => exclusiveBytes(unread))
    const emitData = vi.fn()
    const binding = {
      id: 'herdr:hidden',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      paneId: 'w1:p3',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    visibleRendererPtys.add(binding.id)
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(binding, emitData)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
    await Promise.resolve()
    expect(emitData).toHaveBeenCalledTimes(1)
    visibleRendererPtys.delete(binding.id)
    markHiddenRendererPty(binding.id)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
    await Promise.resolve()
    expect(vi.mocked(transport.controlTerminal).mock.calls.length).toBeGreaterThan(1)
    vi.useRealTimers()
    for (const stop of binding.unsubscribe) {
      stop()
    }
    visibleRendererPtys.clear()
    clearHiddenRendererPtyDeliveryState(binding.id)
  })

  it('does not exclusive-drain a Herdr pane that already has an active renderer', async () => {
    const unread = 'x'.repeat(512 * 1024)
    const { transport } = handlerTransport({})
    transport.controlTerminal = vi.fn(() => exclusiveBytes(unread))
    const emitData = vi.fn()
    const typing = {
      id: 'herdr:typing',
      paneId: 'w1:p1',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    const shared = {
      id: 'herdr:shared',
      paneId: 'w1:p1',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    visibleRendererPtys.add('herdr:typing')
    activeRendererPtys.add('herdr:typing')
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(typing, vi.fn())
    startHerdrPaneScrollbackDrain(shared, emitData)
    await vi.advanceTimersByTimeAsync(500)
    await Promise.resolve()
    await Promise.resolve()
    expect(emitData).not.toHaveBeenCalled()
    vi.useRealTimers()
    for (const stop of typing.unsubscribe) {
      stop()
    }
    for (const stop of shared.unsubscribe) {
      stop()
    }
    visibleRendererPtys.clear()
    activeRendererPtys.clear()
  })

  it('exclusive-drains a unique visible background pane', async () => {
    const unread = 'x'.repeat(512 * 1024)
    const { transport } = handlerTransport({})
    transport.controlTerminal = vi.fn(() => exclusiveBytes(unread))
    const emitData = vi.fn()
    const background = {
      id: 'herdr:background',
      paneId: 'w1:p2',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    visibleRendererPtys.add('herdr:background')
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(background, emitData)
    await vi.advanceTimersByTimeAsync(250)
    await Promise.resolve()
    await Promise.resolve()
    expect(emitData).toHaveBeenCalledWith({
      id: 'herdr:background',
      data: unread,
      sequenceChars: unread.length
    })
    vi.useRealTimers()
    for (const stop of background.unsubscribe) {
      stop()
    }
    visibleRendererPtys.clear()
  })

  it('keeps exclusive drain on hidden panes through empty unread pulses', async () => {
    const { transport } = handlerTransport({})
    const exclusive = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: vi.fn(() => () => undefined),
      onClosed: vi.fn(() => () => undefined)
    } as unknown as HerdrTerminalController
    transport.controlTerminal = vi.fn(() => exclusive)
    const binding = {
      id: 'herdr:hidden-empty',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      paneId: 'w1:p4',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    markHiddenRendererPty(binding.id)
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(binding, vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.resolve()
    const calls = vi.mocked(transport.controlTerminal).mock.calls.length
    await vi.advanceTimersByTimeAsync(500)
    expect(vi.mocked(transport.controlTerminal).mock.calls.length).toBeGreaterThan(calls)
    vi.useRealTimers()
    for (const stop of binding.unsubscribe) {
      stop()
    }
    clearHiddenRendererPtyDeliveryState(binding.id)
  })

  it('stops exclusive drain after two empty unread pulses', async () => {
    const { transport } = handlerTransport({})
    const exclusive = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: vi.fn(() => () => undefined),
      onClosed: vi.fn(() => () => undefined)
    } as unknown as HerdrTerminalController
    transport.controlTerminal = vi.fn(() => exclusive)
    const binding = {
      id: 'herdr:empty',
      snapshot: '',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      paneId: 'w1:p2',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(binding, vi.fn())
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(250)
    await vi.advanceTimersByTimeAsync(200)
    await Promise.resolve()
    const calls = vi.mocked(transport.controlTerminal).mock.calls.length
    await vi.advanceTimersByTimeAsync(1_000)
    expect(vi.mocked(transport.controlTerminal).mock.calls.length).toBe(calls)
    expect(calls).toBe(2)
    vi.useRealTimers()
    for (const stop of binding.unsubscribe) {
      stop()
    }
  })

  it('does not drain the active renderer pane', async () => {
    const { transport } = handlerTransport({})
    transport.controlTerminal = vi.fn(() => exclusiveBytes('x'.repeat(512 * 1024)))
    const emitData = vi.fn()
    const binding = {
      id: 'herdr:active',
      snapshot: 'a',
      sequenceChars: 0,
      detached: false,
      unsubscribe: [],
      sessionName: 'orca',
      paneId: 'w1:p1',
      cols: 80,
      rows: 24,
      transport
    } as unknown as HerdrPtyBinding
    visibleRendererPtys.add('herdr:active')
    activeRendererPtys.add('herdr:active')
    vi.useFakeTimers()
    startHerdrPaneScrollbackDrain(binding, emitData)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(emitData).not.toHaveBeenCalled()
    vi.useRealTimers()
    for (const stop of binding.unsubscribe) {
      stop()
    }
    visibleRendererPtys.clear()
    activeRendererPtys.clear()
  })
})
