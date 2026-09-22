'use strict'

function ghosttySurfacePixels(cssWidth, cssHeight, scale) {
  const factor = scale > 0 ? scale : 1
  return {
    widthPx: Math.max(1, Math.round(cssWidth * factor)),
    heightPx: Math.max(1, Math.round(cssHeight * factor))
  }
}

module.exports = { ghosttySurfacePixels }
