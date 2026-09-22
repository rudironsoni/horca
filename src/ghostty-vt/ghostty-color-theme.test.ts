import { afterEach, describe, expect, it } from 'vitest'
import type { ITheme } from '../shared/orca-terminal-surface'
import { GhosttyTerminal } from './ghostty-terminal'
import { ghosttyVt } from './ghostty-vt-access'
import {
  applyGhosttyColorTheme,
  applyGhosttyViewAttributes,
  parseCssColorToRgb,
  readGhosttyPalette,
  readGhosttyRgb,
  rgbToCss
} from './ghostty-color-theme'
import { getGhosttyVtHostOrThrow } from './host-singleton'
import { primeGhosttyVtHostForTests } from './prime-host-for-tests'

primeGhosttyVtHostForTests()
import type { ThemeRgb } from './ghostty-css-color'

const SOLARIZED_LIGHT: ITheme = {
  background: '#fdf6e3',
  foreground: '#657b83',
  cursor: '#586e75',
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#002b36',
  brightRed: '#cb4b16',
  brightGreen: '#586e75',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#93a1a1',
  brightWhite: '#fdf6e3'
}

const SOLARIZED_BG: ThemeRgb = [253, 246, 227]
const SOLARIZED_RED: ThemeRgb = [220, 50, 47]

describe('ghostty CSS color parsing', () => {
  it('parses hex and rgba theme slots', () => {
    expect(parseCssColorToRgb('#fdf6e3')?.rgb).toEqual(SOLARIZED_BG)
    expect(parseCssColorToRgb('#dc322f')?.rgb).toEqual(SOLARIZED_RED)
    expect(parseCssColorToRgb('rgba(253, 246, 227, 0.5)')).toEqual({
      rgb: SOLARIZED_BG,
      alpha: 0.5
    })
    expect(rgbToCss(SOLARIZED_BG)).toBe('rgb(253 246 227)')
  })
})

describe('applyGhosttyColorTheme', () => {
  let terminal: GhosttyTerminal | undefined

  afterEach(() => {
    terminal?.dispose()
    terminal = undefined
  })

  it('writes Solarized light defaults and ANSI red into Ghostty', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 40, rows: 8 })
    const unthemedRed = readGhosttyPalette(terminal)[1]
    applyGhosttyColorTheme(terminal, SOLARIZED_LIGHT)
    expect(readGhosttyRgb(terminal, 'COLOR_BACKGROUND_DEFAULT')).toEqual(SOLARIZED_BG)
    expect(readGhosttyPalette(terminal, 'COLOR_PALETTE_DEFAULT')[1]).toEqual(SOLARIZED_RED)
    expect(readGhosttyPalette(terminal)[1]).toEqual(SOLARIZED_RED)
    expect(unthemedRed).not.toEqual(SOLARIZED_RED)
    terminal.writePtyOutput('\x1b[31mX')
    expect(readFirstCellFg(terminal)).toEqual(SOLARIZED_RED)
  })

  it('keeps an OSC 11 override after a later default-theme write', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 40, rows: 8 })
    applyGhosttyColorTheme(terminal, SOLARIZED_LIGHT)
    terminal.writePtyOutput('\x1b]11;#112233\x07')
    expect(readGhosttyRgb(terminal, 'COLOR_BACKGROUND')).toEqual([17, 34, 51])
    applyGhosttyColorTheme(terminal, {
      ...SOLARIZED_LIGHT,
      background: '#000000'
    })
    expect(readGhosttyRgb(terminal, 'COLOR_BACKGROUND')).toEqual([17, 34, 51])
    expect(readGhosttyRgb(terminal, 'COLOR_BACKGROUND_DEFAULT')).toEqual([0, 0, 0])
  })

  it('applies view-attribute RGB snapshots the same way as ITheme', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    applyGhosttyViewAttributes(terminal, {
      foreground: [10, 20, 30],
      background: [40, 50, 60],
      cursor: [70, 80, 90],
      ansi: Array.from({ length: 256 }, (_, i) =>
        i === 1 ? SOLARIZED_RED : ([0, 0, 0] as ThemeRgb)
      ),
      colorSchemeMode: 'light',
      cursorStyle: 'bar',
      cursorBlink: false
    })
    expect(readGhosttyRgb(terminal, 'COLOR_BACKGROUND_DEFAULT')).toEqual([40, 50, 60])
    expect(readGhosttyPalette(terminal)[1]).toEqual(SOLARIZED_RED)
  })
})

function readFirstCellFg(terminal: GhosttyTerminal): ThemeRgb | null {
  const { host, term } = ghosttyVt(terminal)
  const stateSlot = host.allocOpaque()
  host.check(host.exports.ghostty_render_state_new(0, stateSlot), 'render_state_new')
  const state = host.takeOpaque(stateSlot)
  host.freeOpaque(stateSlot)
  host.check(host.exports.ghostty_render_state_update(state, term), 'render_state_update')
  const rowSlot = host.allocOpaque()
  host.check(host.exports.ghostty_render_state_row_iterator_new(0, rowSlot), 'row_iterator_new')
  let iter = host.takeOpaque(rowSlot)
  host.freeOpaque(rowSlot)
  const iterPtr = host.alloc(4)
  host.writeU32(iterPtr, iter)
  host.check(
    host.exports.ghostty_render_state_get(
      state,
      host.enumValue('GhosttyRenderStateData', 'ROW_ITERATOR'),
      iterPtr
    ),
    'ROW_ITERATOR'
  )
  iter = host.readU32(iterPtr)
  host.free(iterPtr, 4)
  if (!host.exports.ghostty_render_state_row_iterator_next(iter)) {
    host.exports.ghostty_render_state_row_iterator_free(iter)
    host.exports.ghostty_render_state_free(state)
    return null
  }
  const cellsSlot = host.allocOpaque()
  host.check(host.exports.ghostty_render_state_row_cells_new(0, cellsSlot), 'row_cells_new')
  let cells = host.takeOpaque(cellsSlot)
  host.freeOpaque(cellsSlot)
  const cellsPtr = host.alloc(4)
  host.writeU32(cellsPtr, cells)
  host.check(
    host.exports.ghostty_render_state_row_get(
      iter,
      host.enumValue('GhosttyRenderStateRowData', 'CELLS'),
      cellsPtr
    ),
    'ROW CELLS'
  )
  cells = host.readU32(cellsPtr)
  host.free(cellsPtr, 4)
  if (!host.exports.ghostty_render_state_row_cells_next(cells)) {
    host.exports.ghostty_render_state_row_cells_free(cells)
    host.exports.ghostty_render_state_row_iterator_free(iter)
    host.exports.ghostty_render_state_free(state)
    return null
  }
  const rgbPtr = host.alloc(3)
  const rgbResult = host.exports.ghostty_render_state_row_cells_get(
    cells,
    host.enumValue('GhosttyRenderStateRowCellsData', 'FG_COLOR'),
    rgbPtr
  )
  let rgb: ThemeRgb | null = null
  if (rgbResult === host.success) {
    rgb = [host.bytes()[rgbPtr] ?? 0, host.bytes()[rgbPtr + 1] ?? 0, host.bytes()[rgbPtr + 2] ?? 0]
  } else {
    const styleSize = host.structSize('GhosttyStyle')
    const stylePtr = host.alloc(styleSize)
    host.bytes().fill(0, stylePtr, stylePtr + styleSize)
    host.writeU32(stylePtr, styleSize)
    const styleResult = host.exports.ghostty_render_state_row_cells_get(
      cells,
      host.enumValue('GhosttyRenderStateRowCellsData', 'STYLE'),
      stylePtr
    )
    if (styleResult === host.success) {
      const tag = host
        .view()
        .getInt32(stylePtr + host.field('GhosttyStyle', 'fg_color').offset, true)
      if (tag === host.enumValue('GhosttyStyleColorTag', 'PALETTE')) {
        const index =
          host.bytes()[
            stylePtr +
              host.field('GhosttyStyle', 'fg_color').offset +
              host.field('GhosttyStyleColor', 'value').offset
          ] ?? 0
        rgb = readGhosttyPalette(terminal)[index] ?? null
      }
    }
    host.free(stylePtr, styleSize)
  }
  host.free(rgbPtr, 3)
  host.exports.ghostty_render_state_row_cells_free(cells)
  host.exports.ghostty_render_state_row_iterator_free(iter)
  host.exports.ghostty_render_state_free(state)
  return rgb
}
