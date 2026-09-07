import type { ITheme } from '../../../../shared/orca-terminal-surface'
import { DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT } from '../../../../shared/terminal-scrollback-policy'
import { buildDefaultTerminalOptions } from './pane-terminal-options'

export type OrcaPaneAppearance = {
  fontSize: number
  fontFamily: string
  fontWeight?: string | number
  fontWeightBold?: string | number
  lineHeight: number
  cursorBlink?: boolean
  cursorStyle?: string
  cursorInactiveStyle?: string
  scrollback?: number
  ignoreBracketedPasteMode?: boolean
  theme?: ITheme
  minimumContrastRatio?: number
  allowTransparency?: boolean
  scrollSensitivity?: number
  fastScrollSensitivity?: number
  macOptionIsMeta?: boolean
  mouseEventsRequireAlt?: boolean
  screenReaderMode?: boolean
  linkHandler?: {
    activate?: (event: MouseEvent, text: string) => void
    hover?: (event: MouseEvent, text: string) => void
    leave?: (event: MouseEvent, text: string) => void
    allowNonHttpProtocols?: boolean
  }
}

export function resolveOrcaPaneAppearance(
  appearance: Partial<OrcaPaneAppearance> = {}
): OrcaPaneAppearance {
  const defaults = buildDefaultTerminalOptions()
  return {
    fontSize: appearance.fontSize ?? defaults.fontSize ?? 14,
    fontFamily: appearance.fontFamily ?? defaults.fontFamily ?? 'monospace',
    fontWeight: appearance.fontWeight ?? defaults.fontWeight,
    fontWeightBold: appearance.fontWeightBold ?? defaults.fontWeightBold,
    lineHeight: appearance.lineHeight ?? 1.2,
    cursorBlink: appearance.cursorBlink ?? defaults.cursorBlink,
    cursorStyle: appearance.cursorStyle ?? defaults.cursorStyle,
    cursorInactiveStyle: appearance.cursorInactiveStyle ?? defaults.cursorInactiveStyle,
    scrollback:
      appearance.scrollback ?? defaults.scrollback ?? DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
    ignoreBracketedPasteMode: appearance.ignoreBracketedPasteMode,
    theme: appearance.theme,
    minimumContrastRatio: appearance.minimumContrastRatio ?? defaults.minimumContrastRatio,
    allowTransparency: appearance.allowTransparency ?? defaults.allowTransparency,
    scrollSensitivity: appearance.scrollSensitivity ?? defaults.scrollSensitivity,
    fastScrollSensitivity: appearance.fastScrollSensitivity ?? defaults.fastScrollSensitivity,
    macOptionIsMeta: appearance.macOptionIsMeta,
    mouseEventsRequireAlt: appearance.mouseEventsRequireAlt,
    screenReaderMode: appearance.screenReaderMode,
    linkHandler: appearance.linkHandler
  }
}

export function measureCellSize(appearance: OrcaPaneAppearance): { width: number; height: number } {
  const height = Math.max(8, appearance.fontSize * appearance.lineHeight)
  if (typeof document === 'undefined') {
    return { width: Math.max(6, appearance.fontSize * 0.6), height }
  }
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { width: Math.max(6, appearance.fontSize * 0.6), height }
  }
  ctx.font = `${appearance.fontSize}px ${appearance.fontFamily}`
  const width = ctx.measureText('M').width
  return { width: Math.max(6, width), height }
}
