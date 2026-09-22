import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { ghosttySurfacePixels } = require(
  '../../../native/horca-ghostty/adopted/electron-ghostty/surface-pixels.js'
) as {
  ghosttySurfacePixels: (
    cssWidth: number,
    cssHeight: number,
    scale: number
  ) => { widthPx: number; heightPx: number }
}

describe('ghosttySurfacePixels', () => {
  it('keeps a narrow retina pane at its real device size', () => {
    expect(ghosttySurfacePixels(80, 40, 2)).toEqual({ widthPx: 160, heightPx: 80 })
  })

  it('does not report a zero surface', () => {
    expect(ghosttySurfacePixels(0, 0, 2)).toEqual({ widthPx: 1, heightPx: 1 })
  })
})
