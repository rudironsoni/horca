import type { GhosttyVtHost } from './wasm-host'

export function selectAllOnTerminal(host: GhosttyVtHost, term: number): void {
  const size = host.structSize('GhosttySelection')
  const sel = host.alloc(size)
  host.bytes().fill(0, sel, sel + size)
  const result = host.exports.ghostty_terminal_select_all(term, sel)
  if (result === host.enumValue('GhosttyResult', 'NO_VALUE')) {
    host.free(sel, size)
    return
  }
  host.check(result, 'select_all')
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'SELECTION'),
      sel
    ),
    'set SELECTION'
  )
  host.free(sel, size)
}

export function readSelection(host: GhosttyVtHost, term: number): string {
  const optSize = host.structSize('GhosttyTerminalSelectionFormatOptions')
  const opts = host.alloc(optSize)
  host.bytes().fill(0, opts, opts + optSize)
  host.writeU32(opts, optSize)
  const buf = host.alloc(4096)
  const written = host.alloc(4)
  const result = host.exports.ghostty_terminal_selection_format_buf(term, opts, buf, 4096, written)
  const n = host.readU32(written)
  const text =
    result === host.success ? new TextDecoder().decode(host.bytes().subarray(buf, buf + n)) : ''
  host.free(written, 4)
  host.free(buf, 4096)
  host.free(opts, optSize)
  if (result !== host.success && result !== host.enumValue('GhosttyResult', 'NO_VALUE')) {
    throw new Error(`selection_format_buf failed: ${result}`)
  }
  return text
}

export function clearSelectionOnTerminal(host: GhosttyVtHost, term: number): void {
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'SELECTION'),
      0
    ),
    'clear SELECTION'
  )
}
