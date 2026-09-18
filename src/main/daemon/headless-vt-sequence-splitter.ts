const ESC = '\x1b'

export type HeadlessVtPiece =
  | { kind: 'text'; text: string }
  | { kind: 'esc'; text: string; code: string }
  | {
      kind: 'csi'
      text: string
      prefix: string
      intermediates: string
      params: number[]
      final: string
    }

export class HeadlessVtSequenceSplitter {
  private pending = ''

  push(data: string): HeadlessVtPiece[] {
    const input = this.pending + data
    this.pending = ''
    const pieces: HeadlessVtPiece[] = []
    let offset = 0
    while (offset < input.length) {
      const esc = input.indexOf(ESC, offset)
      if (esc === -1) {
        pieces.push({ kind: 'text', text: input.slice(offset) })
        break
      }
      if (esc > offset) {
        pieces.push({ kind: 'text', text: input.slice(offset, esc) })
      }
      const rest = input.slice(esc)
      if (rest.length === 1) {
        this.pending = rest
        break
      }
      const next = rest[1] ?? ''
      if (next === '[') {
        const csi = takeCsi(rest)
        if (csi.kind === 'partial') {
          this.pending = rest
          break
        }
        if (csi.kind === 'none') {
          pieces.push({ kind: 'text', text: ESC })
          offset = esc + 1
          continue
        }
        pieces.push({
          kind: 'csi',
          text: rest.slice(0, csi.length),
          prefix: csi.prefix,
          intermediates: csi.intermediates,
          params: csi.params,
          final: csi.final
        })
        offset = esc + csi.length
        continue
      }
      if (next === ']' ) {
        const osc = takeOscEnd(rest)
        if (osc === 'partial') {
          this.pending = rest
          break
        }
        pieces.push({ kind: 'text', text: rest.slice(0, osc) })
        offset = esc + osc
        continue
      }
      pieces.push({ kind: 'esc', text: rest.slice(0, 2), code: next })
      offset = esc + 2
    }
    return pieces
  }
}

function takeOscEnd(rest: string): number | 'partial' {
  const payload = rest.slice(2)
  const bel = payload.indexOf('\x07')
  const st = payload.indexOf(`${ESC}\\`)
  if (bel === -1 && st === -1) return 'partial'
  if (bel !== -1 && (st === -1 || bel < st)) return 2 + bel + 1
  return 2 + st + 2
}

function takeCsi(
  rest: string
):
  | { kind: 'partial' }
  | { kind: 'none' }
  | {
      kind: 'match'
      prefix: string
      intermediates: string
      params: number[]
      final: string
      length: number
    } {
  let i = 2
  let prefix = ''
  if (i < rest.length && '<=>?'.includes(rest[i] ?? '')) {
    prefix = rest[i] ?? ''
    i += 1
  }
  const paramStart = i
  while (i < rest.length) {
    const code = rest.charCodeAt(i)
    if (code >= 0x20 && code <= 0x2f) break
    if (code >= 0x40 && code <= 0x7e) break
    i += 1
  }
  const intermediateStart = i
  while (i < rest.length) {
    const code = rest.charCodeAt(i)
    if (code >= 0x20 && code <= 0x2f) {
      i += 1
      continue
    }
    break
  }
  if (i >= rest.length) return { kind: 'partial' }
  const finalCode = rest.charCodeAt(i)
  if (finalCode < 0x40 || finalCode > 0x7e) return { kind: 'none' }
  const paramText = rest.slice(paramStart, intermediateStart)
  const params =
    paramText.length === 0
      ? []
      : paramText.split(';').map((part) => (part === '' ? 0 : Number.parseInt(part, 10)))
  if (params.some((value) => Number.isNaN(value))) return { kind: 'none' }
  return {
    kind: 'match',
    prefix,
    intermediates: rest.slice(intermediateStart, i),
    params,
    final: rest[i] ?? '',
    length: i + 1
  }
}
