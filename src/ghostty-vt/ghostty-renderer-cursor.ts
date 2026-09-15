import type { GhosttyVtHost } from './wasm-host'
import type { ThemeRgb } from './ghostty-color-theme'

export type GhosttyCursorBlit = {
  x: number
  y: number
  w: number
  h: number
  hollow: boolean
  color: ThemeRgb
}

export function visitRenderStateCursor(
  host: GhosttyVtHost,
  state: number,
  cellWidth: number,
  cellHeight: number,
  color: ThemeRgb,
  blinkVisible: boolean,
  visit: (blit: GhosttyCursorBlit) => void
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
  const bar = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'BAR')
  const underline = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'UNDERLINE')
  const hollow = host.enumValue('GhosttyRenderStateCursorVisualStyle', 'BLOCK_HOLLOW')
  const px = x * cellWidth
  const py = y * cellHeight
  if (style === bar) {
    visit({ x: px, y: py, w: 2, h: cellHeight, hollow: false, color })
  } else if (style === underline) {
    visit({ x: px, y: py + cellHeight - 2, w: cellWidth, h: 2, hollow: false, color })
  } else if (style === hollow) {
    visit({ x: px, y: py, w: cellWidth, h: cellHeight, hollow: true, color })
  } else {
    visit({ x: px, y: py, w: cellWidth, h: cellHeight, hollow: false, color })
  }
  host.free(ptr, size)
}
