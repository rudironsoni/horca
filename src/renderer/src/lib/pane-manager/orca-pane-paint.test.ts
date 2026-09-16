import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaintScheduler } from './orca-pane-paint'

describe('createPaintScheduler', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('paints immediately then once more after coalesced refreshes', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    const paint = vi.fn()
    const scheduler = createPaintScheduler(paint)
    scheduler.refresh()
    scheduler.refresh()
    scheduler.refresh()
    expect(paint).toHaveBeenCalledTimes(0)
    frames[0]?.(0)
    expect(paint).toHaveBeenCalledTimes(1)
    scheduler.dispose()
  })

  it('defers background refresh until the background paint timer', () => {
    vi.useFakeTimers()
    const paint = vi.fn()
    const scheduler = createPaintScheduler(paint)
    scheduler.refreshBackground()
    scheduler.refreshBackground()
    expect(paint).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(50)
    expect(paint).toHaveBeenCalledTimes(1)
    scheduler.dispose()
    vi.useRealTimers()
  })
})
