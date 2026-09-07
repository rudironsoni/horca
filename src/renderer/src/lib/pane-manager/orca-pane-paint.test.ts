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
    expect(paint).toHaveBeenCalledTimes(1)
    frames[0]?.(0)
    expect(paint).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })
})
