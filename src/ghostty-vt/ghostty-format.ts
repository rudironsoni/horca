import type { GhosttyVtHost } from './wasm-host'

export type FormatterEmit = 'PLAIN' | 'VT'

export function formatTerminal(
  host: GhosttyVtHost,
  term: number,
  emit: FormatterEmit,
  options?: { trim?: boolean; extras?: boolean }
): string {
  const optsSize = host.structSize('GhosttyFormatterTerminalOptions')
  const extraSize = host.structSize('GhosttyFormatterTerminalExtra')
  const screenSize = host.structSize('GhosttyFormatterScreenExtra')
  const opts = host.alloc(optsSize)
  host.bytes().fill(0, opts, opts + optsSize)
  const view = new DataView(host.exports.memory.buffer, opts, optsSize)
  view.setUint32(0, optsSize, true)
  view.setInt32(4, host.enumValue('GhosttyFormatterFormat', emit), true)
  view.setUint8(8, 0)
  view.setUint8(9, options?.trim === false ? 0 : 1)
  const extraOffset = 12
  view.setUint32(extraOffset, extraSize, true)
  view.setUint32(extraOffset + 12, screenSize, true)
  if (options?.extras) {
    view.setUint8(extraOffset + 4, 1)
    view.setUint8(extraOffset + 5, 1)
    view.setUint8(extraOffset + 9, 1)
    view.setUint8(extraOffset + 16, 1)
    view.setUint8(extraOffset + 17, 1)
  }
  const fmtSlot = host.allocOpaque()
  const created = host.exports.ghostty_formatter_terminal_new(0, fmtSlot, term, opts)
  host.free(opts, optsSize)
  host.check(created, 'ghostty_formatter_terminal_new')
  const formatter = host.takeOpaque(fmtSlot)
  const outSlot = host.allocOpaque()
  const outLen = host.alloc(4)
  const formatted = host.exports.ghostty_formatter_format_alloc(formatter, 0, outSlot, outLen)
  host.check(formatted, 'ghostty_formatter_format_alloc')
  const outPtr = host.takeOpaque(outSlot)
  const len = host.readU32(outLen)
  const text = new TextDecoder().decode(host.bytes().subarray(outPtr, outPtr + len))
  host.exports.ghostty_free(0, outPtr, len)
  host.freeOpaque(outSlot)
  host.free(outLen, 4)
  host.exports.ghostty_formatter_free(formatter)
  host.freeOpaque(fmtSlot)
  return text
}
