import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import type { TerminalCursorContext } from '../../shared/terminal-composer-draft'
import { advancePartialEscapeTail } from '../../shared/terminal-partial-escape-tail'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import type { TerminalViewAttributes } from '../../shared/terminal-view-attributes'
import { getGhosttyVtHost } from './ghostty-vt-node-host'
import { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import { TerminalOscCwdTitleScanner } from './terminal-osc-cwd-title-scanner'
import { buildRehydrateSequences } from './terminal-mode-rehydrate-sequences'
import { splitTerminalSnapshotAnsi } from './terminal-snapshot-ansi-buffers'
import type { TerminalModes, TerminalSnapshot } from './types'

export type HeadlessEmulatorOptions = {
  cols: number
  rows: number
  scrollback?: number
  onQueryReply?: (reply: string) => void
  pathFlavor?: 'posix' | 'win32'
  remotePosixFileUriAuthority?: boolean
  wslDistro?: string
}

export type HeadlessEmulatorWriteOptions = {
  forwardQueryReplies?: boolean
}

const DEFAULT_SCROLLBACK = 5000
const CONPTY_DA1_RESPONSE = '\x1b[?61;4c'
const DA1_QUERIES = ['\x1b[c', '\x1b[0c'] as const

export class HeadlessEmulator {
  private terminal: GhosttyTerminal
  private oscText: TerminalOscCwdTitleScanner
  private mouseModes = new TerminalMouseModeMirror()
  private restoredOscLinks: TerminalOscLinkRange[] = []
  private disposed = false
  private onQueryReply: ((reply: string) => void) | null
  private conptyDa1OverrideInstalled = false
  private queryReplyForwardingDepth = 0
  private partialEscapeTail = ''
  private pushedCursorHidden = false

  constructor(opts: HeadlessEmulatorOptions) {
    this.oscText = new TerminalOscCwdTitleScanner({
      pathFlavor: opts.pathFlavor,
      remotePosixAuthority: opts.remotePosixFileUriAuthority === true,
      wslDistro: opts.wslDistro
    })
    this.onQueryReply = opts.onQueryReply ?? null
    this.terminal = new GhosttyTerminal(getGhosttyVtHost(), {
      cols: opts.cols,
      rows: opts.rows,
      scrollbackLines: opts.scrollback ?? DEFAULT_SCROLLBACK,
      onWritePty: this.onQueryReply
        ? (bytes) => this.emitQueryReply(new TextDecoder().decode(bytes))
        : undefined
    })
  }

  installConptyPrimaryDeviceAttributesOverride(): void {
    this.conptyDa1OverrideInstalled = true
  }

  get responderParser(): {
    registerCsiHandler: (
      id: { final: string },
      handler: (params: number[]) => boolean
    ) => { dispose: () => void }
  } {
    return {
      registerCsiHandler: () => ({ dispose: () => undefined })
    }
  }

  installViewAttributeResponder(_getBaseAttributes: () => TerminalViewAttributes | null): void {}

  applyPushedViewAttributes(attributes: TerminalViewAttributes): void {
    this.pushedCursorHidden = attributes.cursorStyle === 'bar' && attributes.cursorBlink === false
  }

  applyKittyKeyboardFlags(flags: number): Promise<void> {
    if (!Number.isInteger(flags) || flags <= 0) {
      return Promise.resolve()
    }
    return this.write(`\x1b[=${flags};1u`)
  }

  disableQueryReplyForwarding(): void {
    this.onQueryReply = null
  }

  write(data: string, opts: HeadlessEmulatorWriteOptions = {}): Promise<void> {
    this.writeSync(this.maybeAnswerConptyDa1(data, opts.forwardQueryReplies === true))
    return Promise.resolve()
  }

  writeSync(data: string): boolean {
    if (this.disposed) {
      return false
    }
    this.oscText.scan(data)
    this.mouseModes.scan(data)
    this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data)
    this.terminal.writePtyOutput(data)
    return true
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      return
    }
    if (this.terminal.cols === cols && this.terminal.rows === rows) {
      return
    }
    this.restoredOscLinks = []
    this.terminal.resize({ cols, rows })
  }

  getAppliedSize(): { cols: number; rows: number } {
    return { cols: this.terminal.cols, rows: this.terminal.rows }
  }

  getSnapshot(opts: { scrollbackRows?: number } = {}): TerminalSnapshot {
    const modes = this.getModes()
    const { snapshotAnsi, scrollbackAnsi } = this.serializeAnsiBuffers(modes)
    return {
      snapshotAnsi,
      scrollbackAnsi,
      oscLinks: this.collectOscLinks(opts.scrollbackRows),
      rehydrateSequences: buildRehydrateSequences(modes),
      frameRestoreAnsi: modes.alternateScreen ? this.buildFrameRestoreAnsi(modes) : undefined,
      cwd: this.oscText.cwd,
      modes,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      scrollbackLines: this.terminal.scrollbackRows,
      lastTitle: this.oscText.lastTitle ?? undefined,
      ...(this.partialEscapeTail.length > 0
        ? { pendingEscapeTailAnsi: this.partialEscapeTail }
        : {})
    }
  }

  get isAlternateScreen(): boolean {
    return this.terminal.isAlternateScreen
  }

  get partialEscapeTailAnsi(): string {
    return this.partialEscapeTail
  }

  isCursorOnEmptyPromptLine(): boolean {
    const line = this.cursorLineText()
    return line.endsWith('>') && !line.endsWith('>>')
  }

  getVisibleLines(): string[] {
    const rows = this.terminal.rows
    const lines = this.terminal.readViewportText().split('\n')
    while (lines.length < rows) {
      lines.push('')
    }
    return lines.slice(0, rows)
  }

  getVisibleBufferRange(): { start: number; endExclusive: number; totalLength: number } {
    const totalLength = this.terminal.totalRows
    const start = Math.max(0, totalLength - this.terminal.rows)
    return { start, endExclusive: totalLength, totalLength }
  }

  getCursorLineContext(rowsAbove = this.terminal.rows): TerminalCursorContext | null {
    const lines = this.getVisibleLines()
    const cursor = this.terminal.cursor
    const start = Math.max(0, cursor.y - Math.max(0, Math.floor(rowsAbove)))
    const line = lines[cursor.y] ?? ''
    return {
      rows: lines.slice(start, cursor.y + 1),
      typedRows: lines.slice(start, cursor.y + 1),
      promptGlyphBoldRows: lines.slice(start, cursor.y + 1).map(() => false),
      rowsWrapped: lines.slice(start, cursor.y + 1).map(() => false),
      rowsBelow: lines.slice(cursor.y + 1),
      typedRowsBelow: lines.slice(cursor.y + 1),
      rowsBelowWrapped: lines.slice(cursor.y + 1).map(() => false),
      rowsBelowCustomForeground: lines.slice(cursor.y + 1).map(() => false),
      beforeCursor: line.slice(0, cursor.x),
      afterCursor: line.slice(cursor.x),
      rawAfterCursor: line.slice(cursor.x),
      cursorHidden: this.pushedCursorHidden,
      cursorViewportRow: cursor.y
    }
  }

  getBufferTailLines(limit: number): string[] {
    const lines = this.terminal.readViewportText().split('\n')
    const start = Math.max(0, lines.length - Math.max(0, Math.floor(limit)))
    return lines.slice(start)
  }

  getCwd(): string | null {
    return this.oscText.cwd
  }

  setCwd(cwd: string | null): void {
    this.oscText.cwd = cwd
  }

  setLastTitle(title: string): void {
    this.oscText.lastTitle = title
  }

  setRestoredOscLinks(links: TerminalOscLinkRange[] | undefined): void {
    this.restoredOscLinks = links?.slice() ?? []
  }

  clearScrollback(): void {
    this.restoredOscLinks = []
    this.terminal.writePtyOutput('\x1b[3J')
  }

  captureEngine(): Uint8Array {
    return this.terminal.capture().nativeSnapshot
  }

  restoreEngine(snapshot: Uint8Array): void {
    this.terminal.restore({ nativeSnapshot: snapshot })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.terminal.dispose()
  }

  private emitQueryReply(reply: string): void {
    if (this.queryReplyForwardingDepth > 0 && this.onQueryReply) {
      this.onQueryReply(reply)
    }
  }

  private maybeAnswerConptyDa1(data: string, forward: boolean): string {
    if (!this.conptyDa1OverrideInstalled) {
      this.withForwarding(forward, () => undefined)
      return data
    }
    let remaining = data
    for (const query of DA1_QUERIES) {
      if (remaining.includes(query)) {
        this.withForwarding(true, () => this.emitQueryReply(CONPTY_DA1_RESPONSE))
        remaining = remaining.split(query).join('')
      }
    }
    this.withForwarding(forward, () => undefined)
    return remaining
  }

  private withForwarding(forward: boolean, body: () => void): void {
    if (forward) {
      this.queryReplyForwardingDepth += 1
    }
    try {
      body()
    } finally {
      if (forward) {
        this.queryReplyForwardingDepth -= 1
      }
    }
  }

  private getModes(): TerminalModes {
    const mouseTrackingMode = this.mouseModes.mouseTrackingMode
    return {
      bracketedPaste: this.terminal.getMode(2004),
      mouseTracking: mouseTrackingMode !== 'none',
      mouseTrackingMode,
      sgrMouseMode: this.mouseModes.sgrMouseMode,
      sgrMousePixelsMode: this.mouseModes.sgrMousePixelsMode,
      applicationCursor: this.terminal.getMode(1),
      alternateScreen: this.terminal.isAlternateScreen,
      kittyKeyboardFlags: this.terminal.kittyKeyboardFlags
    }
  }

  private buildFrameRestoreAnsi(modes: TerminalModes): string {
    const cursor = this.terminal.cursor
    const parts = ['\x1b[0m\x1b[?1049h', buildRehydrateSequences(modes)]
    if (this.terminal.getMode(1004)) {
      parts.push('\x1b[?1004h')
    }
    if (this.terminal.getMode(25) === false) {
      parts.push('\x1b[?25l')
    }
    parts.push(`\x1b[${cursor.y + 1};${cursor.x + 1}H`, '\x1b7')
    return parts.join('')
  }

  private serializeAnsiBuffers(modes: TerminalModes): {
    snapshotAnsi: string
    scrollbackAnsi: string
  } {
    const snapshotAnsi = this.terminal.readVt()
    if (!modes.alternateScreen) {
      return splitTerminalSnapshotAnsi(snapshotAnsi, modes)
    }
    const clone = new GhosttyTerminal(getGhosttyVtHost(), {
      cols: this.terminal.cols,
      rows: this.terminal.rows
    })
    try {
      clone.restore(this.terminal.capture())
      clone.writePtyOutput('\x1b[?1049l')
      return { snapshotAnsi, scrollbackAnsi: clone.readVt() }
    } finally {
      clone.dispose()
    }
  }

  private collectOscLinks(scrollbackRows: number | undefined): TerminalOscLinkRange[] {
    const live = this.terminal.collectHyperlinkRanges()
    const startRow =
      scrollbackRows === undefined
        ? 0
        : Math.max(0, this.terminal.totalRows - this.terminal.rows - scrollbackRows)
    const windowed = live
      .filter((link) => link.row >= startRow)
      .map((link) => ({ ...link, row: link.row - startRow }))
    return [...windowed, ...this.restoredOscLinks]
  }

  private cursorLineText(): string {
    const lines = this.getVisibleLines()
    const { x, y } = this.terminal.cursor
    return (lines[y] ?? '').slice(0, x).trimEnd()
  }
}
