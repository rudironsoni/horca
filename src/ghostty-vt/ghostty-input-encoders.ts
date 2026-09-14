import type { GhosttyVtHost } from './wasm-host'

type HeldInputEncoders = {
  keyEncoder: number
  keyEvent: number
  mouseEncoder: number
  mouseEvent: number
}

const encoders = new WeakMap<object, HeldInputEncoders>()

export function heldGhosttyInputEncoders(
  engine: object,
  host: GhosttyVtHost,
  term: number
): HeldInputEncoders {
  const existing = encoders.get(engine)
  if (existing) {
    host.exports.ghostty_key_encoder_setopt_from_terminal(existing.keyEncoder, term)
    host.exports.ghostty_mouse_encoder_setopt_from_terminal(existing.mouseEncoder, term)
    return existing
  }
  const keySlot = host.allocOpaque()
  host.check(host.exports.ghostty_key_encoder_new(0, keySlot), 'key_encoder_new')
  const keyEncoder = host.takeOpaque(keySlot)
  host.freeOpaque(keySlot)
  const keyEventSlot = host.allocOpaque()
  host.check(host.exports.ghostty_key_event_new(0, keyEventSlot), 'key_event_new')
  const keyEvent = host.takeOpaque(keyEventSlot)
  host.freeOpaque(keyEventSlot)
  const mouseSlot = host.allocOpaque()
  host.check(host.exports.ghostty_mouse_encoder_new(0, mouseSlot), 'mouse_encoder_new')
  const mouseEncoder = host.takeOpaque(mouseSlot)
  host.freeOpaque(mouseSlot)
  const mouseEventSlot = host.allocOpaque()
  host.check(host.exports.ghostty_mouse_event_new(0, mouseEventSlot), 'mouse_event_new')
  const mouseEvent = host.takeOpaque(mouseEventSlot)
  host.freeOpaque(mouseEventSlot)
  host.exports.ghostty_key_encoder_setopt_from_terminal(keyEncoder, term)
  host.exports.ghostty_mouse_encoder_setopt_from_terminal(mouseEncoder, term)
  const held = { keyEncoder, keyEvent, mouseEncoder, mouseEvent }
  encoders.set(engine, held)
  return held
}

export function releaseGhosttyInputEncoders(engine: object, host: GhosttyVtHost): void {
  const held = encoders.get(engine)
  if (!held) {
    return
  }
  host.exports.ghostty_key_event_free(held.keyEvent)
  host.exports.ghostty_key_encoder_free(held.keyEncoder)
  host.exports.ghostty_mouse_event_free(held.mouseEvent)
  host.exports.ghostty_mouse_encoder_free(held.mouseEncoder)
  encoders.delete(engine)
}
