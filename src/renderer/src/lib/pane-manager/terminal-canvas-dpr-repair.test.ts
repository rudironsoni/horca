import { describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from './pane-manager-types'
import {
  repairPaneWebglCanvasDpr,
  repairPaneWebglCanvasDprMismatch
} from './terminal-canvas-dpr-repair'

function makePane(args: {
  backingWidth: number
  dpr: number
  backingHeight?: number
  connected?: boolean
  hasCanvas?: boolean
  cols?: number
  rows?: number
  cellWidth?: number
  cellHeight?: number
}): {
  pane: ManagedPane
  refresh: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn()
  const cols = args.cols ?? 120
  const rows = args.rows ?? 40
  const cellWidth = args.cellWidth ?? 9
  const cellHeight = args.cellHeight ?? 15
  const canvas =
    (args.hasCanvas ?? true)
      ? {
          width: args.backingWidth,
          height: args.backingHeight ?? Math.max(1, Math.floor(rows * cellHeight * args.dpr)),
          isConnected: args.connected ?? true,
          ownerDocument: { defaultView: { devicePixelRatio: args.dpr } },
          getBoundingClientRect: () => {
            throw new Error('repair detection must not force layout')
          }
        }
      : null
  const pane = {
    id: 1,
    terminal: {
      cols,
      rows,
      cellWidth,
      cellHeight,
      element: canvas,
      refresh
    }
  } as unknown as ManagedPane
  return { pane, refresh }
}

describe('repairPaneWebglCanvasDprMismatch', () => {
  it('repairs a stale dpr-2 backing composited on a dpr-1 display', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2160,
      dpr: 1
    })

    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(true)
    expect(refresh).toHaveBeenCalledWith(0, 39)
  })

  it('repairs the opposite direction (dpr-1 backing upscaled on retina)', () => {
    const { pane, refresh } = makePane({ backingWidth: 1080, dpr: 2 })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('is a no-op when backing matches cols × cell × dpr', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2160,
      dpr: 2
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('tolerates sub-pixel rounding without churning', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2161,
      dpr: 2
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('tolerates the larger device-pixel round trip on high-dpr displays', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2162,
      dpr: 4,
      cols: 270,
      cellWidth: 2
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('repairs when only the canvas height has stale backing', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2160,
      dpr: 2,
      backingHeight: 600
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('skips detached, zero-dimension, and canvas-less panes', () => {
    const detached = makePane({
      backingWidth: 2160,
      dpr: 1,
      connected: false
    })
    expect(repairPaneWebglCanvasDprMismatch(detached.pane)).toBe(false)

    const zeroDimension = makePane({
      backingWidth: 2160,
      dpr: 1,
      cols: 0
    })
    expect(repairPaneWebglCanvasDprMismatch(zeroDimension.pane)).toBe(false)

    const noCanvas = makePane({
      backingWidth: 2160,
      dpr: 1,
      hasCanvas: false
    })
    expect(repairPaneWebglCanvasDprMismatch(noCanvas.pane)).toBe(false)
  })

  it('defers an unmeasurable canvas but accepts a canvas-less pane', () => {
    const detached = makePane({
      backingWidth: 2160,
      dpr: 1,
      connected: false
    })
    const noCanvas = makePane({
      backingWidth: 2160,
      dpr: 1,
      hasCanvas: false
    })

    expect(repairPaneWebglCanvasDpr(detached.pane)).toBe('deferred')
    expect(repairPaneWebglCanvasDpr(noCanvas.pane)).toBe('current')
  })

  it('reports failure without throwing when the repair path throws mid-teardown', () => {
    const { pane, refresh } = makePane({
      backingWidth: 2160,
      dpr: 1
    })
    refresh.mockImplementation(() => {
      throw new Error('disposed')
    })
    expect(repairPaneWebglCanvasDprMismatch(pane)).toBe(false)
  })
})
