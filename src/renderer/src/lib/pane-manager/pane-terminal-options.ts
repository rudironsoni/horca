import { DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT } from '../../../../shared/terminal-scrollback-policy'
import { LIGHT_BG_MIN_CONTRAST } from '@/lib/terminal-contrast-correction'

type TerminalCursorStyle = 'block' | 'bar' | 'underline'
type TerminalCursorInactiveStyle = TerminalCursorStyle | 'outline'

export const DEFAULT_TERMINAL_SCROLL_SENSITIVITY = 1.15
export const DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY = 5

export function normalizeTerminalScrollSensitivity(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(10, Math.max(0.1, value))
    : DEFAULT_TERMINAL_SCROLL_SENSITIVITY
}

export function normalizeTerminalFastScrollSensitivity(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(20, Math.max(1, value))
    : DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY
}

export function resolveTerminalCursorInactiveStyle(
  cursorStyle: TerminalCursorStyle | undefined
): TerminalCursorInactiveStyle {
  // Why: terminal's default inactive outline turns a bar/underline cursor into
  // extra strokes in blurred panes; only block cursors benefit from outline.
  return (cursorStyle ?? 'block') === 'block' ? 'outline' : (cursorStyle ?? 'block')
}

export function buildDefaultTerminalOptions(): {
  cursorBlink: boolean
  cursorStyle: TerminalCursorStyle
  cursorInactiveStyle: TerminalCursorInactiveStyle
  fontSize: number
  fontFamily: string
  fontWeight: string
  fontWeightBold: string
  lineHeight: number
  scrollback: number
  scrollSensitivity: number
  fastScrollSensitivity: number
  allowTransparency: boolean
  minimumContrastRatio: number
} {
  const cursorStyle: TerminalCursorStyle = 'block'

  return {
    cursorBlink: true,
    cursorStyle,
    cursorInactiveStyle: resolveTerminalCursorInactiveStyle(cursorStyle),
    fontSize: 14,
    fontFamily:
      '"SF Mono", "Menlo", "Monaco", "Cascadia Mono", "Consolas", "DejaVu Sans Mono", "Liberation Mono", "Symbols Nerd Font Mono", "MesloLGS Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", monospace',
    fontWeight: '300',
    fontWeightBold: '500',
    lineHeight: 1.2,
    scrollback: DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT,
    scrollSensitivity: DEFAULT_TERMINAL_SCROLL_SENSITIVITY,
    fastScrollSensitivity: DEFAULT_TERMINAL_FAST_SCROLL_SENSITIVITY,
    allowTransparency: false,
    minimumContrastRatio: LIGHT_BG_MIN_CONTRAST
  }
}
