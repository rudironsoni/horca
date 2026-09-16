import type { GhosttyVtHost } from './wasm-host'
import type { ThemeRgb } from './ghostty-color-theme'
import { rgbToCss } from './ghostty-color-theme'

export type CellStyle = {
  bold: boolean
  italic: boolean
  underline: boolean
  strikethrough: boolean
  invisible: boolean
  faint: boolean
  inverse: boolean
}

export const NO_STYLE: CellStyle = {
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  invisible: false,
  faint: false,
  inverse: false
}

export function readStyleFromPtr(host: GhosttyVtHost, ptr: number): CellStyle {
  const bytes = host.bytes()
  const view = host.view()
  return {
    bold: bytes[ptr + host.field('GhosttyStyle', 'bold').offset] !== 0,
    italic: bytes[ptr + host.field('GhosttyStyle', 'italic').offset] !== 0,
    faint: bytes[ptr + host.field('GhosttyStyle', 'faint').offset] !== 0,
    inverse: bytes[ptr + host.field('GhosttyStyle', 'inverse').offset] !== 0,
    underline: view.getInt32(ptr + host.field('GhosttyStyle', 'underline').offset, true) !== 0,
    strikethrough: bytes[ptr + host.field('GhosttyStyle', 'strikethrough').offset] !== 0,
    invisible: bytes[ptr + host.field('GhosttyStyle', 'invisible').offset] !== 0
  }
}

export type RenderCursorColors = {
  cursor: ThemeRgb
  foreground: ThemeRgb
}

export function drawRenderStateCursor(
  host: GhosttyVtHost,
  ctx: CanvasRenderingContext2D,
  state: number,
  cellWidth: number,
  cellHeight: number,
  colors: RenderCursorColors,
  blinkVisible: boolean
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
  const blinking = bytes[ptr + host.field('GhosttyRenderStateCursor', 'blinking').offset] !== 0
  if (!hasValue || !visible || (blinking && !blinkVisible)) {
    host.free(ptr, size)
    return
  }
  const x = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_x').offset, true)
  const y = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_y').offset, true)
  const style = view.getInt32(
    ptr + host.field('GhosttyRenderStateCursor', 'visual_style').offset,
    true
  )
  const css = rgbToCss(colors.cursor)
  const px = x * cellWidth
  const py = y * cellHeight
  ctx.fillStyle = css
  ctx.strokeStyle = css
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
