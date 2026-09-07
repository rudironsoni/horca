import type { GhosttyVtHost } from './wasm-host'

const CODE_ALIASES: Record<string, string> = {
  Backquote: 'BACKQUOTE',
  Backslash: 'BACKSLASH',
  BracketLeft: 'BRACKET_LEFT',
  BracketRight: 'BRACKET_RIGHT',
  Comma: 'COMMA',
  Equal: 'EQUAL',
  Minus: 'MINUS',
  Period: 'PERIOD',
  Quote: 'QUOTE',
  Semicolon: 'SEMICOLON',
  Slash: 'SLASH',
  Backspace: 'BACKSPACE',
  Enter: 'ENTER',
  Space: 'SPACE',
  Tab: 'TAB',
  Escape: 'ESCAPE',
  Delete: 'DELETE',
  End: 'END',
  Home: 'HOME',
  Insert: 'INSERT',
  PageDown: 'PAGE_DOWN',
  PageUp: 'PAGE_UP',
  ArrowDown: 'ARROW_DOWN',
  ArrowLeft: 'ARROW_LEFT',
  ArrowRight: 'ARROW_RIGHT',
  ArrowUp: 'ARROW_UP'
}

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
  const action = event.type === 'keyup' ? 'RELEASE' : event.repeat ? 'REPEAT' : 'PRESS'
  host.exports.ghostty_key_event_set_action(keyEvent, host.enumValue('GhosttyKeyAction', action))
  host.exports.ghostty_key_event_set_key(keyEvent, mapKey(host, event.code))
  host.exports.ghostty_key_event_set_mods(keyEvent, packMods(event))
  if (event.key.length === 1) {
    const utf8 = host.writeBytes(new TextEncoder().encode(event.key))
    host.exports.ghostty_key_event_set_utf8(keyEvent, utf8.ptr, utf8.len)
    host.free(utf8.ptr, utf8.len)
  }
  const outSize = 64
  const out = host.alloc(outSize)
  const written = host.exports.ghostty_key_encoder_encode(encoder, keyEvent, out, outSize)
  const bytes = written > 0 ? host.bytes().slice(out, out + written) : new Uint8Array()
  host.free(out, outSize)
  host.exports.ghostty_key_event_free(keyEvent)
  host.exports.ghostty_key_encoder_free(encoder)
  return new TextDecoder().decode(bytes)
}

function mapKey(host: GhosttyVtHost, code: string): number {
  const alias = CODE_ALIASES[code]
  if (alias) {
    return host.enumValue('GhosttyKey', alias)
  }
  if (/^Key[A-Z]$/.test(code)) {
    return host.enumValue('GhosttyKey', code.slice(3))
  }
  if (/^Digit[0-9]$/.test(code)) {
    return host.enumValue('GhosttyKey', `DIGIT_${code.slice(5)}`)
  }
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return host.enumValue('GhosttyKey', code)
  }
  if (/^Numpad[0-9]$/.test(code)) {
    return host.enumValue('GhosttyKey', `NUMPAD_${code.slice(6)}`)
  }
  return host.enumValue('GhosttyKey', 'UNIDENTIFIED')
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
