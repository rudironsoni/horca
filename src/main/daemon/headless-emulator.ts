import { HeadlessVtQueryParser } from '../../ghostty-vt/headless-vt-query-parser'
import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import type { TerminalCursorContext } from '../../shared/terminal-composer-draft'
import { advancePartialEscapeTail } from '../../shared/terminal-partial-escape-tail'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import type { TerminalViewAttributes } from '../../shared/terminal-view-attributes'
import { getGhosttyVtHost } from './ghostty-vt-node-host'
import { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import { TerminalOscCwdTitleScanner } from './terminal-osc-cwd-title-scanner'
import {
  collectHeadlessOscLinks,
  headlessFrameRestoreAnsi,
  headlessModes,
  serializeHeadlessAnsiBuffers
} from './headless-emulator-snapshot'
import { buildRehydrateSequences } from './terminal-mode-rehydrate-sequences'
import {
  installTerminalViewAttributeResponder,
  type TerminalViewAttributeResponder
} from './terminal-view-attribute-responder'
import type { TerminalSnapshot } from './types'

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
  private readonly queryParser = new HeadlessVtQueryParser()
  private viewAttributeResponder: TerminalViewAttributeResponder | null = null

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

  get responderParser(): HeadlessVtQueryParser {
    return this.queryParser
  }

  installViewAttributeResponder(getBaseAttributes: () => TerminalViewAttributes | null): void {
    if (this.viewAttributeResponder) {
      return
    }
    this.viewAttributeResponder = installTerminalViewAttributeResponder({
      parser: this.queryParser,
      getBaseAttributes,
      emitReply: (reply) => this.emitQueryReply(reply)
    })
  }

  applyPushedViewAttributes(attributes: TerminalViewAttributes): void {
    this.pushedCursorHidden = attributes.cursorStyle === 'bar' && attributes.cursorBlink === false
    this.viewAttributeResponder?.clearColorOverrides()
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
    const remaining = this.maybeAnswerConptyDa1(data, opts.forwardQueryReplies === true)
    this.withForwarding(opts.forwardQueryReplies === true, () => {
      this.writeSync(remaining)
    })
    return Promise.resolve()
  }

  writeSync(data: string): boolean {
    if (this.disposed) {
      return false
    }
    this.oscText.scan(data)
    this.mouseModes.scan(data)
    this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data)
    this.terminal.writePtyOutput(this.queryParser.consume(data))
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
    const modes = headlessModes(this.terminal, this.mouseModes)
    const { snapshotAnsi, scrollbackAnsi } = serializeHeadlessAnsiBuffers(this.terminal, modes)
    return {
      snapshotAnsi,
      scrollbackAnsi,
      oscLinks: collectHeadlessOscLinks(this.terminal, this.restoredOscLinks, opts.scrollbackRows),
      rehydrateSequences: buildRehydrateSequences(modes),
      frameRestoreAnsi: modes.alternateScreen
        ? headlessFrameRestoreAnsi(this.terminal, modes)
        : undefined,
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

  private cursorLineText(): string {
    const lines = this.getVisibleLines()
    const { x, y } = this.terminal.cursor
    return (lines[y] ?? '').slice(0, x).trimEnd()
  }
}
