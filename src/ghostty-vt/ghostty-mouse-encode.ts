import type { GhosttyVtHost } from './wasm-host'

export type GhosttyMouseEncodeEvent = {
  type: string
  button: number
  clientX: number
  clientY: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
}

export function encodeBrowserMouse(
  host: GhosttyVtHost,
  term: number,
  event: GhosttyMouseEncodeEvent,
  surface: {
    left: number
    top: number
    cellWidth: number
    cellHeight: number
    cols: number
    rows: number
  }
): string {
  const encoderSlot = host.allocOpaque()
  host.check(host.exports.ghostty_mouse_encoder_new(0, encoderSlot), 'mouse_encoder_new')
  const encoder = host.takeOpaque(encoderSlot)
  host.freeOpaque(encoderSlot)
  host.exports.ghostty_mouse_encoder_setopt_from_terminal(encoder, term)
  const size = host.structSize('GhosttyMouseEncoderSize')
  const sizePtr = host.alloc(size)
  host.bytes().fill(0, sizePtr, sizePtr + size)
  host.writeU32(sizePtr, size)
  const view = host.view()
  view.setUint32(
    sizePtr + host.field('GhosttyMouseEncoderSize', 'cell_width').offset,
    surface.cellWidth,
    true
  )
  view.setUint32(
    sizePtr + host.field('GhosttyMouseEncoderSize', 'cell_height').offset,
    surface.cellHeight,
    true
  )
  view.setUint32(
    sizePtr + host.field('GhosttyMouseEncoderSize', 'screen_width').offset,
    surface.cols * surface.cellWidth,
    true
  )
  view.setUint32(
    sizePtr + host.field('GhosttyMouseEncoderSize', 'screen_height').offset,
    surface.rows * surface.cellHeight,
    true
  )
  host.exports.ghostty_mouse_encoder_setopt(
    encoder,
    host.enumValue('GhosttyMouseEncoderOption', 'SIZE'),
    sizePtr
  )
  host.free(sizePtr, size)
  const eventSlot = host.allocOpaque()
  host.check(host.exports.ghostty_mouse_event_new(0, eventSlot), 'mouse_event_new')
  const mouseEvent = host.takeOpaque(eventSlot)
  host.freeOpaque(eventSlot)
  const action =
    event.type === 'pointerup' || event.type === 'mouseup'
      ? 'RELEASE'
      : event.type === 'pointermove' || event.type === 'mousemove'
        ? 'MOTION'
        : 'PRESS'
  host.exports.ghostty_mouse_event_set_action(
    mouseEvent,
    host.enumValue('GhosttyMouseAction', action)
  )
  host.exports.ghostty_mouse_event_set_button(mouseEvent, mapButton(host, event.button))
  let mods = 0
  if (event.shiftKey) {
    mods |= 1
  }
  if (event.ctrlKey) {
    mods |= 2
  }
  if (event.altKey) {
    mods |= 4
  }
  if (event.metaKey) {
    mods |= 8
  }
  host.exports.ghostty_mouse_event_set_mods(mouseEvent, mods)
  host.exports.ghostty_mouse_event_set_position(
    mouseEvent,
    event.clientX - surface.left,
    event.clientY - surface.top
  )
  const buf = host.alloc(64)
  const outLen = host.alloc(4)
  const result = host.exports.ghostty_mouse_encoder_encode(encoder, mouseEvent, buf, 64, outLen)
  const n = host.readU32(outLen)
  const bytes =
    result === host.success && n > 0 ? host.bytes().slice(buf, buf + n) : new Uint8Array()
  host.free(outLen, 4)
  host.free(buf, 64)
  host.exports.ghostty_mouse_event_free(mouseEvent)
  host.exports.ghostty_mouse_encoder_free(encoder)
  return new TextDecoder().decode(bytes)
}

function mapButton(host: GhosttyVtHost, button: number): number {
  if (button === 0) {
    return host.enumValue('GhosttyMouseButton', 'LEFT')
  }
  if (button === 1) {
    return host.enumValue('GhosttyMouseButton', 'MIDDLE')
  }
  if (button === 2) {
    return host.enumValue('GhosttyMouseButton', 'RIGHT')
  }
  return host.enumValue('GhosttyMouseButton', 'UNKNOWN')
}
