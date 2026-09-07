import type { GhosttyTerminal } from './ghostty-terminal'
import { drawPreeditOverlay } from './ghostty-preedit'
import { drawRenderStateCursor, readCellStyle } from './ghostty-renderer-paint'
import type { GhosttyVtHost } from './wasm-host'

function cssRgb(rgb: [number, number, number]): string
function cssRgb(rgb: [number, number, number] | null): string | null
function cssRgb(rgb: [number, number, number] | null): string | null {
  return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : null
}

export type GhosttyRendererOptions = {
  cellWidth: number
  cellHeight: number
  fontFamily: string
}

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
  private preedit = ''

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
  }

  draw(terminal: GhosttyTerminal, dpr = 1): void {
    this.host.exports.ghostty_render_state_begin_update(this.state)
    this.host.check(
      this.host.exports.ghostty_render_state_update(this.state, terminal.handle()),
      'render_state_update'
    )
    const cols = this.readStateU16('COLS')
    const rows = this.readStateU16('ROWS')
    const width = Math.max(1, Math.floor(cols * this.cellWidth * dpr))
    const height = Math.max(1, Math.floor(rows * this.cellHeight * dpr))
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.ctx.fillStyle = '#000000'
    this.ctx.fillRect(0, 0, cols * this.cellWidth, rows * this.cellHeight)
    this.ctx.font = `${this.cellHeight * 0.8}px ${this.fontFamily}`
    this.ctx.textBaseline = 'top'
    const iterSlot = this.host.alloc(4)
    this.host.writeU32(iterSlot, this.rowIter)
    this.host.check(
      this.host.exports.ghostty_render_state_get(
        this.state,
        this.host.enumValue('GhosttyRenderStateData', 'ROW_ITERATOR'),
        iterSlot
      ),
      'ROW_ITERATOR'
    )
    this.rowIter = this.host.readU32(iterSlot)
    this.host.free(iterSlot, 4)
    let y = 0
    while (this.host.exports.ghostty_render_state_row_iterator_next(this.rowIter)) {
      this.drawRow(y)
      y += 1
    }
    drawRenderStateCursor(this.host, this.ctx, this.state, this.cellWidth, this.cellHeight)
    drawPreeditOverlay(
      this.host,
      this.ctx,
      this.state,
      this.preedit,
      this.cellWidth,
      this.cellHeight,
      this.fontFamily
    )
    this.host.exports.ghostty_render_state_end_update(this.state)
    this.host.exports.ghostty_render_state_clean(this.state)
  }

  setPreedit(text: string): void {
    this.preedit = text
  }

  dispose(): void {
    this.host.exports.ghostty_render_state_row_cells_free(this.cells)
    this.host.exports.ghostty_render_state_row_iterator_free(this.rowIter)
    this.host.exports.ghostty_render_state_free(this.state)
  }

  private drawRow(y: number): void {
    const cellsSlot = this.host.alloc(4)
    this.host.writeU32(cellsSlot, this.cells)
    this.host.check(
      this.host.exports.ghostty_render_state_row_get(
        this.rowIter,
        this.host.enumValue('GhosttyRenderStateRowData', 'CELLS'),
        cellsSlot
      ),
      'ROW CELLS'
    )
    this.cells = this.host.readU32(cellsSlot)
    this.host.free(cellsSlot, 4)
    let x = 0
    while (this.host.exports.ghostty_render_state_row_cells_next(this.cells)) {
      const selected = this.readCellFlag('SELECTED')
      const bg = this.readCellRgb('BG_COLOR')
      const fg = this.readCellRgb('FG_COLOR')
      const px = x * this.cellWidth
      const py = y * this.cellHeight
      const bgCss = selected ? cssRgb(fg ?? [221, 221, 221]) : cssRgb(bg)
      const fgCss = selected ? cssRgb(bg ?? [0, 0, 0]) : cssRgb(fg ?? [221, 221, 221])
      if (bgCss) {
        this.ctx.fillStyle = bgCss
        this.ctx.fillRect(px, py, this.cellWidth, this.cellHeight)
      }
      const style = readCellStyle(this.host, this.cells)
      const grapheme = style.invisible ? '' : this.readCellUtf8()
      if (grapheme) {
        const italic = style.italic ? 'italic ' : ''
        const bold = style.bold ? 'bold ' : ''
        this.ctx.font = `${italic}${bold}${this.cellHeight * 0.8}px ${this.fontFamily}`
        this.ctx.fillStyle = fgCss
        this.ctx.fillText(grapheme, px, py)
        this.ctx.strokeStyle = fgCss
        this.ctx.lineWidth = 1
        if (style.underline) {
          this.ctx.beginPath()
          this.ctx.moveTo(px, py + this.cellHeight - 1)
          this.ctx.lineTo(px + this.cellWidth, py + this.cellHeight - 1)
          this.ctx.stroke()
        }
        if (style.strikethrough) {
          this.ctx.beginPath()
          this.ctx.moveTo(px, py + this.cellHeight / 2)
          this.ctx.lineTo(px + this.cellWidth, py + this.cellHeight / 2)
          this.ctx.stroke()
        }
      }
      x += 1
    }
  }

  private readStateU16(name: string): number {
    const ptr = this.host.alloc(2)
    this.host.check(
      this.host.exports.ghostty_render_state_get(
        this.state,
        this.host.enumValue('GhosttyRenderStateData', name),
        ptr
      ),
      `render ${name}`
    )
    const value = this.host.view().getUint16(ptr, true)
    this.host.free(ptr, 2)
    return value
  }

  private readCellFlag(name: string): boolean {
    const ptr = this.host.alloc(1)
    const result = this.host.exports.ghostty_render_state_row_cells_get(
      this.cells,
      this.host.enumValue('GhosttyRenderStateRowCellsData', name),
      ptr
    )
    const value = result === this.host.success && this.host.bytes()[ptr] !== 0
    this.host.free(ptr, 1)
    return value
  }

  private readCellRgb(name: string): [number, number, number] | null {
    const size = this.host.structSize('GhosttyColorRgb')
    const ptr = this.host.alloc(size)
    const result = this.host.exports.ghostty_render_state_row_cells_get(
      this.cells,
      this.host.enumValue('GhosttyRenderStateRowCellsData', name),
      ptr
    )
    if (result !== this.host.success) {
      this.host.free(ptr, size)
      return null
    }
    const bytes = this.host.bytes()
    const rgb: [number, number, number] = [
      bytes[ptr] ?? 0,
      bytes[ptr + 1] ?? 0,
      bytes[ptr + 2] ?? 0
    ]
    this.host.free(ptr, size)
    return rgb
  }

  private readCellUtf8(): string {
    const bufSize = this.host.structSize('GhosttyBuffer')
    const buf = this.host.alloc(bufSize)
    const storage = this.host.alloc(32)
    this.host.writeU32(buf, storage)
    this.host.writeU32(buf + 4, 32)
    this.host.writeU32(buf + 8, 0)
    const result = this.host.exports.ghostty_render_state_row_cells_get(
      this.cells,
      this.host.enumValue('GhosttyRenderStateRowCellsData', 'GRAPHEMES_UTF8'),
      buf
    )
    if (result !== this.host.success) {
      this.host.free(buf, bufSize)
      this.host.free(storage, 32)
      return ''
    }
    const len = this.host.readU32(buf + 8)
    const text = new TextDecoder().decode(this.host.bytes().subarray(storage, storage + len))
    this.host.free(buf, bufSize)
    this.host.free(storage, 32)
    return text
  }
}
