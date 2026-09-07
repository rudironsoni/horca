import type { GhosttyVtHost } from './wasm-host'

export type HyperlinkRange = {
  row: number
  startCol: number
  endCol: number
  uri: string
}

export function collectHyperlinkRanges(
  host: GhosttyVtHost,
  term: number,
  cols: number,
  rows: number
): HyperlinkRange[] {
  const ranges: HyperlinkRange[] = []
  const pointSize = host.structSize('GhosttyPoint')
  const refSize = host.structSize('GhosttyGridRef')
  const point = host.alloc(pointSize)
  const ref = host.alloc(refSize)
  const uriBuf = host.alloc(1024)
  const outLen = host.alloc(4)
  const screen = host.enumValue('GhosttyPointTag', 'SCREEN')
  try {
    for (let y = 0; y < rows; y += 1) {
      let currentUri = ''
      let startCol = -1
      for (let x = 0; x <= cols; x += 1) {
        const uri = x < cols ? readUri(host, term, point, ref, uriBuf, outLen, screen, x, y) : ''
        if (uri === currentUri) {
          continue
        }
        if (currentUri && startCol >= 0) {
          ranges.push({ row: y, startCol, endCol: x, uri: currentUri })
        }
        currentUri = uri
        startCol = uri ? x : -1
      }
    }
  } finally {
    host.free(point, pointSize)
    host.free(ref, refSize)
    host.free(uriBuf, 1024)
    host.free(outLen, 4)
  }
  return ranges
}

function readUri(
  host: GhosttyVtHost,
  term: number,
  point: number,
  ref: number,
  uriBuf: number,
  outLen: number,
  tag: number,
  x: number,
  y: number
): string {
  host.bytes().fill(0, point, point + host.structSize('GhosttyPoint'))
  host.view().setInt32(point, tag, true)
  host.view().setUint16(point + 8, x, true)
  host.view().setUint32(point + 12, y, true)
  host.bytes().fill(0, ref, ref + host.structSize('GhosttyGridRef'))
  host.writeU32(ref, host.structSize('GhosttyGridRef'))
  const located = host.exports.ghostty_terminal_grid_ref(term, point, ref)
  if (located !== host.success) {
    return ''
  }
  host.writeU32(outLen, 0)
  const read = host.exports.ghostty_grid_ref_hyperlink_uri(ref, uriBuf, 1024, outLen)
  if (read !== host.success) {
    return ''
  }
  const len = host.readU32(outLen)
  if (len === 0) {
    return ''
  }
  return new TextDecoder().decode(host.bytes().subarray(uriBuf, uriBuf + len))
}
