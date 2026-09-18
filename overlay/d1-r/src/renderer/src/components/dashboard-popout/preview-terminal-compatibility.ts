import type { Terminal } from '../../../../shared/orca-terminal-surface'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { installWindowsCtrlAltChordRepair } from '@/lib/pane-manager/terminal-windows-ctrl-alt-chord-classification'
import { attachTerminalMouseWheelMultiplier } from '@/lib/pane-manager/pane-terminal-mouse-wheel'
import { configureLazyArabicShapingJoiner } from '@/lib/pane-manager/terminal-arabic-shaping-joiner'
import { installTerminalImeCandidateAnchor } from '@/lib/pane-manager/terminal-ime-candidate-anchor'
import { normalizeTerminalTuiMouseWheelMultiplier } from '@/lib/pane-manager/pane-terminal-tui-wheel-reports'
import { installPreviewTerminalLinks } from './preview-terminal-links'
import { syncPreviewTerminalLigatures } from './preview-terminal-ligatures'

/**
 * Brings the preview's emulator up to a pane's: Orca's Unicode 11 width shim,
 * Windows Ctrl+Alt chord classification, clickable links, ligatures, the TUI
 * wheel multiplier, lazy Arabic shaping, and the IME candidate anchor.
 *
 * Returns a disposer for everything bound to the terminal's DOM element, which
 * must run before that terminal is disposed or replaced.
 */
export function installPreviewTerminalCompatibility(
  terminal: Terminal,
  deps: { getSettings: () => GlobalSettings | null }
): () => void {
  installWindowsCtrlAltChordRepair(terminal)
  installPreviewTerminalLinks(terminal)
  syncPreviewTerminalLigatures(terminal, deps.getSettings())
  attachTerminalMouseWheelMultiplier(terminal, {
    getTuiMouseWheelMultiplier: () =>
      normalizeTerminalTuiMouseWheelMultiplier(deps.getSettings()?.terminalTuiScrollSensitivity)
  })
  // Why: joiners cost a full-grid scan per repaint, so registration stays lazy
  // until RTL text arrives. Never shaping-active: the preview is DOM-rendered
  // and has no WebGL glyph atlas to compensate for.
  const disposeArabicShapingJoiner = configureLazyArabicShapingJoiner(terminal, () => false)
  const imeAnchorHandler = installTerminalImeCandidateAnchor(terminal)

  return () => {
    if (imeAnchorHandler && terminal.element) {
      terminal.element.removeEventListener('compositionstart', imeAnchorHandler)
      terminal.element.removeEventListener('compositionupdate', imeAnchorHandler)
    }
    disposeArabicShapingJoiner()
  }
}
