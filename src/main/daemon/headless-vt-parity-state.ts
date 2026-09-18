import type { SavedCursorRegister } from '../../shared/terminal-serialize-absolute-cursor'
import type { HeadlessVtPiece } from './headless-vt-sequence-splitter'

export type HeadlessSgrState = {
  bold: boolean
  fg: number | null
  bg: number | null
}

export class HeadlessVtParityState {
  savedCursor: SavedCursorRegister | null = null
  originMode = false
  scrollTop = 0
  scrollBottom: number
  sgr: HeadlessSgrState = { bold: false, fg: null, bg: null }
  private kittyNormal = 0
  private kittyAlt = 0
  private altScreen = false
  private readonly rows: number

  constructor(rows: number) {
    this.rows = rows
    this.scrollBottom = rows - 1
  }

  get kittyKeyboardFlags(): number {
    return this.altScreen ? this.kittyAlt : this.kittyNormal
  }

  observe(piece: HeadlessVtPiece, cursor: { x: number; y: number }, altScreen: boolean): void {
    this.altScreen = altScreen
    if (piece.kind === 'esc') {
      if (piece.code === '7') {
        this.savedCursor = {
          x: cursor.x,
          y: cursor.y,
          originMode: this.originMode
        }
      }
      if (piece.code === 'c') this.reset()
      return
    }
    if (piece.kind !== 'csi') return
    if (piece.intermediates === '!' && piece.final === 'p') {
      this.setKitty(0)
      return
    }
    if (piece.prefix === '' && piece.final === 'm') {
      this.applySgr(piece.params)
      return
    }
    if (piece.prefix === '' && piece.final === 'r') {
      const top = (piece.params[0] ?? 1) - 1
      const bottom = (piece.params[1] ?? this.rows) - 1
      this.scrollTop = Math.max(0, top)
      this.scrollBottom = Math.min(this.rows - 1, bottom)
      return
    }
    if (piece.prefix === '?' && piece.final === 'h') {
      if (piece.params.includes(6)) this.originMode = true
      return
    }
    if (piece.prefix === '?' && piece.final === 'l') {
      if (piece.params.includes(6)) this.originMode = false
      return
    }
    if (piece.prefix === '>' && piece.final === 'u') {
      this.setKitty(piece.params[0] ?? 1)
      return
    }
    if (piece.prefix === '<' && piece.final === 'u') {
      this.setKitty(0)
      return
    }
    if (piece.prefix === '=' && piece.final === 'u') {
      this.setKitty(piece.params[0] ?? 0)
    }
  }

  private setKitty(value: number): void {
    if (this.altScreen) this.kittyAlt = value
    else this.kittyNormal = value
  }

  sgrSequence(): string {
    const { bold, fg, bg } = this.sgr
    if (!bold && fg === null && bg === null) return ''
    const params: number[] = []
    if (fg !== null) params.push(fg)
    if (bg !== null) params.push(bg)
    if (bold) params.push(1)
    return `\x1b[${params.join(';')}m`
  }

  private applySgr(params: number[]): void {
    if (params.length === 0) {
      this.sgr = { bold: false, fg: null, bg: null }
      return
    }
    for (let i = 0; i < params.length; i += 1) {
      const p = params[i] ?? 0
      if (p === 0) this.sgr = { bold: false, fg: null, bg: null }
      else if (p === 1) this.sgr.bold = true
      else if (p === 22) this.sgr.bold = false
      else if (p === 39) this.sgr.fg = null
      else if (p === 49) this.sgr.bg = null
      else if (p >= 30 && p <= 37) this.sgr.fg = p
      else if (p >= 40 && p <= 47) this.sgr.bg = p
      else if (p === 38 || p === 48) {
        const next = params[i + 1]
        if (next === 5) i += 2
        else if (next === 2) i += 4
      }
    }
  }

  private reset(): void {
    this.savedCursor = null
    this.originMode = false
    this.scrollTop = 0
    this.scrollBottom = this.rows - 1
    this.sgr = { bold: false, fg: null, bg: null }
    this.kittyNormal = 0
    this.kittyAlt = 0
    this.altScreen = false
  }
}
