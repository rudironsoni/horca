import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { resolveTerminalFontWeights } from '../../../../shared/terminal-fonts'
import { normalizeTerminalLineHeight } from '../../../../shared/terminal-line-height-settings'
import { buildFontFamily } from '@/components/terminal-pane/layout-serialization'
import type { OrcaPaneAppearance } from '@/lib/pane-manager/orca-pane-terminal'

/** Options a live settings change can write onto an open preview terminal. */
export function buildPreviewAppearanceOptions(
  settings: GlobalSettings | null
): Partial<OrcaPaneAppearance> {
  const cursorStyle = settings?.terminalCursorStyle ?? 'block'
  const fontWeights = resolveTerminalFontWeights(
    settings?.terminalFontWeight,
    settings?.terminalFontWeightBold
  )
  return {
    fontSize: settings?.terminalFontSize ?? 14,
    fontFamily: buildFontFamily(settings?.terminalFontFamily ?? ''),
    fontWeight: fontWeights.fontWeight,
    fontWeightBold: fontWeights.fontWeightBold,
    cursorStyle,
    cursorBlink: settings?.terminalCursorBlink ?? true,
    lineHeight: normalizeTerminalLineHeight(settings?.terminalLineHeight)
  }
}

export function buildPreviewTerminalOptions(args: {
  settings: GlobalSettings | null
  cols: number
  rows: number
  scrollback: number
}): Partial<OrcaPaneAppearance> {
  return {
    ...buildPreviewAppearanceOptions(args.settings),
    scrollback: args.scrollback
  }
}
