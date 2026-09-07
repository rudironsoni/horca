import type { GhosttyVtHost } from './wasm-host'

export type GridCell = {
  chars: string
  width: number
  bold: boolean
  dim: boolean
  fgDefault: boolean
}

export type GridLine = {
  isWrapped: boolean
  cells: GridCell[]
}

const EMPTY_CELL: GridCell = {
  chars: '',
  width: 0,
  bold: false,
  dim: false,
  fgDefault: true
}

export function readGridLine(
  host: GhosttyVtHost,
  term: number,
  cols: number,
  row: number
): GridLine | undefined {
  const ref = locateGridRef(host, term, 0, row)
  if (ref === null) {
    return undefined
  }
  try {
    return {
      isWrapped: readRowFlag(host, ref, 'WRAP_CONTINUATION'),
      cells: Array.from({ length: cols }, (_, x) => readCellAt(host, term, x, row) ?? EMPTY_CELL)
    }
  } finally {
    host.free(ref, host.structSize('GhosttyGridRef'))
  }
}

function readCellAt(host: GhosttyVtHost, term: number, x: number, y: number): GridCell | undefined {
  const ref = locateGridRef(host, term, x, y)
  if (ref === null) {
    return undefined
  }
  try {
    const chars = readGraphemes(host, ref)
    const width = readCellWidth(host, ref)
    const style = readStyle(host, ref)
    return {
      chars,
      width,
      bold: style.bold,
      dim: style.dim,
      fgDefault: style.fgDefault
    }
  } finally {
    host.free(ref, host.structSize('GhosttyGridRef'))
  }
}

function locateGridRef(host: GhosttyVtHost, term: number, x: number, y: number): number | null {
  const pointSize = host.structSize('GhosttyPoint')
  const refSize = host.structSize('GhosttyGridRef')
  const point = host.alloc(pointSize)
  const ref = host.alloc(refSize)
  host.bytes().fill(0, point, point + pointSize)
  host.view().setInt32(point, host.enumValue('GhosttyPointTag', 'SCREEN'), true)
  host.view().setUint16(point + 8, x, true)
  host.view().setUint32(point + 12, y, true)
  host.bytes().fill(0, ref, ref + refSize)
  host.writeU32(ref, refSize)
  const located = host.exports.ghostty_terminal_grid_ref(term, point, ref)
  host.free(point, pointSize)
  if (located !== host.success) {
    host.free(ref, refSize)
    return null
  }
  return ref
}

function readRowFlag(host: GhosttyVtHost, ref: number, name: string): boolean {
  const row = host.alloc(8)
  const ok = host.exports.ghostty_grid_ref_row(ref, row)
  if (ok !== host.success) {
    host.free(row, 8)
    return false
  }
  const flag = host.alloc(1)
  const packed = host.view().getBigUint64(row, true)
  const result = host.exports.ghostty_row_get(packed, host.enumValue('GhosttyRowData', name), flag)
  const value = result === host.success && host.bytes()[flag] !== 0
  host.free(flag, 1)
  host.free(row, 8)
  return value
}

function readGraphemes(host: GhosttyVtHost, ref: number): string {
  const buf = host.alloc(32)
  const outLen = host.alloc(4)
  host.writeU32(outLen, 0)
  const read = host.exports.ghostty_grid_ref_graphemes(ref, buf, 32, outLen)
  if (read !== host.success) {
    host.free(buf, 32)
    host.free(outLen, 4)
    return ''
  }
  const len = host.readU32(outLen)
  const text = new TextDecoder().decode(host.bytes().subarray(buf, buf + len))
  host.free(buf, 32)
  host.free(outLen, 4)
  return text
}

function readCellWidth(host: GhosttyVtHost, ref: number): number {
  const cell = host.alloc(8)
  const ok = host.exports.ghostty_grid_ref_cell(ref, cell)
  if (ok !== host.success) {
    host.free(cell, 8)
    return 0
  }
  const out = host.alloc(4)
  const packed = host.view().getBigUint64(cell, true)
  const result = host.exports.ghostty_cell_get(
    packed,
    host.enumValue('GhosttyCellData', 'WIDE'),
    out
  )
  const wide = result === host.success ? host.view().getInt32(out, true) : 0
  host.free(out, 4)
  host.free(cell, 8)
  if (wide === host.enumValue('GhosttyCellWide', 'WIDE')) {
    return 2
  }
  if (wide === host.enumValue('GhosttyCellWide', 'NARROW')) {
    return 1
  }
  return 0
}

function readStyle(
  host: GhosttyVtHost,
  ref: number
): { bold: boolean; dim: boolean; fgDefault: boolean } {
  const size = host.structSize('GhosttyStyle')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  host.writeU32(ptr, size)
  const result = host.exports.ghostty_grid_ref_style(ref, ptr)
  if (result !== host.success) {
    host.free(ptr, size)
    return { bold: false, dim: false, fgDefault: true }
  }
  const bytes = host.bytes()
  const style = {
    bold: bytes[ptr + host.field('GhosttyStyle', 'bold').offset] !== 0,
    dim: bytes[ptr + host.field('GhosttyStyle', 'faint').offset] !== 0,
    fgDefault:
      host.view().getInt32(ptr + host.field('GhosttyStyle', 'fg_color').offset, true) ===
      host.enumValue('GhosttyStyleColorTag', 'NONE')
  }
  host.free(ptr, size)
  return style
}
