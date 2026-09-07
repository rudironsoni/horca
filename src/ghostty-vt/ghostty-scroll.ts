import type { GhosttyVtHost } from './wasm-host'

export type GhosttyScrollbar = {
  total: number
  offset: number
  len: number
}

export function readScrollbar(host: GhosttyVtHost, term: number): GhosttyScrollbar {
  const size = host.structSize('GhosttyTerminalScrollbar')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  host.check(
    host.exports.ghostty_terminal_get(
      term,
      host.enumValue('GhosttyTerminalData', 'SCROLLBAR'),
      ptr
    ),
    'SCROLLBAR'
  )
  const view = host.view()
  const scrollbar = {
    total: Number(view.getBigUint64(ptr, true)),
    offset: Number(view.getBigUint64(ptr + 8, true)),
    len: Number(view.getBigUint64(ptr + 16, true))
  }
  host.free(ptr, size)
  return scrollbar
}

export function scrollViewport(
  host: GhosttyVtHost,
  term: number,
  tag: 'TOP' | 'BOTTOM' | 'DELTA' | 'ROW',
  value = 0
): void {
  const size = host.structSize('GhosttyTerminalScrollViewport')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  host.view().setInt32(ptr, host.enumValue('GhosttyTerminalScrollViewportTag', tag), true)
  if (tag === 'DELTA') {
    host.view().setInt32(ptr + 8, value, true)
  } else if (tag === 'ROW') {
    host.view().setUint32(ptr + 8, value, true)
  }
  // ABI is void; wasm32 returns undefined, not GhosttyResult.
  host.exports.ghostty_terminal_scroll_viewport(term, ptr)
  host.free(ptr, size)
}
