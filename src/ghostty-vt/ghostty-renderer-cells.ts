import type { ThemeRgb } from './ghostty-css-color'
import { rgbToCss } from './ghostty-css-color'
import { NO_STYLE, readStyleFromPtr, type CellStyle } from './ghostty-renderer-paint'
import type { FrameColors, GhosttyRendererScratch } from './ghostty-renderer-state'
import { rgbAt } from './ghostty-renderer-state'
import type { GhosttyVtHost } from './wasm-host'

export const UTF8_CAP = 64
const decoder = new TextDecoder()

export type GhosttyRowCellSource = {
  host: GhosttyVtHost
  cells: number
  rowIter: number
  scratch: GhosttyRendererScratch
  cellWidth: number
  cellHeight: number
  backgroundAlpha: number
  selectionBg: ThemeRgb | null
  selectionFg: ThemeRgb | null
  cellFont: (italic: boolean, bold: boolean) => string
}

export type GhosttyRowPaintTarget = GhosttyRowCellSource & {
  ctx: CanvasRenderingContext2D
  glyphBaseline: number
}

export type GhosttyVisitedCell = {
  x: number
  y: number
  columns: number
  grapheme: string
  fg: ThemeRgb
  bg: ThemeRgb
  bgAlpha: number
  font: string
  underline: boolean
  strike: boolean
}

export function forEachGhosttyRenderCell(
  target: GhosttyRowCellSource,
  y: number,
  colors: FrameColors,
  visit: (cell: GhosttyVisitedCell) => void
): number {
  const { host, scratch } = target
  host.writeU32(scratch.cells, target.cells)
  host.check(
    host.exports.ghostty_render_state_row_get(
      target.rowIter,
      host.enumValue('GhosttyRenderStateRowData', 'CELLS'),
      scratch.cells
    ),
    'ROW CELLS'
  )
  target.cells = host.readU32(scratch.cells)
  let x = 0
  while (host.exports.ghostty_render_state_row_cells_next(target.cells)) {
    const wide = readWide(target)
    if (
      wide === host.enumValue('GhosttyCellWide', 'SPACER_TAIL') ||
      wide === host.enumValue('GhosttyCellWide', 'SPACER_HEAD')
    ) {
      x += 1
      continue
    }
    const columns = wide === host.enumValue('GhosttyCellWide', 'WIDE') ? 2 : 1
    const selected = readSelected(target)
    const bg = readCellRgb(target, scratch.bg, 'BG_COLOR')
    const fg = readCellRgb(target, scratch.fg, 'FG_COLOR')
    const style = readStyle(target)
    let bgRgb = bg ?? colors.background
    let fgRgb = fg ?? colors.foreground
    if (style.inverse) {
      const swap = bgRgb
      bgRgb = fgRgb
      fgRgb = swap
    }
    if (selected) {
      bgRgb = target.selectionBg ?? fgRgb
      fgRgb = target.selectionFg ?? bg ?? colors.background
    }
    visit({
      x,
      y,
      columns,
      grapheme: style.invisible ? '' : readCellUtf8(target),
      fg: style.faint ? dimRgb(fgRgb) : fgRgb,
      bg: bgRgb,
      bgAlpha: bg ? 1 : target.backgroundAlpha,
      font: target.cellFont(style.italic, style.bold),
      underline: style.underline,
      strike: style.strikethrough
    })
    x += 1
  }
  return target.cells
}

export function paintGhosttyRenderRow(
  target: GhosttyRowPaintTarget,
  y: number,
  colors: FrameColors
): number {
  const py = y * target.cellHeight
  let runStart = 0
  let runColumns = 0
  let runText = ''
  let runFg = ''
  let runBg = ''
  let runFont = ''
  let runUnderline = false
  let runStrike = false
  const flush = (): void => {
    if (!runText && runColumns === 0) {
      return
    }
    const px = runStart * target.cellWidth
    const width = runColumns * target.cellWidth
    target.ctx.fillStyle = runBg
    target.ctx.fillRect(px, py, width, target.cellHeight)
    if (runText) {
      target.ctx.font = runFont
      target.ctx.fillStyle = runFg
      target.ctx.fillText(runText, px, py + target.glyphBaseline)
    }
    target.ctx.strokeStyle = runFg
    target.ctx.lineWidth = 1
    if (runUnderline) {
      target.ctx.beginPath()
      target.ctx.moveTo(px, py + target.cellHeight - 1)
      target.ctx.lineTo(px + width, py + target.cellHeight - 1)
      target.ctx.stroke()
    }
    if (runStrike) {
      target.ctx.beginPath()
      target.ctx.moveTo(px, py + target.cellHeight / 2)
      target.ctx.lineTo(px + width, py + target.cellHeight / 2)
      target.ctx.stroke()
    }
    runText = ''
    runColumns = 0
  }
  target.cells = forEachGhosttyRenderCell(target, y, colors, (cell) => {
    const fgCss = rgbToCss(cell.fg)
    const bgCss = rgbToCss(cell.bg, cell.bgAlpha)
    if (
      runColumns > 0 &&
      (fgCss !== runFg ||
        bgCss !== runBg ||
        cell.font !== runFont ||
        cell.underline !== runUnderline ||
        cell.strike !== runStrike)
    ) {
      flush()
      runStart = cell.x
    }
    if (runColumns === 0) {
      runStart = cell.x
      runFg = fgCss
      runBg = bgCss
      runFont = cell.font
      runUnderline = cell.underline
      runStrike = cell.strike
    }
    runText += cell.grapheme
    runColumns += cell.columns
  })
  flush()
  return target.cells
}

function dimRgb(rgb: ThemeRgb): ThemeRgb {
  return [Math.round(rgb[0] * 0.5), Math.round(rgb[1] * 0.5), Math.round(rgb[2] * 0.5)]
}

function readSelected(target: GhosttyRowCellSource): boolean {
  const result = target.host.exports.ghostty_render_state_row_cells_get(
    target.cells,
    target.host.enumValue('GhosttyRenderStateRowCellsData', 'SELECTED'),
    target.scratch.selected
  )
  return result === target.host.success && target.host.bytes()[target.scratch.selected] !== 0
}

function readCellRgb(
  target: GhosttyRowCellSource,
  ptr: number,
  name: 'BG_COLOR' | 'FG_COLOR'
): ThemeRgb | null {
  const result = target.host.exports.ghostty_render_state_row_cells_get(
    target.cells,
    target.host.enumValue('GhosttyRenderStateRowCellsData', name),
    ptr
  )
  if (result !== target.host.success) {
    return null
  }
  return rgbAt(target.host, ptr)
}

function readStyle(target: GhosttyRowCellSource): CellStyle {
  const { host, scratch } = target
  const size = host.structSize('GhosttyStyle')
  host.bytes().fill(0, scratch.style, scratch.style + size)
  host.writeU32(scratch.style, size)
  const result = host.exports.ghostty_render_state_row_cells_get(
    target.cells,
    host.enumValue('GhosttyRenderStateRowCellsData', 'STYLE'),
    scratch.style
  )
  if (result !== host.success) {
    return NO_STYLE
  }
  return readStyleFromPtr(host, scratch.style)
}

function readWide(target: GhosttyRowCellSource): number {
  const result = target.host.exports.ghostty_render_state_row_cells_get(
    target.cells,
    target.host.enumValue('GhosttyRenderStateRowCellsData', 'RAW'),
    target.scratch.raw
  )
  if (result !== target.host.success) {
    return target.host.enumValue('GhosttyCellWide', 'NARROW')
  }
  const packed = target.host.view().getBigUint64(target.scratch.raw, true)
  return Number((packed >> 42n) & 3n)
}

function readCellUtf8(target: GhosttyRowCellSource): string {
  const { host, scratch } = target
  host.writeU32(scratch.utf8, scratch.utf8Storage)
  host.writeU32(scratch.utf8 + 4, UTF8_CAP)
  host.writeU32(scratch.utf8 + 8, 0)
  const result = host.exports.ghostty_render_state_row_cells_get(
    target.cells,
    host.enumValue('GhosttyRenderStateRowCellsData', 'GRAPHEMES_UTF8'),
    scratch.utf8
  )
  if (result !== host.success) {
    return ''
  }
  const len = host.readU32(scratch.utf8 + 8)
  if (len === 0) {
    return ''
  }
  return decoder.decode(host.bytes().subarray(scratch.utf8Storage, scratch.utf8Storage + len))
}
