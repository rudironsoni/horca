import type { GhosttyVtHost } from './wasm-host'

export function searchNext(host: GhosttyVtHost, term: number, needle: string): boolean {
  return runSearch(host, term, needle, 'SELECT_NEXT')
}

export function searchPrevious(host: GhosttyVtHost, term: number, needle: string): boolean {
  return runSearch(host, term, needle, 'SELECT_PREV')
}

function runSearch(
  host: GhosttyVtHost,
  term: number,
  needle: string,
  select: 'SELECT_NEXT' | 'SELECT_PREV'
): boolean {
  if (!needle) {
    return false
  }
  const slot = host.allocOpaque()
  host.check(host.exports.ghostty_search_new(0, term, slot), 'search_new')
  const search = host.takeOpaque(slot)
  host.freeOpaque(slot)
  const encoded = new TextEncoder().encode(needle)
  const written = host.writeBytes(encoded)
  const bufSize = host.structSize('GhosttyBuffer')
  const buf = host.alloc(bufSize)
  host.writeU32(buf, written.ptr)
  host.writeU32(buf + 4, written.len)
  host.writeU32(buf + 8, written.len)
  host.check(
    host.exports.ghostty_search_set(search, host.enumValue('GhosttySearchOption', 'NEEDLE'), buf),
    'search NEEDLE'
  )
  const one = host.alloc(1)
  host.bytes()[one] = 1
  host.check(
    host.exports.ghostty_search_set(search, host.enumValue('GhosttySearchOption', select), one),
    `search ${select}`
  )
  host.exports.ghostty_search_run(search)
  const matchesPtr = host.alloc(4)
  const got = host.exports.ghostty_search_get(
    search,
    host.enumValue('GhosttySearchData', 'TOTAL_MATCHES'),
    matchesPtr
  )
  const matches = got === host.success ? host.readU32(matchesPtr) : 0
  host.free(matchesPtr, 4)
  host.free(one, 1)
  host.free(buf, bufSize)
  host.free(written.ptr, written.len)
  host.exports.ghostty_search_free(search)
  return matches > 0
}
