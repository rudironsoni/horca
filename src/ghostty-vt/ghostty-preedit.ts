import type { GhosttyVtHost } from './wasm-host'

export function preeditCellWidth(host: GhosttyVtHost, text: string): number {
  let cells = 0
  for (const cp of text) {
    cells += host.exports.ghostty_unicode_codepoint_width(cp.codePointAt(0) ?? 0)
  }
  return cells
}

export function drawPreeditOverlay(
  host: GhosttyVtHost,
  ctx: CanvasRenderingContext2D,
  state: number,
  text: string,
  cellWidth: number,
  cellHeight: number,
  fontFamily: string
): void {
  if (!text) {
    return
  }
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
  const x = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_x').offset, true)
  const y = view.getUint16(ptr + host.field('GhosttyRenderStateCursor', 'viewport_y').offset, true)
  host.free(ptr, size)
  let col = x
  ctx.font = `${cellHeight * 0.8}px ${fontFamily}`
  ctx.textBaseline = 'top'
  for (const grapheme of text) {
    const cells = Math.max(
      1,
      host.exports.ghostty_unicode_codepoint_width(grapheme.codePointAt(0) ?? 0)
    )
    const px = col * cellWidth
    const py = y * cellHeight
    ctx.fillStyle = '#dddddd'
    ctx.fillRect(px, py, cells * cellWidth, cellHeight)
    ctx.fillStyle = '#000000'
    ctx.fillText(grapheme, px, py)
    col += cells
  }
}
