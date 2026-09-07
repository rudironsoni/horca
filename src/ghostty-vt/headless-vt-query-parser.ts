import type { OrcaDisposable } from '../shared/orca-terminal-surface'

export type CsiHandlerId = { prefix?: string; final: string }
export type CsiHandler = (params: number[]) => boolean
export type OscHandler = (data: string) => boolean

const ESC = '\x1b'
const BEL = '\x07'
const ST = `${ESC}\\`

type CsiEntry = { id: CsiHandlerId; handler: CsiHandler }
type OscEntry = { ident: number; handler: OscHandler }

export class HeadlessVtQueryParser {
  private pending = ''
  private readonly csiHandlers: CsiEntry[] = []
  private readonly oscHandlers: OscEntry[] = []

  registerCsiHandler(id: CsiHandlerId, handler: CsiHandler): OrcaDisposable {
    const entry = { id, handler }
    this.csiHandlers.push(entry)
    return {
      dispose: () => {
        const at = this.csiHandlers.indexOf(entry)
        if (at !== -1) {
          this.csiHandlers.splice(at, 1)
        }
      }
    }
  }

  registerOscHandler(ident: number, handler: OscHandler): OrcaDisposable {
    const entry = { ident, handler }
    this.oscHandlers.push(entry)
    return {
      dispose: () => {
        const at = this.oscHandlers.indexOf(entry)
        if (at !== -1) {
          this.oscHandlers.splice(at, 1)
        }
      }
    }
  }

  consume(data: string): string {
    const input = this.pending + data
    this.pending = ''
    let output = ''
    let offset = 0
    while (offset < input.length) {
      const esc = input.indexOf(ESC, offset)
      if (esc === -1) {
        output += input.slice(offset)
        break
      }
      output += input.slice(offset, esc)
      const rest = input.slice(esc)
      if (rest === ESC || rest === `${ESC}[` || rest === `${ESC}]`) {
        this.pending = rest
        break
      }
      if (rest.startsWith(`${ESC}]`)) {
        const osc = takeOsc(rest)
        if (osc.kind === 'partial') {
          this.pending = rest
          break
        }
        if (osc.kind === 'match' && this.dispatchOsc(osc.ident, osc.body)) {
          offset = esc + osc.length
          continue
        }
        output += ESC
        offset = esc + 1
        continue
      }
      if (rest.startsWith(`${ESC}[`)) {
        const csi = takeCsi(rest)
        if (csi.kind === 'partial') {
          this.pending = rest
          break
        }
        if (csi.kind === 'match' && this.dispatchCsi(csi.prefix, csi.params, csi.final)) {
          offset = esc + csi.length
          continue
        }
        output += ESC
        offset = esc + 1
        continue
      }
      output += ESC
      offset = esc + 1
    }
    return output
  }

  private dispatchOsc(ident: number, body: string): boolean {
    for (let i = this.oscHandlers.length - 1; i >= 0; i -= 1) {
      const entry = this.oscHandlers[i]
      if (entry && entry.ident === ident && entry.handler(body)) {
        return true
      }
    }
    return false
  }

  private dispatchCsi(prefix: string, params: number[], final: string): boolean {
    for (let i = this.csiHandlers.length - 1; i >= 0; i -= 1) {
      const entry = this.csiHandlers[i]
      if (!entry || entry.id.final !== final) {
        continue
      }
      if ((entry.id.prefix ?? '') !== prefix) {
        continue
      }
      if (entry.handler(params)) {
        return true
      }
    }
    return false
  }
}

function takeOsc(
  rest: string
):
  | { kind: 'partial' }
  | { kind: 'none' }
  | { kind: 'match'; ident: number; body: string; length: number } {
  const payload = rest.slice(2)
  const bel = payload.indexOf(BEL)
  const st = payload.indexOf(ST)
  let end = -1
  let termLen = 0
  if (bel !== -1 && (st === -1 || bel < st)) {
    end = bel
    termLen = BEL.length
  } else if (st !== -1) {
    end = st
    termLen = ST.length
  }
  if (end === -1) {
    return { kind: 'partial' }
  }
  const raw = payload.slice(0, end)
  const sep = raw.indexOf(';')
  const identText = sep === -1 ? raw : raw.slice(0, sep)
  if (!/^\d+$/.test(identText)) {
    return { kind: 'none' }
  }
  return {
    kind: 'match',
    ident: Number.parseInt(identText, 10),
    body: sep === -1 ? '' : raw.slice(sep + 1),
    length: 2 + end + termLen
  }
}

function takeCsi(
  rest: string
):
  | { kind: 'partial' }
  | { kind: 'none' }
  | { kind: 'match'; prefix: string; params: number[]; final: string; length: number } {
  let i = 2
  let prefix = ''
  if (i < rest.length && '<=>?'.includes(rest[i] ?? '')) {
    prefix = rest[i] ?? ''
    i += 1
  }
  const start = i
  while (i < rest.length) {
    const code = rest.charCodeAt(i)
    if (code >= 0x40 && code <= 0x7e) {
      const paramText = rest.slice(start, i)
      const params =
        paramText.length === 0
          ? []
          : paramText.split(';').map((part) => (part === '' ? 0 : Number.parseInt(part, 10)))
      if (params.some((value) => Number.isNaN(value))) {
        return { kind: 'none' }
      }
      return { kind: 'match', prefix, params, final: rest[i] ?? '', length: i + 1 }
    }
    i += 1
  }
  return { kind: 'partial' }
}
