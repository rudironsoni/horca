import type { ITheme } from '../shared/orca-terminal-surface'
import type { TerminalViewAttributes } from '../shared/terminal-view-attributes'
import type { GhosttyTerminal } from './ghostty-terminal'
import { ghosttyVt } from './ghostty-vt-access'
import type { GhosttyVtHost } from './wasm-host'
import { parseCssColorToRgb, type ParsedThemeColor, type ThemeRgb } from './ghostty-css-color'

export type { ParsedThemeColor, ThemeRgb } from './ghostty-css-color'
export { parseCssColorToRgb, rgbToCss } from './ghostty-css-color'

export type GhosttyRgbTheme = {
  foreground: ThemeRgb
  background: ThemeRgb
  cursor?: ThemeRgb
  ansi?: ThemeRgb[]
}

const THEME_ANSI_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const satisfies readonly (keyof ITheme)[]

const PALETTE_BYTES = 256 * 3
const ANSI_COUNT = 16

export function applyGhosttyColorTheme(engine: GhosttyTerminal, theme: ITheme): ParsedThemeColor {
  const parsed = rgbThemeFromITheme(theme)
  applyGhosttyRgbTheme(engine, parsed.theme)
  return parsed.background
}

export function applyGhosttyViewAttributes(
  engine: GhosttyTerminal,
  attributes: TerminalViewAttributes
): void {
  applyGhosttyRgbTheme(engine, {
    foreground: attributes.foreground,
    background: attributes.background,
    cursor: attributes.cursor,
    ansi: attributes.ansi
  })
  applyGhosttyCursorDefaults(engine, attributes.cursorStyle, attributes.cursorBlink)
}

export function applyGhosttyCursorDefaults(
  engine: GhosttyTerminal,
  style: 'bar' | 'block' | 'underline',
  blink: boolean
): void {
  const { host, term } = ghosttyVt(engine)
  const stylePtr = host.alloc(4)
  host
    .view()
    .setInt32(
      stylePtr,
      host.enumValue(
        'GhosttyTerminalCursorStyle',
        style === 'bar' ? 'BAR' : style === 'underline' ? 'UNDERLINE' : 'BLOCK'
      ),
      true
    )
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'DEFAULT_CURSOR_STYLE'),
      stylePtr
    ),
    'set DEFAULT_CURSOR_STYLE'
  )
  host.free(stylePtr, 4)
  const blinkPtr = host.alloc(1)
  host.bytes()[blinkPtr] = blink ? 1 : 0
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'DEFAULT_CURSOR_BLINK'),
      blinkPtr
    ),
    'set DEFAULT_CURSOR_BLINK'
  )
  host.free(blinkPtr, 1)
}

export function readGhosttyRgb(
  engine: GhosttyTerminal,
  data: 'COLOR_FOREGROUND' | 'COLOR_BACKGROUND' | 'COLOR_CURSOR' | `${string}_DEFAULT`
): ThemeRgb | null {
  const { host, term } = ghosttyVt(engine)
  return readRgbData(host, term, data)
}

export function readGhosttyPalette(
  engine: GhosttyTerminal,
  data: 'COLOR_PALETTE' | 'COLOR_PALETTE_DEFAULT' = 'COLOR_PALETTE'
): ThemeRgb[] {
  const { host, term } = ghosttyVt(engine)
  const ptr = host.alloc(PALETTE_BYTES)
  const result = host.exports.ghostty_terminal_get(
    term,
    host.enumValue('GhosttyTerminalData', data),
    ptr
  )
  if (result !== host.success) {
    host.free(ptr, PALETTE_BYTES)
    return []
  }
  const colors = readPackedPalette(host, ptr)
  host.free(ptr, PALETTE_BYTES)
  return colors
}

function rgbThemeFromITheme(theme: ITheme): {
  theme: GhosttyRgbTheme
  background: ParsedThemeColor
} {
  const background = parseThemeSlot(theme.background) ?? { rgb: [0, 0, 0], alpha: 1 }
  const foreground = parseThemeSlot(theme.foreground)?.rgb ?? [221, 221, 221]
  const cursor = parseThemeSlot(theme.cursor)?.rgb
  const ansi: ThemeRgb[] = []
  for (let i = 0; i < ANSI_COUNT; i += 1) {
    const key = THEME_ANSI_KEYS[i]
    const parsed = key ? parseThemeSlot(theme[key]) : null
    if (parsed) {
      ansi[i] = parsed.rgb
    }
  }
  const extended = theme.extendedAnsi ?? []
  for (let i = 0; i < extended.length; i += 1) {
    const parsed = parseThemeSlot(extended[i])
    if (parsed) {
      ansi[ANSI_COUNT + i] = parsed.rgb
    }
  }
  return {
    theme: { foreground, background: background.rgb, cursor, ansi },
    background
  }
}

function parseThemeSlot(value: string | undefined): ParsedThemeColor | null {
  if (!value) {
    return null
  }
  return parseCssColorToRgb(value)
}

function applyGhosttyRgbTheme(engine: GhosttyTerminal, theme: GhosttyRgbTheme): void {
  const { host, term } = ghosttyVt(engine)
  writeRgbOption(host, term, 'COLOR_FOREGROUND', theme.foreground)
  writeRgbOption(host, term, 'COLOR_BACKGROUND', theme.background)
  if (theme.cursor) {
    writeRgbOption(host, term, 'COLOR_CURSOR', theme.cursor)
  }
  const palettePtr = host.alloc(PALETTE_BYTES)
  host.exports.ghostty_color_palette_default(palettePtr)
  overlayAnsi(host, palettePtr, theme.ansi)
  const bgPtr = host.alloc(3)
  const fgPtr = host.alloc(3)
  writeRgb(host, bgPtr, theme.background)
  writeRgb(host, fgPtr, theme.foreground)
  host.exports.ghostty_color_palette_generate(palettePtr, ANSI_COUNT, bgPtr, fgPtr, 1, palettePtr)
  overlayAnsi(host, palettePtr, theme.ansi)
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'COLOR_PALETTE'),
      palettePtr
    ),
    'set COLOR_PALETTE'
  )
  host.free(bgPtr, 3)
  host.free(fgPtr, 3)
  host.free(palettePtr, PALETTE_BYTES)
}

function overlayAnsi(host: GhosttyVtHost, palettePtr: number, ansi: ThemeRgb[] | undefined): void {
  if (!ansi) {
    return
  }
  for (let i = 0; i < ansi.length && i < 256; i += 1) {
    const color = ansi[i]
    if (!color) {
      continue
    }
    writeRgb(host, palettePtr + i * 3, color)
  }
}

function writeRgbOption(
  host: GhosttyVtHost,
  term: number,
  option: 'COLOR_FOREGROUND' | 'COLOR_BACKGROUND' | 'COLOR_CURSOR',
  rgb: ThemeRgb
): void {
  const ptr = host.alloc(3)
  writeRgb(host, ptr, rgb)
  host.check(
    host.exports.ghostty_terminal_set(term, host.enumValue('GhosttyTerminalOption', option), ptr),
    `set ${option}`
  )
  host.free(ptr, 3)
}

function writeRgb(host: GhosttyVtHost, ptr: number, rgb: ThemeRgb): void {
  const bytes = host.bytes()
  bytes[ptr] = rgb[0]
  bytes[ptr + 1] = rgb[1]
  bytes[ptr + 2] = rgb[2]
}

function readRgbData(host: GhosttyVtHost, term: number, data: string): ThemeRgb | null {
  const ptr = host.alloc(3)
  const result = host.exports.ghostty_terminal_get(
    term,
    host.enumValue('GhosttyTerminalData', data),
    ptr
  )
  if (result !== host.success) {
    host.free(ptr, 3)
    return null
  }
  const bytes = host.bytes()
  const rgb: ThemeRgb = [bytes[ptr] ?? 0, bytes[ptr + 1] ?? 0, bytes[ptr + 2] ?? 0]
  host.free(ptr, 3)
  return rgb
}

function readPackedPalette(host: GhosttyVtHost, ptr: number): ThemeRgb[] {
  const bytes = host.bytes()
  const colors: ThemeRgb[] = []
  for (let i = 0; i < 256; i += 1) {
    const offset = ptr + i * 3
    colors.push([bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0])
  }
  return colors
}
