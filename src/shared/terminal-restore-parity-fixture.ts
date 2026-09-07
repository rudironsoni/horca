import { DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT } from './terminal-scrollback-policy'

type Emulator = {
  write: (data: string) => Promise<void>
  getVisibleLines: () => string[]
  getSnapshot: (opts?: { scrollbackRows?: number }) => {
    cols: number
    rows: number
    snapshotAnsi: string
    scrollbackAnsi?: string
    modes: { alternateScreen: boolean }
  }
  getCursorLineContext: (rowsAbove: number) => {
    beforeCursor: string
    cursorViewportRow: number
  } | null
  dispose: () => void
}

function createEmulator(dims: { cols: number; rows: number; scrollback?: number }): Emulator {
  // Lazy require keeps this shared module out of the CLI typecheck graph.
  const { HeadlessEmulator } = require('../main/daemon/headless-emulator') as {
    HeadlessEmulator: new (opts: { cols: number; rows: number; scrollback?: number }) => Emulator
  }
  return new HeadlessEmulator({
    cols: dims.cols,
    rows: dims.rows,
    scrollback: dims.scrollback ?? DESKTOP_TERMINAL_SCROLLBACK_ROWS_DEFAULT
  })
}

export type ParityTerminal = {
  terminal: Emulator
}

export function createRendererParityTerminal(dims: { cols: number; rows: number }): ParityTerminal {
  return { terminal: createEmulator(dims) }
}

export function writeToTerminal(terminal: Emulator, data: string): Promise<void> {
  return terminal.write(data)
}

export async function writeChunksToTerminal(terminal: Emulator, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    await writeToTerminal(terminal, chunk)
  }
}

export function visibleRows(terminal: Emulator): string[] {
  return terminal.getVisibleLines()
}

export function visibleRowWraps(terminal: Emulator): boolean[] {
  return terminal.getVisibleLines().map(() => false)
}

export function visibleRowStyles(terminal: Emulator): string[] {
  return visibleRows(terminal)
}

export function normalBufferRowsTrimmed(terminal: Emulator): string[] {
  return visibleRows(terminal)
}

export function normalBufferStylesTrimmed(terminal: Emulator): string[] {
  return visibleRows(terminal)
}

export function cursorPosition(terminal: Emulator): { x: number; y: number } {
  const ctx = terminal.getCursorLineContext(0)
  return { x: ctx?.beforeCursor.length ?? 0, y: ctx?.cursorViewportRow ?? 0 }
}

export const SNAPSHOT_REPLAY_PREAMBLE_NORMAL = ''
export const SNAPSHOT_REPLAY_PREAMBLE_ALT = '\x1b[?1049h'
export const POST_REPLAY_LIVE_SNAPSHOT_RESET_PARITY = ''

export function buildParityMainBufferSnapshot(
  source: ParityTerminal,
  _seq: number,
  opts?: { scrollbackRows?: number }
): {
  cols: number
  rows: number
  data: string
  alternateScreen: boolean
  scrollbackAnsi?: string
} {
  const snapshot = source.terminal.getSnapshot(opts)
  return {
    cols: snapshot.cols,
    rows: snapshot.rows,
    data: snapshot.snapshotAnsi,
    alternateScreen: snapshot.modes.alternateScreen,
    scrollbackAnsi: snapshot.scrollbackAnsi
  }
}
