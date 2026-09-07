import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import { getGhosttyVtHost } from './ghostty-vt-node-host'
import { buildRehydrateSequences } from './terminal-mode-rehydrate-sequences'
import { splitTerminalSnapshotAnsi } from './terminal-snapshot-ansi-buffers'
import type { TerminalModes } from './types'
import type { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'

export function headlessModes(
  terminal: GhosttyTerminal,
  mouseModes: TerminalMouseModeMirror
): TerminalModes {
  const mouseTrackingMode = mouseModes.mouseTrackingMode
  return {
    bracketedPaste: terminal.getMode(2004),
    mouseTracking: mouseTrackingMode !== 'none',
    mouseTrackingMode,
    sgrMouseMode: mouseModes.sgrMouseMode,
    sgrMousePixelsMode: mouseModes.sgrMousePixelsMode,
    applicationCursor: terminal.getMode(1),
    alternateScreen: terminal.isAlternateScreen,
    kittyKeyboardFlags: terminal.kittyKeyboardFlags
  }
}

export function headlessFrameRestoreAnsi(terminal: GhosttyTerminal, modes: TerminalModes): string {
  const cursor = terminal.cursor
  const parts = ['\x1b[0m\x1b[?1049h', buildRehydrateSequences(modes)]
  if (terminal.getMode(1004)) {
    parts.push('\x1b[?1004h')
  }
  if (terminal.getMode(25) === false) {
    parts.push('\x1b[?25l')
  }
  parts.push(`\x1b[${cursor.y + 1};${cursor.x + 1}H`, '\x1b7')
  return parts.join('')
}

export function serializeHeadlessAnsiBuffers(
  terminal: GhosttyTerminal,
  modes: TerminalModes
): { snapshotAnsi: string; scrollbackAnsi: string } {
  const snapshotAnsi = terminal.readVt()
  if (!modes.alternateScreen) {
    return splitTerminalSnapshotAnsi(snapshotAnsi, modes)
  }
  const clone = new GhosttyTerminal(getGhosttyVtHost(), {
    cols: terminal.cols,
    rows: terminal.rows
  })
  try {
    clone.restore(terminal.capture())
    clone.writePtyOutput('\x1b[?1049l')
    return { snapshotAnsi, scrollbackAnsi: clone.readVt() }
  } finally {
    clone.dispose()
  }
}

export function collectHeadlessOscLinks(
  terminal: GhosttyTerminal,
  restoredOscLinks: TerminalOscLinkRange[],
  scrollbackRows: number | undefined
): TerminalOscLinkRange[] {
  const live = terminal.collectHyperlinkRanges()
  const startRow =
    scrollbackRows === undefined
      ? 0
      : Math.max(0, terminal.totalRows - terminal.rows - scrollbackRows)
  const windowed = live
    .filter((link) => link.row >= startRow)
    .map((link) => ({ ...link, row: link.row - startRow }))
  return [...windowed, ...restoredOscLinks]
}
