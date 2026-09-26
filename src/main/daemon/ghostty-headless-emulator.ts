import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import { HeadlessVtQueryParser } from '../../ghostty-vt/headless-vt-query-parser'
import { readGridLine } from '../../ghostty-vt/ghostty-terminal-ops'
import { getGhosttyVtHost } from './ghostty-vt-node-host'
import { HeadlessVtSequenceSplitter } from './headless-vt-sequence-splitter'
import { HeadlessVtParityState } from './headless-vt-parity-state'
import type { HeadlessParser } from '../../shared/headless-parser'
import { advancePartialEscapeTail } from '../../shared/terminal-partial-escape-tail'
import type { TerminalViewAttributes } from '../../shared/terminal-view-attributes'
import type { TerminalOscLinkRange } from '../../shared/terminal-osc-link-ranges'
import type { TerminalCursorContext } from '../../shared/terminal-composer-draft'
import { readTerminalCursorLineContext } from '../../shared/terminal-cursor-line-context'
import { TerminalMouseModeMirror } from './terminal-mouse-mode-mirror'
import { TerminalOscCwdTitleScanner } from './terminal-osc-cwd-title-scanner'
import { buildRehydrateSequences } from './terminal-mode-rehydrate-sequences'
import {
  collectHeadlessOscLinks,
  headlessFrameRestoreAnsi,
  serializeHeadlessAnsiBuffers
} from './headless-emulator-snapshot'
import {
  installTerminalViewAttributeResponder,
  type TerminalViewAttributeResponder
} from './terminal-view-attribute-responder'
import { installDeviceAttributesResponder } from './startup-device-attributes-responder'
import type { TerminalSnapshot, TerminalModes } from './types'

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

export class GhosttyHeadlessEmulator {
  private readonly engine: GhosttyTerminal
  private readonly queryParser = new HeadlessVtQueryParser()
  private readonly splitter = new HeadlessVtSequenceSplitter()
  private readonly parity: HeadlessVtParityState
  private readonly oscText: TerminalOscCwdTitleScanner
  private readonly mouseModes = new TerminalMouseModeMirror()
  private restoredOscLinks: TerminalOscLinkRange[] = []
  private disposed = false
  private onQueryReply: ((reply: string) => void) | null
  private conptyDa1OverrideInstalled = false
  private viewAttributeResponder: TerminalViewAttributeResponder | null = null
  private queryReplyForwardingDepth = 0
  private partialEscapeTail = ''
  private cursorStyle = 'block'
  private cursorBlink = false
  private modelSeq = 0
  private projectionAppliedModelSeq = 0

  constructor(opts: HeadlessEmulatorOptions) {
    this.oscText = new TerminalOscCwdTitleScanner({
      pathFlavor: opts.pathFlavor,
      remotePosixAuthority: opts.remotePosixFileUriAuthority === true,
      wslDistro: opts.wslDistro
    })
    this.onQueryReply = opts.onQueryReply ?? null
    this.parity = new HeadlessVtParityState(opts.rows)
    this.engine = new GhosttyTerminal(getGhosttyVtHost(), {
      cols: opts.cols,
      rows: opts.rows,
      scrollbackLines: opts.scrollback ?? DEFAULT_SCROLLBACK,
      onWritePty: (bytes) => {
        this.emitQueryReply(new TextDecoder().decode(bytes))
      }
    })
  }

  get responderParser(): HeadlessParser {
    return this.queryParser
  }

  installConptyPrimaryDeviceAttributesOverride(): void {
    if (this.conptyDa1OverrideInstalled) return
    this.conptyDa1OverrideInstalled = true
    installDeviceAttributesResponder({
      parser: this.queryParser,
      response: CONPTY_DA1_RESPONSE,
      reply: (data) => this.emitQueryReply(data)
    })
  }

  installViewAttributeResponder(getBaseAttributes: () => TerminalViewAttributes | null): void {
    if (this.viewAttributeResponder) return
    this.viewAttributeResponder = installTerminalViewAttributeResponder({
      parser: this.queryParser,
      getBaseAttributes,
      emitReply: (reply) => this.emitQueryReply(reply)
    })
  }

  applyPushedViewAttributes(attributes: TerminalViewAttributes): void {
    if (this.disposed) return
    this.cursorStyle = attributes.cursorStyle
    this.cursorBlink = attributes.cursorBlink
    this.viewAttributeResponder?.clearColorOverrides()
  }

  applyKittyKeyboardFlags(flags: number): Promise<void> {
    if (!Number.isInteger(flags) || flags <= 0) return Promise.resolve()
    return this.write(`\x1b[=${flags};1u`)
  }

  disableQueryReplyForwarding(): void {
    this.onQueryReply = null
  }

  getModelSeq(): number {
    return this.modelSeq
  }

  getProjectionAppliedModelSeq(): number {
    return this.projectionAppliedModelSeq
  }

  canPublishSnapshot(targetSeq: number): boolean {
    return this.projectionAppliedModelSeq >= targetSeq
  }

  write(data: string, opts: HeadlessEmulatorWriteOptions = {}): Promise<void> {
    this.modelSeq += 1
    const seq = this.modelSeq
    this.applyWrite(data, opts)
    this.projectionAppliedModelSeq = seq
    return Promise.resolve()
  }

  writeSync(data: string): boolean {
    if (this.disposed) return false
    this.modelSeq += 1
    const seq = this.modelSeq
    this.applyWrite(data)
    this.projectionAppliedModelSeq = seq
    return true
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) return
    if (this.engine.cols === cols && this.engine.rows === rows) return
    this.modelSeq += 1
    const seq = this.modelSeq
    this.restoredOscLinks = []
    this.engine.resize({ cols, rows })
    this.projectionAppliedModelSeq = seq
  }

  getAppliedSize(): { cols: number; rows: number } {
    return { cols: this.engine.cols, rows: this.engine.rows }
  }

  getSnapshot(opts: { scrollbackRows?: number } = {}): TerminalSnapshot {
    const modes = this.getModes()
    const { snapshotAnsi, scrollbackAnsi } = serializeHeadlessAnsiBuffers(
      this.engine,
      modes,
      this.parity,
      opts.scrollbackRows
    )
    return {
      snapshotAnsi,
      scrollbackAnsi,
      oscLinks: collectHeadlessOscLinks(this.engine, this.restoredOscLinks, opts.scrollbackRows),
      rehydrateSequences: buildRehydrateSequences(modes),
      ...(modes.alternateScreen
        ? { frameRestoreAnsi: headlessFrameRestoreAnsi(this.engine, modes, this.parity) }
        : {}),
      cwd: this.oscText.cwd,
      modes,
      cols: this.engine.cols,
      rows: this.engine.rows,
      scrollbackLines: Math.max(0, this.engine.totalRows - this.engine.rows),
      lastTitle: this.oscText.lastTitle ?? undefined,
      ...(this.partialEscapeTail.length > 0 ? { pendingEscapeTailAnsi: this.partialEscapeTail } : {})
    }
  }

  get isAlternateScreen(): boolean {
    return this.engine.isAlternateScreen
  }

  get partialEscapeTailAnsi(): string {
    return this.partialEscapeTail
  }

  isCursorOnEmptyPromptLine(): boolean {
    const line = (this.getVisibleLines()[this.engine.cursor.y] ?? '').trimEnd()
    return line.endsWith('>') && !line.endsWith('>>')
  }

  getVisibleLines(): string[] {
    const text = this.engine.readViewportText()
    const rows = this.engine.rows
    const lines = text.split('\n')
    while (lines.length < rows) lines.push('')
    return lines.slice(0, rows)
  }

  getVisibleBufferRange(): { start: number; endExclusive: number; totalLength: number } {
    const total = this.engine.totalRows
    const rows = this.engine.rows
    const start = Math.max(0, total - rows)
    return { start, endExclusive: total, totalLength: total }
  }

  getCursorLineContext(rowsAbove = this.engine.rows): TerminalCursorContext | null {
    return readTerminalCursorLineContext(this.asCursorSource(), rowsAbove)
  }

  getBufferTailLines(limit: number): string[] {
    const total = this.engine.totalRows
    const start = Math.max(0, total - Math.max(0, Math.floor(limit)))
    const lines: string[] = []
    for (let row = start; row < total; row += 1) {
      const grid = readGridLine(this.engine, row)
      lines.push(grid ? grid.cells.map((c) => c.chars || ' ').join('').trimEnd() : '')
    }
    return lines
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
    this.engine.writePtyOutput('\x1b[H\x1b[2J\x1b[3J')
  }

  dispose(): void {
    this.disposed = true
    this.engine.dispose()
  }

  private applyWrite(data: string, opts: HeadlessEmulatorWriteOptions = {}): void {
    if (this.disposed) return
    const forwardQueryReplies = opts.forwardQueryReplies === true
    if (forwardQueryReplies) this.queryReplyForwardingDepth += 1
    try {
      this.oscText.scan(data)
      const remainder = this.queryParser.consume(data)
      for (const piece of this.splitter.push(remainder)) {
        if (piece.text.length > 0) this.engine.writePtyOutput(piece.text)
        this.parity.observe(piece, this.engine.cursor, this.engine.isAlternateScreen)
      }
      this.mouseModes.scan(data)
      this.partialEscapeTail = advancePartialEscapeTail(this.partialEscapeTail, data)
    } finally {
      if (forwardQueryReplies) this.queryReplyForwardingDepth -= 1
    }
  }

  private emitQueryReply(reply: string): void {
    if (this.queryReplyForwardingDepth > 0 && this.onQueryReply) this.onQueryReply(reply)
  }

  private getModes(): TerminalModes {
    const mouseTrackingMode = this.mouseModes.mouseTrackingMode
    return {
      bracketedPaste: this.engine.getMode(2004),
      mouseTracking: mouseTrackingMode !== 'none' || this.engine.mouseTracking,
      mouseTrackingMode,
      sgrMouseMode: this.mouseModes.sgrMouseMode,
      sgrMousePixelsMode: this.mouseModes.sgrMousePixelsMode,
      applicationCursor: this.engine.isAlternateScreen ? false : this.engine.getMode(1),
      alternateScreen: this.engine.isAlternateScreen,
      kittyKeyboardFlags: this.parity.kittyKeyboardFlags
    }
  }

  private asCursorSource() {
    const engine = this.engine
    const showCursor = this.cursorBlink || this.cursorStyle !== 'none'
    return {
      rows: engine.rows,
      modes: { showCursor },
      buffer: {
        active: {
          get baseY() {
            return Math.max(0, engine.totalRows - engine.rows)
          },
          get cursorX() {
            return engine.cursor.x
          },
          get cursorY() {
            return engine.cursor.y
          },
          get viewportY() {
            return Math.max(0, engine.totalRows - engine.rows)
          },
          getLine(row: number) {
            const grid = readGridLine(engine, row)
            if (!grid) return undefined
            return {
              isWrapped: grid.isWrapped,
              length: grid.cells.length,
              getCell(column: number) {
                const cell = grid.cells[column]
                if (!cell) return undefined
                return {
                  getChars: () => cell.chars,
                  getWidth: () => cell.width,
                  isBold: () => cell.bold,
                  isDim: () => cell.dim,
                  isFgDefault: () => cell.fgDefault
                }
              },
              translateToString(trimRight = true, startColumn = 0, endColumn?: number) {
                const end = endColumn ?? grid.cells.length
                let text = grid.cells
                  .slice(startColumn, end)
                  .map((c) => c.chars || ' ')
                  .join('')
                return trimRight ? text.trimEnd() : text
              }
            }
          }
        }
      }
    }
  }
}

export { GhosttyHeadlessEmulator as HeadlessEmulator }
