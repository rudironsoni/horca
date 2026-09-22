import type { OrcaDisposable, OrcaTerminalGrid } from '../../../../shared/orca-terminal-surface'
import {
  measureCellSize,
  resolveOrcaPaneAppearance,
  type OrcaPaneAppearance
} from './orca-pane-appearance'
import {
  createOrcaPaneParser,
  flushWaiters,
  notifyTitleListeners,
  schedulePrimaryScreenCallback
} from './orca-pane-buffer'
import { createOrcaPaneSurface } from './orca-pane-surface'
import { bindOrcaPaneHostChrome, type OrcaPaneHostChrome } from './orca-pane-host-chrome'
import { OrcaPaneListenerHub } from './orca-pane-terminal-events'
import {
  attachHorcaGhosttyPassthruPane,
  detachHorcaGhosttyPassthruPane,
  readHorcaGhosttySelection
} from './horca-ghostty-passthru-attach'

export type { OrcaPaneAppearance } from './orca-pane-appearance'

const OSC_TITLE = /\x1b\]0;([^\x07]*)\x07/g

export class OrcaPaneTerminal extends OrcaPaneListenerHub {
  readonly element: HTMLCanvasElement
  readonly textarea: HTMLTextAreaElement
  readonly options: OrcaPaneAppearance
  readonly parser: ReturnType<typeof createOrcaPaneParser>
  readonly slot: string
  private readonly measureRoot: HTMLElement
  private readonly primaryScreenWaiters = new Set<() => void>()
  private chrome: OrcaPaneHostChrome
  cellWidth: number
  cellHeight: number
  private _cols = 80
  private _rows = 24
  private _title = ''
  private _ingest = ''
  private _disposed = false
  private _alternate = false
  private boundSessionId: string | null = null
  constructor(measureRoot: HTMLElement, appearance: Partial<OrcaPaneAppearance> = {}) {
    super()
    this.options = resolveOrcaPaneAppearance(appearance)
    this.measureRoot = measureRoot
    const surface = createOrcaPaneSurface(this.options)
    this.element = surface.canvas
    this.textarea = surface.textarea
    this.slot = surface.slot
    this.cellWidth = surface.cellWidth
    this.cellHeight = surface.cellHeight
    this.parser = createOrcaPaneParser()
    this.chrome = bindOrcaPaneHostChrome(this.element, this.measureRoot, (delta) =>
      this.scrollLines(delta)
    )
    surface.bindRefresh(() => this.refresh())
  }

  get cols(): number {
    return this._cols
  }
  get rows(): number {
    return this._rows
  }
  get isAlternateScreen(): boolean {
    return this._alternate
  }
  get title(): string {
    return this._title
  }
  readViewportText(): string {
    return this._ingest
  }
  get buffer(): { active: OrcaTerminalGrid } {
    const rows = this._rows
    return {
      active: {
        cursorX: 0,
        cursorY: 0,
        baseY: 0,
        length: rows,
        viewportY: 0,
        type: this._alternate ? 'alternate' : 'normal',
        getLine: () => undefined
      }
    }
  }
  get cursor(): { x: number; y: number } {
    return { x: 0, y: 0 }
  }
  get viewportY(): number {
    return 0
  }
  get baseY(): number {
    return 0
  }
  write(data: string | Uint8Array, onDone?: () => void): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const previousTitle = this._title
    this.parser.consume(text)
    this._ingest += text
    if (text.includes('\x1b[?1049h')) {
      this._alternate = true
    }
    if (text.includes('\x1b[?1049l')) {
      this._alternate = false
    }
    OSC_TITLE.lastIndex = 0
    let osc: RegExpExecArray | null
    while ((osc = OSC_TITLE.exec(text)) !== null) {
      this._title = osc[1] ?? ''
    }
    this.chrome.write(text)
    this.refresh()
    notifyTitleListeners(previousTitle, this._title, this.titleListeners)
    flushWaiters(this.isAlternateScreen, this.primaryScreenWaiters)
    onDone?.()
  }
  get modes(): {
    bracketedPasteMode?: boolean
    mouseTrackingMode?: string
    sendFocusMode?: boolean
    showCursor?: boolean
  } {
    return {
      bracketedPasteMode: false,
      mouseTrackingMode: 'none',
      sendFocusMode: false,
      showCursor: true
    }
  }

  reset(): void {
    this._ingest = ''
    this._title = ''
    this._alternate = false
    this.refresh()
  }
  clear(): void {
    this._ingest = ''
    this.refresh()
  }

  input(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data)
    }
  }

  onTitleChange(listener: (title: string) => void): OrcaDisposable {
    listener(this._title)
    this.titleListeners.add(listener)
    return {
      dispose: () => {
        this.titleListeners.delete(listener)
      }
    }
  }
  hasSelection(): boolean {
    return this.getSelection().length > 0
  }
  getSelectionPosition():
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined {
    return undefined
  }
  resize(cols: number, rows: number): void {
    this._cols = cols
    this._rows = rows
    this.chrome.resize(cols, rows)
    this.refresh()
    for (const listener of this.resizeListeners) {
      listener({ cols: this.cols, rows: this.rows })
    }
  }
  proposeDimensions(): { cols: number; rows: number } | null {
    const rect = this.measureRoot.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) {
      return null
    }
    return {
      cols: Math.max(8, Math.floor(rect.width / this.cellWidth)),
      rows: Math.max(4, Math.floor(rect.height / this.cellHeight))
    }
  }
  fit(): void {
    const dims = this.proposeDimensions()
    if (!dims) {
      return
    }
    if (dims.cols !== this.cols || dims.rows !== this.rows) {
      this.resize(dims.cols, dims.rows)
      return
    }
    this.refresh()
  }
  refresh(_start?: number, _end?: number): void {
    this.chrome.sync()
    for (const listener of this.renderListeners) {
      listener()
    }
  }
  focus(): void {
    this.element.focus()
  }
  blur(): void {
    this.element.blur()
  }
  clearSelection(): void {
    for (const listener of this.selectionListeners) {
      listener()
    }
  }
  setPreedit(_text: string): void {}
  selectAll(): void {}
  paste(text: string): void {
    this.input(text)
  }
  getSelection(): string {
    return readHorcaGhosttySelection(this.slot)
  }
  scrollToTop(): void {}
  scrollToBottom(): void {}
  scrollToLine(_line: number): void {}
  scrollLines(_delta: number): void {}
  encodeKey(_event: KeyboardEvent): string {
    return ''
  }
  encodeMouse(_event: MouseEvent & { deltaY?: number }): string {
    return ''
  }
  findNext(_query: string, _options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    return this._ingest.includes(_query)
  }
  findPrevious(query: string, options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    return this.findNext(query, options)
  }
  serialize(_opts?: { scrollback?: number }): string {
    return this._ingest
  }
  whenPrimaryScreen(callback: () => void): OrcaDisposable {
    return schedulePrimaryScreenCallback(
      this.isAlternateScreen,
      this.primaryScreenWaiters,
      callback
    )
  }
  applyMetrics(): void {
    const cells = measureCellSize(this.options)
    this.cellWidth = cells.width
    this.cellHeight = cells.height
    this.resize(this.cols, this.rows)
  }
  hyperlinkAt(_clientX: number, _clientY: number): string | null {
    return null
  }
  get isDisposed(): boolean {
    return this._disposed
  }
  loseGpuContext(): void {}
  invalidateGpuAtlas(): void {}
  isGpuContextLost(): boolean {
    return false
  }
  bindPty(sessionId: string): void {
    if (this.boundSessionId === sessionId) {
      return
    }
    this.boundSessionId = sessionId
    attachHorcaGhosttyPassthruPane(sessionId, this.slot)
  }
  dispose(): void {
    this._disposed = true
    if (this.boundSessionId) {
      detachHorcaGhosttyPassthruPane(this.slot)
      this.boundSessionId = null
    }
    this.chrome.dispose()
    this.primaryScreenWaiters.clear()
  }
}
