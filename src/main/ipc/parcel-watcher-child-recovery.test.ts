import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { WatcherProcessCrashFuse } from './parcel-watcher-crash-fuse'
import {
  isWatcherProcessGroupShutdownSignal,
  recoverWatcherRecordsAfterChildGone
} from './parcel-watcher-child-recovery'
import type { WatcherProcessSubscriptionRecord } from './parcel-watcher-process-subscription'

function record(
  overrides: Partial<WatcherProcessSubscriptionRecord> = {}
): WatcherProcessSubscriptionRecord {
  return {
    id: 1,
    dir: '/repo',
    opts: {},
    callback: vi.fn(),
    hooks: {},
    interrupted: false,
    crawlStarted: false,
    ...overrides
  }
}

describe('recoverWatcherRecordsAfterChildGone', () => {
  it('does not treat SIGINT as a crash that resubscribes', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ensureWatcherProcess = vi.fn()
    const sendSubscribe = vi.fn()
    const records = new Map([[1, record()]])

    recoverWatcherRecordsAfterChildGone(
      records,
      new WatcherProcessCrashFuse(),
      false,
      ensureWatcherProcess,
      sendSubscribe,
      vi.fn(),
      null,
      'SIGINT'
    )

    expect(isWatcherProcessGroupShutdownSignal('SIGINT')).toBe(true)
    expect(ensureWatcherProcess).not.toHaveBeenCalled()
    expect(sendSubscribe).not.toHaveBeenCalled()
    expect(errorSpy.mock.calls.flat().join('\n')).not.toContain(
      'watcher process crashed; resubscribing'
    )
    expect(records.get(1)?.interrupted).toBe(false)
    errorSpy.mockRestore()
  })

  it('still resubscribes after a native crash', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const replacement = { pid: 9 } as ChildProcess
    const ensureWatcherProcess = vi.fn(() => replacement)
    const sendSubscribe = vi.fn()
    const existing = record()
    const records = new Map([[1, existing]])

    recoverWatcherRecordsAfterChildGone(
      records,
      new WatcherProcessCrashFuse(),
      false,
      ensureWatcherProcess,
      sendSubscribe,
      vi.fn(),
      3221226505,
      null
    )

    expect(ensureWatcherProcess).toHaveBeenCalledTimes(1)
    expect(sendSubscribe).toHaveBeenCalledWith(replacement, existing)
    expect(existing.interrupted).toBe(true)
    expect(errorSpy.mock.calls.flat().join('\n')).toContain(
      'watcher process crashed; resubscribing 1 root(s)'
    )
    errorSpy.mockRestore()
  })
})
