import type { TerminalViewRgb } from '../shared/terminal-view-attributes'

export type ThemeRgb = TerminalViewRgb

export type ParsedThemeColor = {
  rgb: ThemeRgb
  alpha: number
}

const RGBA_RE =
  /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*[,/]\s*(0|1|0?\.\d+))?\s*\)$/i

export function parseCssColorToRgb(css: string): ParsedThemeColor | null {
  const trimmed = css.trim()
  const rgba = RGBA_RE.exec(trimmed)
  if (rgba) {
    return {
      rgb: [
        Number.parseInt(rgba[1] ?? '0', 10),
        Number.parseInt(rgba[2] ?? '0', 10),
        Number.parseInt(rgba[3] ?? '0', 10)
      ],
      alpha: rgba[4] === undefined ? 1 : Number.parseFloat(rgba[4])
    }
  }
  if (/^#[\da-f]{3,8}$/i.test(trimmed)) {
    return parseHexColor(trimmed)
  }
  return null
}

export function rgbToCss(rgb: ThemeRgb, alpha = 1): string {
  if (alpha < 1) {
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
  }
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`
}

function parseHexColor(css: string): ParsedThemeColor | null {
  const hex = css.slice(1)
  switch (hex.length) {
    case 3:
      return {
        rgb: [
          Number.parseInt(hex[0] + hex[0], 16),
          Number.parseInt(hex[1] + hex[1], 16),
          Number.parseInt(hex[2] + hex[2], 16)
        ],
        alpha: 1
      }
    case 4:
      return {
        rgb: [
          Number.parseInt(hex[0] + hex[0], 16),
          Number.parseInt(hex[1] + hex[1], 16),
          Number.parseInt(hex[2] + hex[2], 16)
        ],
        alpha: Number.parseInt(hex[3] + hex[3], 16) / 255
      }
    case 6:
      return {
        rgb: [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16)
        ],
        alpha: 1
      }
    case 8:
      return {
        rgb: [
          Number.parseInt(hex.slice(0, 2), 16),
          Number.parseInt(hex.slice(2, 4), 16),
          Number.parseInt(hex.slice(4, 6), 16)
        ],
        alpha: Number.parseInt(hex.slice(6, 8), 16) / 255
      }
    default:
      return null
  }
}
