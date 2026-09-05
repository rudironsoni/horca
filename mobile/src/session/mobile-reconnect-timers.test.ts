import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMobileReconnectTimers } from './mobile-reconnect-timers'

describe('createMobileReconnectTimers', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('runs scheduled work', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const timers = createMobileReconnectTimers()

    timers.schedule(callback, 750)
    vi.advanceTimersByTime(750)

    expect(callback).toHaveBeenCalledOnce()
  })

  it('cancels work when disposed', () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const timers = createMobileReconnectTimers()

    timers.schedule(callback, 750)
    timers.dispose()
    vi.runAllTimers()

    expect(callback).not.toHaveBeenCalled()
  })
})
