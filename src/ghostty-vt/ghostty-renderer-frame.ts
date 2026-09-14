import type { ThemeRgb } from './ghostty-css-color'
import type { GhosttyTerminal } from './ghostty-terminal'
import { drawPreeditOverlay } from './ghostty-preedit'
import { forEachGhosttyRenderCell, paintGhosttyRenderRow } from './ghostty-renderer-cells'
import { visitRenderStateCursor } from './ghostty-renderer-cursor'
import { drawRenderStateCursor } from './ghostty-renderer-paint'
import type { GhosttyWebglAtlas } from './ghostty-webgl-atlas'
import { rgbToCss } from './ghostty-css-color'
import {
  bindRenderRowIterator,
  isRenderDirty,
  type FrameColors,
  type GhosttyRendererScratch
} from './ghostty-renderer-state'
import type { GhosttyVtHost } from './wasm-host'

export type GhosttyFramePaint = {
  host: GhosttyVtHost
  ctx: CanvasRenderingContext2D | null
  gpu: GhosttyWebglAtlas | null
  state: number
  rowIter: number
  cells: number
  scratch: GhosttyRendererScratch
  cellWidth: number
  cellHeight: number
  glyphBaseline: number
  backgroundAlpha: number
  selectionBg: ThemeRgb | null
  selectionFg: ThemeRgb | null
  blinkVisible: boolean
  preedit: string
  forceFull: boolean
  cellFont: (italic: boolean, bold: boolean) => string
  refreshGlyphBaseline: () => void
}

export function shouldSkipGhosttyFrame(
  host: GhosttyVtHost,
  dirty: number,
  forceFull: boolean,
  blinkChanged: boolean,
  resized: boolean
): boolean {
  return isRenderDirty(host, dirty, 'FALSE') && !forceFull && !blinkChanged && !resized
}

export function paintGhosttyGpuFrame(
  paint: GhosttyFramePaint,
  colors: FrameColors,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  full: boolean
): number {
  const gpu = paint.gpu
  if (!gpu) {
    return paint.cells
  }
  gpu.begin(cssWidth, cssHeight, dpr, colors.background, paint.backgroundAlpha)
  paint.rowIter = bindRenderRowIterator(paint.host, paint.state, paint.scratch, paint.rowIter)
  const source = {
    host: paint.host,
    cells: paint.cells,
    rowIter: paint.rowIter,
    scratch: paint.scratch,
    cellWidth: paint.cellWidth,
    cellHeight: paint.cellHeight,
    backgroundAlpha: paint.backgroundAlpha,
    selectionBg: paint.selectionBg,
    selectionFg: paint.selectionFg,
    cellFont: paint.cellFont
  }
  const visitRow = (y: number): void => {
    source.cells = forEachGhosttyRenderCell(source, y, colors, (cell) => {
      gpu.paintCell(cell, paint.cellWidth, paint.cellHeight)
    })
  }
  if (full || paint.forceFull) {
    let y = 0
    while (paint.host.exports.ghostty_render_state_row_iterator_next(paint.rowIter)) {
      visitRow(y)
      y += 1
    }
  } else {
    while (
      paint.host.exports.ghostty_render_state_row_iterator_next_dirty(
        paint.rowIter,
        paint.scratch.y
      )
    ) {
      visitRow(paint.host.view().getUint16(paint.scratch.y, true))
    }
  }
  visitRenderStateCursor(
    paint.host,
    paint.state,
    paint.cellWidth,
    paint.cellHeight,
    colors.cursor,
    paint.blinkVisible,
    (blit) => gpu.fillRect(blit.x, blit.y, blit.w, blit.h, blit.color)
  )
  gpu.end()
  return source.cells
}

export function paintGhosttyCanvas2dFrame(
  paint: GhosttyFramePaint,
  _terminal: GhosttyTerminal,
  colors: FrameColors,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  full: boolean
): number {
  const ctx = paint.ctx
  if (!ctx) {
    return paint.cells
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  paint.refreshGlyphBaseline()
  const defaultFont = paint.cellFont(false, false)
  ctx.font = defaultFont
  ctx.textBaseline = 'alphabetic'
  if (full || paint.forceFull) {
    ctx.fillStyle = rgbToCss(colors.background, paint.backgroundAlpha)
    ctx.fillRect(0, 0, cssWidth, cssHeight)
  }
  paint.rowIter = bindRenderRowIterator(paint.host, paint.state, paint.scratch, paint.rowIter)
  const rowTarget = {
    host: paint.host,
    ctx,
    cells: paint.cells,
    rowIter: paint.rowIter,
    scratch: paint.scratch,
    cellWidth: paint.cellWidth,
    cellHeight: paint.cellHeight,
    glyphBaseline: paint.glyphBaseline,
    backgroundAlpha: paint.backgroundAlpha,
    selectionBg: paint.selectionBg,
    selectionFg: paint.selectionFg,
    cellFont: paint.cellFont
  }
  if (full || paint.forceFull) {
    let y = 0
    while (paint.host.exports.ghostty_render_state_row_iterator_next(paint.rowIter)) {
      rowTarget.cells = paintGhosttyRenderRow(rowTarget, y, colors)
      y += 1
    }
  } else {
    while (
      paint.host.exports.ghostty_render_state_row_iterator_next_dirty(
        paint.rowIter,
        paint.scratch.y
      )
    ) {
      const y = paint.host.view().getUint16(paint.scratch.y, true)
      rowTarget.cells = paintGhosttyRenderRow(rowTarget, y, colors)
    }
  }
  drawRenderStateCursor(
    paint.host,
    ctx,
    paint.state,
    paint.cellWidth,
    paint.cellHeight,
    { cursor: colors.cursor, foreground: colors.foreground },
    paint.blinkVisible
  )
  drawPreeditOverlay(
    ctx,
    paint.host,
    paint.state,
    paint.preedit,
    paint.cellWidth,
    paint.cellHeight,
    defaultFont,
    paint.glyphBaseline,
    colors
  )
  return rowTarget.cells
}
