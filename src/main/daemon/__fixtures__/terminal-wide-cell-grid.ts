/**
 * A cell-level model of a terminal grid in which one glyph can occupy two cells.
 */

/** Code points that occupy two console cells: Hangul, CJK ideographs, kana, fullwidth forms. */
const WIDE = /[ᄀ-ᅟ⺀-鿿가-힣豈-﫿︰-﹏！-｠￠-￦]/

export function isWideGlyph(ch: string): boolean {
  return WIDE.test(ch)
}

/** `null` marks a wide glyph's trailing cell, which renders as nothing. */
type Cell = string | null

export class WideCellGrid {
  private readonly rows: Cell[][] = []
  private row = 0
  private col = 0

  constructor(private readonly cols: number) {}

  private at(row: number): Cell[] {
    while (this.rows.length <= row) {
      this.rows.push(Array.from<Cell>({ length: this.cols }).fill(' '))
    }
    return this.rows[row]!
  }

  /** Clears whichever half-pair covers `col`, so no orphaned half is ever left behind. */
  private clearPair(row: number, col: number): void {
    if (col < 0 || col >= this.cols) {
      return
    }
    const cells = this.at(row)
    if (cells[col] === null) {
      cells[col] = ' '
      if (col > 0) {
        cells[col - 1] = ' '
      }
      return
    }
    if (col + 1 < this.cols && cells[col + 1] === null) {
      cells[col] = ' '
      cells[col + 1] = ' '
    }
  }

  moveTo(row: number, col: number): void {
    this.row = row
    this.col = col
  }

  carriageReturn(): void {
    this.col = 0
  }

  lineFeed(): void {
    this.row += 1
  }

  eraseToLineEnd(): void {
    this.clearPair(this.row, this.col)
    const cells = this.at(this.row)
    for (let col = this.col; col < this.cols; col += 1) {
      cells[col] = ' '
    }
  }

  eraseLine(): void {
    this.rows[this.row] = Array.from<Cell>({ length: this.cols }).fill(' ')
  }

  text(value: string): void {
    for (const ch of value) {
      if (ch === '\r') {
        this.carriageReturn()
        continue
      }
      if (ch === '\n') {
        this.lineFeed()
        continue
      }
      const width = isWideGlyph(ch) ? 2 : 1
      if (this.col + width > this.cols) {
        const cells = this.at(this.row)
        for (let col = this.col; col < this.cols; col += 1) {
          this.clearPair(this.row, col)
          cells[col] = ' '
        }
        this.row += 1
        this.col = 0
      }
      this.clearPair(this.row, this.col)
      if (width === 2) {
        this.clearPair(this.row, this.col + 1)
      }
      const cells = this.at(this.row)
      cells[this.col] = ch
      if (width === 2) {
        cells[this.col + 1] = null
      }
      this.col += width
    }
  }

  render(rowCount: number): string[] {
    const out: string[] = []
    for (let row = 0; row < rowCount; row += 1) {
      const cells = this.rows[row]
      out.push(
        cells
          ? cells
              .map((cell) => cell ?? '')
              .join('')
              .replace(/\s+$/, '')
          : ''
      )
    }
    return out
  }
}

export function readGridRows(source: { getVisibleLines(): string[] }): string[] {
  return source.getVisibleLines().map((line) => line.replace(/\s+$/, ''))
}

export function readWrappedLineGlyphs(source: { getVisibleLines(): string[] }): string[] {
  return source.getVisibleLines().map((line) => line.replace(/\s+/g, ''))
}
