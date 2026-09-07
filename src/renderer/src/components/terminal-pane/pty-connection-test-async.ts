import { vi } from 'vitest'

type HeadlessWriter = {
  write: (data: string) => Promise<void>
  getVisibleLines: () => string[]
  dispose: () => void
}

function createHeadlessWriter(cols: number, rows: number): HeadlessWriter {
  const { HeadlessEmulator } = require('../../../../main/daemon/headless-emulator') as {
    HeadlessEmulator: new (opts: { cols: number; rows: number }) => HeadlessWriter
  }
  return new HeadlessEmulator({ cols, rows })
}

// Why: fresh-spawn/reattach now settle across multiple microtasks, so tests must drain several ticks before asserting on IPC mocks. See docs/mobile-prefer-renderer-scrollback.md.
export async function flushAsyncTicks(count = 6): Promise<void> {
  for (let i = 0; i < count; i++) {
    await Promise.resolve()
  }
}

export async function drainFakeTimerWork(limit = 20): Promise<void> {
  await flushAsyncTicks(20)
  if (!vi.isFakeTimers()) {
    return
  }
  for (let iteration = 0; iteration < limit && vi.getTimerCount() > 0; iteration += 1) {
    await vi.runOnlyPendingTimersAsync()
    await flushAsyncTicks(20)
  }
  vi.clearAllTimers()
  await flushAsyncTicks(20)
  vi.clearAllTimers()
}

export async function drainPendingTimeouts(
  pendingTimeouts: (() => void)[],
  limit = 100
): Promise<void> {
  let iterations = 0
  while (pendingTimeouts.length > 0) {
    if (iterations >= limit) {
      throw new Error('Timed out draining pending timeouts')
    }
    iterations += 1
    pendingTimeouts.shift()?.()
    await flushAsyncTicks()
  }
}

export function writeHeadlessTerminal(term: HeadlessWriter, data: string): Promise<void> {
  return term.write(data)
}

export async function renderHeadlessBuffer(
  writes: string[],
  cols = 80,
  rows = 8
): Promise<string[]> {
  const term = createHeadlessWriter(cols, rows)
  try {
    for (const write of writes) {
      await writeHeadlessTerminal(term, write)
    }
    return term.getVisibleLines()
  } finally {
    term.dispose()
  }
}

export async function renderHeadlessTerminalState(
  writes: string[],
  cols = 80,
  rows = 8
): Promise<{ allLines: string[]; visibleLines: string[]; baseY: number }> {
  const term = createHeadlessWriter(cols, rows)
  try {
    for (const write of writes) {
      await writeHeadlessTerminal(term, write)
    }
    const visibleLines = term.getVisibleLines()
    return { allLines: visibleLines, visibleLines, baseY: 0 }
  } finally {
    term.dispose()
  }
}

export function createDeferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
} {
  let resolveDeferred!: (value: T) => void
  let rejectDeferred!: (reason?: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve
    rejectDeferred = reject
  })
  return { promise, resolve: resolveDeferred, reject: rejectDeferred }
}
