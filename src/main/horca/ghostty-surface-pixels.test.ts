import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { ghosttySurfacePixels, reportedCssBox } = require(
  '../../../native/horca-ghostty/adopted/electron-ghostty/surface-pixels.js'
) as {
  ghosttySurfacePixels: (
    cssWidth: number,
    cssHeight: number,
    scale: number
  ) => { widthPx: number; heightPx: number }
  reportedCssBox: (
    rect: { width: number; height: number },
    style: { width?: string; maxWidth?: string; height?: string; maxHeight?: string }
  ) => { width: number; height: number }
}

describe('ghosttySurfacePixels', () => {
  it('keeps a narrow retina pane at its real device size', () => {
    expect(ghosttySurfacePixels(80, 40, 2)).toEqual({ widthPx: 160, heightPx: 80 })
  })

  it('does not report a zero surface', () => {
    expect(ghosttySurfacePixels(0, 0, 2)).toEqual({ widthPx: 1, heightPx: 1 })
  })
})

describe('reportedCssBox', () => {
  it('reports an inline pixel width when the layout box stays at the bitmap size', () => {
    expect(
      reportedCssBox(
        { width: 800, height: 400 },
        { width: '80px', maxWidth: '80px', height: '', maxHeight: '' }
      )
    ).toEqual({ width: 80, height: 400 })
  })

  it('does not treat a percentage as a pixel cap', () => {
    expect(
      reportedCssBox(
        { width: 800, height: 400 },
        { width: '100%', maxWidth: '100%', height: '100%', maxHeight: '100%' }
      )
    ).toEqual({ width: 800, height: 400 })
  })

  it('keeps the layout box when no pixel size is declared', () => {
    expect(reportedCssBox({ width: 800, height: 400 }, {})).toEqual({ width: 800, height: 400 })
  })
})
