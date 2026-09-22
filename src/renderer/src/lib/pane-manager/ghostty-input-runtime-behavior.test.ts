// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetPairedRuntimeParkingEnvironmentIdsCacheForTest,
  selectPairedRuntimeParkingEnvironmentIds
} from '../../components/terminal-pane/paired-runtime-parking-capabilities'
import {
  createRemoteRuntimePtyTextBatcher,
  createRemoteRuntimeViewportBatcher
} from '../../components/terminal-pane/remote-runtime-pty-batching'
import { captureRuntimeTerminalDropOwner } from '../../components/terminal-pane/terminal-drop-runtime-owner'
import {
  TERMINAL_IME_DEFERRED_CHORD_ABANDON_MS,
  createTerminalImeDeferredChordSender
} from '../../components/terminal-pane/terminal-ime-deferred-chord'
import { updateTerminalRemoteRuntimeRecoveryUiState } from '../../components/terminal-pane/terminal-remote-runtime-recovery-ui-state'

afterEach(() => {
  vi.useRealTimers()
})

describe('ghostty input runtime helpers', () => {
  it('drops a deferred chord when the pane cancels before the timer fires', () => {
    expect(TERMINAL_IME_DEFERRED_CHORD_ABANDON_MS).toBe(10_000)
    vi.useFakeTimers()
    const sender = createTerminalImeDeferredChordSender()
    let sent = 0
    sender.defer(null, () => {
      sent += 1
    })
    sender.cancelPending()
    vi.advanceTimersByTime(20)
    expect(sent).toBe(0)
  })

  it('sends a deferred chord on the next turn when no composition element exists', () => {
    vi.useFakeTimers()
    const sender = createTerminalImeDeferredChordSender()
    let sent = 0
    sender.defer(null, () => {
      sent += 1
    })
    vi.advanceTimersByTime(0)
    expect(sent).toBe(1)
  })

  it('keeps only environments that advertise paired parking', () => {
    resetPairedRuntimeParkingEnvironmentIdsCacheForTest()
    const statuses = new Map([
      ['env-1', { status: { capabilities: ['terminal.paired-parking.v1'] } }],
      ['env-2', { status: { capabilities: ['other'] } }]
    ])
    const ids = selectPairedRuntimeParkingEnvironmentIds(statuses)
    expect(ids.has('env-1')).toBe(true)
    expect(ids.has('env-2')).toBe(false)
    expect(selectPairedRuntimeParkingEnvironmentIds(statuses)).toBe(ids)
  })

  it('flushes queued remote text and drops a cleared viewport', () => {
    const text: string[] = []
    const batcher = createRemoteRuntimePtyTextBatcher(1_000, (value) => {
      text.push(value)
    })
    expect(batcher.push('')).toBe(true)
    expect(batcher.push('é')).toBe(true)
    batcher.flush()
    expect(text).toEqual(['é'])

    const views: Array<[number, number]> = []
    const viewport = createRemoteRuntimeViewportBatcher(1_000, (cols, rows) => {
      views.push([cols, rows])
    })
    viewport.queue(80, 24)
    viewport.clear()
    viewport.flush()
    expect(views).toEqual([])
    viewport.queue(100, 40)
    viewport.flush()
    expect(views).toEqual([[100, 40]])
  })

  it('returns no drop owner when the worktree has no runtime', () => {
    expect(captureRuntimeTerminalDropOwner('missing-worktree')).toBeNull()
  })

  it('shows a disconnected recovery phase and clears an idle phase', () => {
    const disconnected = { phase: 'disconnected' as const }
    const shown = updateTerminalRemoteRuntimeRecoveryUiState({}, 4, disconnected as never)
    expect(shown[4]).toBe(disconnected)
    const same = updateTerminalRemoteRuntimeRecoveryUiState(shown, 4, disconnected as never)
    expect(same).toBe(shown)
    const cleared = updateTerminalRemoteRuntimeRecoveryUiState(shown, 4, { phase: 'idle' } as never)
    expect(cleared[4]).toBeUndefined()
  })
})
