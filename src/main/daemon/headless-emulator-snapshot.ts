import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import { buildAbsoluteCursorRestoreSequence } from '../../shared/terminal-serialize-absolute-cursor'
import { getGhosttyVtHost } from './ghostty-vt-node-host'
import { splitTerminalSnapshotAnsi } from './terminal-snapshot-ansi-buffers'
import type { TerminalModes } from './types'
import type { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import type { HeadlessVtParityState } from './headless-vt-parity-state'

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

export function headlessFrameRestoreAnsi(
  terminal: GhosttyTerminal,
  modes: TerminalModes,
  parity: HeadlessVtParityState
): string {
  const parts = ['\x1b[0m\x1b[?1049h', parity.sgrSequence()]
  if (terminal.getMode(1)) parts.push('\x1b[?1h')
  if (modes.bracketedPaste) parts.push('\x1b[?2004h')
  if (terminal.getMode(1004)) parts.push('\x1b[?1004h')
  if (terminal.getMode(25) === false) parts.push('\x1b[?25l')
  switch (modes.mouseTracking ? (modes.mouseTrackingMode ?? 'vt200') : 'none') {
    case 'x10':
      parts.push('\x1b[?9h')
      break
    case 'vt200':
      parts.push('\x1b[?1000h')
      break
    case 'drag':
      parts.push('\x1b[?1002h')
      break
    case 'any':
      parts.push('\x1b[?1003h')
      break
    case 'none':
      break
  }
  if (modes.sgrMousePixelsMode) parts.push('\x1b[?1016h')
  else if (modes.sgrMouseMode) parts.push('\x1b[?1006h')
  parts.push(
    buildAbsoluteCursorRestoreSequence(snapshotCursorDuck(terminal, parity), parity.savedCursor, {
      restoreModesWithoutCursor: true
    })
  )
  return parts.join('')
}

function snapshotCursorDuck(terminal: GhosttyTerminal, parity: HeadlessVtParityState) {
  const cursor = terminal.cursor
  return {
    cols: terminal.cols,
    rows: terminal.rows,
    buffer: { active: { cursorX: cursor.x, cursorY: cursor.y } },
    modes: { originMode: parity.originMode },
    _core: {
      buffer: {
        scrollTop: parity.scrollTop,
        scrollBottom: parity.scrollBottom,
        ybase: 0,
        savedX: parity.savedCursor?.x,
        savedY: parity.savedCursor?.y,
        savedOriginMode: parity.savedCursor?.originMode
      }
    }
  }
}

function keepLastVtLines(ansi: string, lineCount: number): string {
  const lines = ansi.split(/\r\n|\n/)
  return lines.slice(-Math.max(0, lineCount)).join('\r\n')
}

export function serializeHeadlessAnsiBuffers(
  terminal: GhosttyTerminal,
  modes: TerminalModes,
  parity: HeadlessVtParityState,
  scrollbackRows?: number
): { snapshotAnsi: string; scrollbackAnsi: string } {
  let snapshotAnsi = compactSnapshotSgr(terminal.readVt())
  if (scrollbackRows !== undefined) {
    snapshotAnsi = keepLastVtLines(snapshotAnsi, terminal.rows + Math.max(0, scrollbackRows))
  }
  if (snapshotAnsi.length > 0) {
    snapshotAnsi += buildAbsoluteCursorRestoreSequence(
      snapshotCursorDuck(terminal, parity),
      parity.savedCursor
    )
  }
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
    return { snapshotAnsi, scrollbackAnsi: compactSnapshotSgr(clone.readVt()) }
  } finally {
    clone.dispose()
  }
}

export function compactSnapshotSgr(ansi: string): string {
  const mapped = ansi
    .replace(/\x1b\[38;5;([0-7])m/g, (_m, n: string) => `\x1b[3${n}m`)
    .replace(/\x1b\[48;5;([0-7])m/g, (_m, n: string) => `\x1b[4${n}m`)
  return mapped.replace(/(?:\x1b\[(?:0|1|2[2-9]|[34][0-9])m)+/g, (cluster) => {
    let bold = false
    let fg: string | null = null
    let bg: string | null = null
    for (const part of cluster.match(/\x1b\[([0-9;]*)m/g) ?? []) {
      const inner = part.slice(2, -1)
      if (inner === '' || inner === '0') {
        bold = false
        fg = null
        bg = null
        continue
      }
      for (const raw of inner.split(';')) {
        const p = Number(raw)
        if (p === 1) bold = true
        else if (p === 22) bold = false
        else if (p >= 30 && p <= 37) fg = raw
        else if (p >= 40 && p <= 47) bg = raw
        else if (p === 39) fg = null
        else if (p === 49) bg = null
      }
    }
    const params: string[] = []
    if (fg) params.push(fg)
    if (bg) params.push(bg)
    if (bold) params.push('1')
    return params.length === 0 ? '\x1b[0m' : `\x1b[${params.join(';')}m`
  })
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
