import type { GhosttyVtHost } from './wasm-host'

export type CellStyle = {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  invisible: boolean
}

const NO_STYLE: CellStyle = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  invisible: false
}

export function readCellStyle(host: GhosttyVtHost, cells: number): CellStyle {
  const flag = host.alloc(1)
  const styled = host.exports.ghostty_render_state_row_cells_get(
    cells,
    host.enumValue('GhosttyRenderStateRowCellsData', 'HAS_STYLING'),
    flag
  )
  const hasStyle = styled === host.success && host.bytes()[flag] !== 0
  host.free(flag, 1)
  if (!hasStyle) {
    return NO_STYLE
  }
  const size = host.structSize('GhosttyStyle')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  host.writeU32(ptr, size)
  const result = host.exports.ghostty_render_state_row_cells_get(
    cells,
    host.enumValue('GhosttyRenderStateRowCellsData', 'STYLE'),
    ptr
  )
  if (result !== host.success) {
    host.free(ptr, size)
    return NO_STYLE
  }
  const bytes = host.bytes()
  const view = host.view()
  const style = {
    bold: bytes[ptr + host.field('GhosttyStyle', 'bold').offset] !== 0,
    italic: bytes[ptr + host.field('GhosttyStyle', 'italic').offset] !== 0,
    underline: view.getInt32(ptr + host.field('GhosttyStyle', 'underline').offset, true) !== 0,
    strikethrough: bytes[ptr + host.field('GhosttyStyle', 'strikethrough').offset] !== 0,
    invisible: bytes[ptr + host.field('GhosttyStyle', 'invisible').offset] !== 0
  }
  host.free(ptr, size)
  return style
}

export function drawRenderStateCursor(
  host: GhosttyVtHost,
  ctx: CanvasRenderingContext2D,
  state: number,
  cellWidth: number,
  cellHeight: number
): void {
  const size = host.structSize('GhosttyRenderStateCursor')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  host.writeU32(ptr, size)
  const result = host.exports.ghostty_render_state_get(
    state,
    host.enumValue('GhosttyRenderStateData', 'CURSOR'),
    ptr
  )
  if (result !== host.success) {
    host.free(ptr, size)
    return
  }
  const view = host.view()
  const bytes = host.bytes()
  const hasValue =
    bytes[ptr + host.field('GhosttyRenderStateCursor', 'viewport_has_value').offset] !== 0
  const visible = bytes[ptr + host.field('GhosttyRenderStateCursor', 'visible').offset] !== 0
  if (!hasValue || !visible) {
    host.free(ptr, size)
    return
  }
  const x = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_x').offset, true)
  const y = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_y').offset, true)
  const style = view.getInt32(
    ptr + host.field('GhosttyRenderStateCursor', 'visual_style').offset,
    true
  )
  const px = x * cellWidth
  const py = y * cellHeight
  ctx.fillStyle = '#dddddd'
  ctx.strokeStyle = '#dddddd'
  const bar = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'BAR')
  const underline = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'UNDERLINE')
  const hollow = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'BLOCK_HOLLOW')
  if (style === bar) {
    ctx.fillRect(px, py, 2, cellHeight)
  } else if (style === underline) {
    ctx.fillRect(px, py + cellHeight - 2, cellWidth, 2)
  } else if (style === hollow) {
    ctx.strokeRect(px + 0.5, py + 0.5, cellWidth - 1, cellHeight - 1)
  } else {
    ctx.fillRect(px, py, cellWidth, cellHeight)
  }
  host.free(ptr, size)
}
