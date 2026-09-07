import type { GhosttyVtHost } from './wasm-host'

export function encodeNativeSnapshot(host: GhosttyVtHost, term: number): Uint8Array {
  const outSlot = host.allocOpaque()
  const outLen = host.alloc(4)
  host.check(
    host.exports.ghostty_snapshot_encode_alloc(term, 0, outSlot, outLen),
    'ghostty_snapshot_encode_alloc'
  )
  const ptr = host.takeOpaque(outSlot)
  const len = host.readU32(outLen)
  const bytes = host.bytes().slice(ptr, ptr + len)
  host.exports.ghostty_free(0, ptr, len)
  host.freeOpaque(outSlot)
  host.free(outLen, 4)
  return bytes
}

export function decodeNativeSnapshot(host: GhosttyVtHost, snapshot: Uint8Array): number {
  const buf = host.writeBytes(snapshot)
  const decoderSlot = host.allocOpaque()
  host.check(
    host.exports.ghostty_snapshot_decoder_new_buf(0, decoderSlot, buf.ptr, buf.len),
    'ghostty_snapshot_decoder_new_buf'
  )
  const decoder = host.takeOpaque(decoderSlot)
  const termSlot = host.allocOpaque()
  const decoded = host.exports.ghostty_snapshot_decoder_decode(decoder, termSlot)
  host.free(buf.ptr, buf.len)
  host.exports.ghostty_snapshot_decoder_free(decoder)
  host.freeOpaque(decoderSlot)
  host.check(decoded, 'ghostty_snapshot_decoder_decode')
  const term = host.takeOpaque(termSlot)
  host.freeOpaque(termSlot)
  return term
}
