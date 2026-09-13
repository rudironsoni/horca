import type { GhosttyTerminal } from './ghostty-terminal'
import { ghosttyVt } from './ghostty-vt-access'
import { drawPreeditOverlay } from './ghostty-preedit'
import { drawRenderStateCursor } from './ghostty-renderer-paint'
import type { ThemeRgb } from './ghostty-css-color'
import { rgbToCss } from './ghostty-css-color'
import {
  paintGhosttyRenderRow,
  UTF8_CAP,
  type GhosttyRowPaintTarget
} from './ghostty-renderer-cells'
import {
  bindRenderRowIterator,
  isRenderDirty,
  readRenderColors,
  readRenderDirty,
  readRenderStateU16,
  type GhosttyRendererScratch
} from './ghostty-renderer-state'
import type { GhosttyVtHost } from './wasm-host'

export type GhosttyRendererMetrics = {
  cellWidth: number
  cellHeight: number
  fontFamily: string
  fontSize: number
  fontWeight?: string | number
  fontWeightBold?: string | number
}

export type GhosttyRendererOptions = GhosttyRendererMetrics

export class GhosttyRenderer {
  private readonly host: GhosttyVtHost
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly state: number
  private rowIter: number
  private cells: number
  private cellWidth: number
  private cellHeight: number
  private fontFamily: string
  private fontSize: number
  private fontWeight: string
  private fontWeightBold: string
  private glyphBaseline = 0
  private backgroundAlpha = 1
  private selectionBg: ThemeRgb | null = null
  private selectionFg: ThemeRgb | null = null
  private blinkVisible = true
  private lastBlinkDrawn = true
  private forceFull = true
  private preedit = ''
  private disposed = false
  private readonly scratch: GhosttyRendererScratch

  constructor(host: GhosttyVtHost, canvas: HTMLCanvasElement, options: GhosttyRendererOptions) {
    this.host = host
    this.canvas = canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas2D is unavailable')
    }
    this.ctx = ctx
    this.cellWidth = options.cellWidth
    this.cellHeight = options.cellHeight
    this.fontFamily = options.fontFamily
    this.fontSize = options.fontSize
    this.fontWeight = String(options.fontWeight ?? '400')
    this.fontWeightBold = String(options.fontWeightBold ?? '700')
    const stateSlot = host.allocOpaque()
    host.check(host.exports.ghostty_render_state_new(0, stateSlot), 'render_state_new')
    this.state = host.takeOpaque(stateSlot)
    host.freeOpaque(stateSlot)
    const rowSlot = host.allocOpaque()
    host.check(host.exports.ghostty_render_state_row_iterator_new(0, rowSlot), 'row_iterator_new')
    this.rowIter = host.takeOpaque(rowSlot)
    host.freeOpaque(rowSlot)
    const cellsSlot = host.allocOpaque()
    host.check(host.exports.ghostty_render_state_row_cells_new(0, cellsSlot), 'row_cells_new')
    this.cells = host.takeOpaque(cellsSlot)
    host.freeOpaque(cellsSlot)
    this.scratch = {
      dirty: host.alloc(4),
      y: host.alloc(2),
      iter: host.alloc(4),
      cells: host.alloc(4),
      colors: host.alloc(host.structSize('GhosttyRenderStateColors')),
      selected: host.alloc(1),
      bg: host.alloc(3),
      fg: host.alloc(3),
      style: host.alloc(host.structSize('GhosttyStyle')),
      raw: host.alloc(8),
      utf8: host.alloc(host.structSize('GhosttyBuffer')),
      utf8Storage: host.alloc(UTF8_CAP)
    }
  }

  setMetrics(metrics: GhosttyRendererMetrics): void {
    this.cellWidth = metrics.cellWidth
    this.cellHeight = metrics.cellHeight
    this.fontFamily = metrics.fontFamily
    this.fontSize = metrics.fontSize
    if (metrics.fontWeight !== undefined) {
      this.fontWeight = String(metrics.fontWeight)
    }
    if (metrics.fontWeightBold !== undefined) {
      this.fontWeightBold = String(metrics.fontWeightBold)
    }
    this.forceFull = true
  }

  setBackgroundAlpha(alpha: number): void {
    this.backgroundAlpha = Math.min(1, Math.max(0, alpha))
    this.forceFull = true
  }

  setSelectionColors(background: ThemeRgb | null, foreground: ThemeRgb | null): void {
    this.selectionBg = background
    this.selectionFg = foreground
    this.forceFull = true
  }

  setBlinkVisible(visible: boolean): void {
    this.blinkVisible = visible
  }

  setPreedit(text: string): void {
    this.preedit = text
  }

  invalidate(): void {
    this.forceFull = true
  }

  draw(terminal: GhosttyTerminal, dpr = 1): void {
    if (this.disposed || terminal.isDisposed) {
      return
    }
    const { host } = this
    host.check(
      host.exports.ghostty_render_state_update(this.state, ghosttyVt(terminal).term),
      'render_state_update'
    )
    const dirty = readRenderDirty(host, this.state, this.scratch)
    const colors = readRenderColors(host, this.state, this.scratch)
    const cols = readRenderStateU16(host, this.state, this.scratch, 'COLS')
    const rows = readRenderStateU16(host, this.state, this.scratch, 'ROWS')
    const cssWidth = cols * this.cellWidth
    const cssHeight = rows * this.cellHeight
    const width = Math.max(1, Math.floor(cssWidth * dpr))
    const height = Math.max(1, Math.floor(cssHeight * dpr))
    const resized = this.canvas.width !== width || this.canvas.height !== height
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`
    if (resized) {
      this.canvas.width = width
      this.canvas.height = height
      this.forceFull = true
    }
    const blinkChanged = this.blinkVisible !== this.lastBlinkDrawn
    const full = isRenderDirty(host, dirty, 'FULL')
    const none = isRenderDirty(host, dirty, 'FALSE')
    if (none && !this.forceFull && !blinkChanged && !resized) {
      return
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.refreshGlyphBaseline()
    const defaultFont = this.cellFont(false, false)
    this.ctx.font = defaultFont
    this.ctx.textBaseline = 'alphabetic'
    if (full || this.forceFull) {
      this.ctx.fillStyle = rgbToCss(colors.background, this.backgroundAlpha)
      this.ctx.fillRect(0, 0, cssWidth, cssHeight)
    }
    this.rowIter = bindRenderRowIterator(host, this.state, this.scratch, this.rowIter)
    const rowTarget = this.rowTarget()
    if (full || this.forceFull) {
      let y = 0
      while (host.exports.ghostty_render_state_row_iterator_next(this.rowIter)) {
        this.cells = paintGhosttyRenderRow(rowTarget, y, colors)
        y += 1
      }
    } else {
      while (
        host.exports.ghostty_render_state_row_iterator_next_dirty(this.rowIter, this.scratch.y)
      ) {
        const y = host.view().getUint16(this.scratch.y, true)
        this.cells = paintGhosttyRenderRow(rowTarget, y, colors)
      }
    }
    drawRenderStateCursor(
      host,
      this.ctx,
      this.state,
      this.cellWidth,
      this.cellHeight,
      { cursor: colors.cursor, foreground: colors.foreground },
      this.blinkVisible
    )
    drawPreeditOverlay(
      this.ctx,
      host,
      this.state,
      this.preedit,
      this.cellWidth,
      this.cellHeight,
      defaultFont,
      this.glyphBaseline,
      colors
    )
    host.exports.ghostty_render_state_clean(this.state)
    this.forceFull = false
    this.lastBlinkDrawn = this.blinkVisible
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const { host, scratch } = this
    host.free(scratch.dirty, 4)
    host.free(scratch.y, 2)
    host.free(scratch.iter, 4)
    host.free(scratch.cells, 4)
    host.free(scratch.colors, host.structSize('GhosttyRenderStateColors'))
    host.free(scratch.selected, 1)
    host.free(scratch.bg, 3)
    host.free(scratch.fg, 3)
    host.free(scratch.style, host.structSize('GhosttyStyle'))
    host.free(scratch.raw, 8)
    host.free(scratch.utf8, host.structSize('GhosttyBuffer'))
    host.free(scratch.utf8Storage, UTF8_CAP)
    host.exports.ghostty_render_state_row_cells_free(this.cells)
    host.exports.ghostty_render_state_row_iterator_free(this.rowIter)
    host.exports.ghostty_render_state_free(this.state)
  }

  private rowTarget(): GhosttyRowPaintTarget {
    return {
      host: this.host,
      ctx: this.ctx,
      cells: this.cells,
      rowIter: this.rowIter,
      scratch: this.scratch,
      cellWidth: this.cellWidth,
      cellHeight: this.cellHeight,
      glyphBaseline: this.glyphBaseline,
      backgroundAlpha: this.backgroundAlpha,
      selectionBg: this.selectionBg,
      selectionFg: this.selectionFg,
      cellFont: (italic, bold) => this.cellFont(italic, bold)
    }
  }

  private cellFont(italic: boolean, bold: boolean): string {
    const italicPrefix = italic ? 'italic ' : ''
    const weight = bold ? this.fontWeightBold : this.fontWeight
    return `${italicPrefix}${weight} ${this.fontSize}px ${this.fontFamily}`
  }

  private refreshGlyphBaseline(): void {
    this.ctx.font = this.cellFont(false, false)
    const metrics = this.ctx.measureText('M')
    const ascent = metrics.actualBoundingBoxAscent || this.fontSize * 0.8
    const descent = metrics.actualBoundingBoxDescent || this.fontSize * 0.2
    this.glyphBaseline = (this.cellHeight - (ascent + descent)) / 2 + ascent
  }
}
