'use strict'

function ghosttySurfacePixels(cssWidth, cssHeight, scale) {
  const factor = scale > 0 ? scale : 1
  return {
    widthPx: Math.max(1, Math.round(cssWidth * factor)),
    heightPx: Math.max(1, Math.round(cssHeight * factor))
  }
}

function finiteCssPx(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed.endsWith('px')) return null
  const n = Number.parseFloat(trimmed)
  return Number.isFinite(n) && n > 0 ? n : null
}

function capCss(current, ...declared) {
  const caps = declared.map(finiteCssPx).filter((n) => n !== null)
  if (caps.length === 0) return current
  return Math.min(current, ...caps)
}

/**
 * Layout can leave a canvas at its bitmap size after an inline width is set
 * (flex min-width:auto). The PTY still needs the narrower CSS box.
 */
function reportedCssBox(rect, style) {
  const width = rect && rect.width > 0 ? rect.width : 0
  const height = rect && rect.height > 0 ? rect.height : 0
  return {
    width: capCss(width, style && style.width, style && style.maxWidth),
    height: capCss(height, style && style.height, style && style.maxHeight)
  }
}

module.exports = { ghosttySurfacePixels, reportedCssBox }
