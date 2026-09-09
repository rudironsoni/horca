import type { GhosttyVtHost } from './wasm-host'

const MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift', 'CapsLock'])

export function encodeBrowserKey(host: GhosttyVtHost, term: number, event: KeyboardEvent): string {
  const encoderSlot = host.allocOpaque()
  host.check(host.exports.ghostty_key_encoder_new(0, encoderSlot), 'key_encoder_new')
  const encoder = host.takeOpaque(encoderSlot)
  host.freeOpaque(encoderSlot)
  host.exports.ghostty_key_encoder_setopt_from_terminal(encoder, term)
  const eventSlot = host.allocOpaque()
  host.check(host.exports.ghostty_key_event_new(0, eventSlot), 'key_event_new')
  const keyEvent = host.takeOpaque(eventSlot)
  host.freeOpaque(eventSlot)
  const action = event.repeat ? 'REPEAT' : 'PRESS'
  host.exports.ghostty_key_event_set_action(keyEvent, host.enumValue('GhosttyKeyAction', action))
  host.exports.ghostty_key_event_set_key(keyEvent, mapKey(host, event.code))
  host.exports.ghostty_key_event_set_mods(keyEvent, packMods(event))
  let utf8: { ptr: number; len: number } | null = null
  if (event.key.length === 1) {
    utf8 = host.writeBytes(new TextEncoder().encode(event.key))
    host.exports.ghostty_key_event_set_utf8(keyEvent, utf8.ptr, utf8.len)
  }
  const encoded = encodeIntoBuffer(host, encoder, keyEvent)
  if (utf8) {
    host.free(utf8.ptr, utf8.len)
  }
  host.exports.ghostty_key_event_free(keyEvent)
  host.exports.ghostty_key_encoder_free(encoder)
  if (
    encoded.length === 0 &&
    !MODIFIER_KEYS.has(event.key) &&
    event.code !== '' &&
    !event.code.startsWith('Control') &&
    !event.code.startsWith('Shift') &&
    !event.code.startsWith('Alt') &&
    !event.code.startsWith('Meta')
  ) {
    console.warn('[orca-terminal] ghostty key encode empty', {
      key: event.key,
      code: event.code,
      ctrl: event.ctrlKey,
      alt: event.altKey,
      meta: event.metaKey,
      shift: event.shiftKey
    })
  }
  return encoded
}

function encodeIntoBuffer(host: GhosttyVtHost, encoder: number, keyEvent: number): string {
  let outSize = 128
  let out = host.alloc(outSize)
  const writtenPtr = host.alloc(4)
  host.writeU32(writtenPtr, 0)
  let result = host.exports.ghostty_key_encoder_encode(encoder, keyEvent, out, outSize, writtenPtr)
  let written = host.readU32(writtenPtr)
  const outOfSpace = host.enumValue('GhosttyResult', 'OUT_OF_SPACE')
  if (result === outOfSpace && written > outSize) {
    host.free(out, outSize)
    outSize = written
    out = host.alloc(outSize)
    host.writeU32(writtenPtr, 0)
    result = host.exports.ghostty_key_encoder_encode(encoder, keyEvent, out, outSize, writtenPtr)
    written = host.readU32(writtenPtr)
  }
  host.free(writtenPtr, 4)
  if (result !== host.success && result !== outOfSpace) {
    host.free(out, outSize)
    throw new Error(`key_encoder_encode failed: ${result}`)
  }
  const text =
    written > 0 ? new TextDecoder().decode(host.bytes().subarray(out, out + written)) : ''
  host.free(out, outSize)
  return text
}

function mapKey(host: GhosttyVtHost, code: string): number {
  const name = w3cCodeToGhosttyKeyName(code)
  const value = host.layout.types.GhosttyKey?.values?.[name]
  if (value === undefined) {
    return host.enumValue('GhosttyKey', 'UNIDENTIFIED')
  }
  return value
}

function w3cCodeToGhosttyKeyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3)
  }
  if (/^Digit[0-9]$/.test(code)) {
    return `DIGIT_${code.slice(5)}`
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return `NUMPAD_${code.slice(6)}`
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code
  }
  return code
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toUpperCase()
}

function packMods(event: KeyboardEvent): number {
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
  return mods
}
