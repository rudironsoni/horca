import type { GhosttyVtHost } from './wasm-host'

export function encodePaste(host: GhosttyVtHost, text: string, bracketed: boolean): string {
  if (!text) {
    return ''
  }
  const bytes = new TextEncoder().encode(text)
  const data = host.writeBytes(bytes)
  let capacity = Math.max(64, bytes.length + 16)
  try {
    for (;;) {
      const buf = host.alloc(capacity)
      const out = host.alloc(4)
      const result = host.exports.ghostty_paste_encode(
        data.ptr,
        data.len,
        bracketed ? 1 : 0,
        buf,
        capacity,
        out
      )
      const written = host.readU32(out)
      host.free(out, 4)
      if (result === host.success) {
        const encoded = new TextDecoder().decode(host.bytes().subarray(buf, buf + written))
        host.free(buf, capacity)
        return encoded
      }
      host.free(buf, capacity)
      if (result === host.enumValue('GhosttyResult', 'OUT_OF_SPACE') && written > capacity) {
        capacity = written
        continue
      }
      throw new Error(`paste_encode failed: ${result}`)
    }
  } finally {
    host.free(data.ptr, data.len)
  }
}
