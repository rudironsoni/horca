import { readScrollbar, scrollViewport } from '../../../../ghostty-vt/ghostty-scroll'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import type {
  IBuffer,
  ILinkProvider,
  OrcaDisposable
} from '../../../../shared/orca-terminal-surface'
import {
  measureCellSize,
  resolveOrcaPaneAppearance,
  type OrcaPaneAppearance
} from './orca-pane-appearance'
import {
  createOrcaPaneBuffer,
  createOrcaPaneParser,
  flushWaiters,
  noopDisposable
} from './orca-pane-buffer'
import { registerOrcaPaneLinkProvider } from './orca-pane-links'
import { createOrcaPaneSurface } from './orca-pane-surface'
import {
  bindOrcaPaneSession,
  clearSelectionOnGhostty,
  encodeGhosttyKey,
  encodeGhosttyMouse,
  findGhosttyNext,
  findGhosttyPrevious,
  hitTestGhosttyHyperlink,
  notifySelectionListeners,
  pasteIntoGhostty,
  selectAllOnGhostty
} from './orca-pane-terminal-io'

export type { OrcaPaneAppearance } from './orca-pane-appearance'
export class OrcaPaneTerminal {
  readonly element: HTMLCanvasElement
  readonly options: OrcaPaneAppearance
  readonly parser: ReturnType<typeof createOrcaPaneParser>
  readonly engine: GhosttyTerminal
  readonly linkProviders = new Set<ILinkProvider>()
  private readonly renderer: ReturnType<typeof createOrcaPaneSurface>['renderer']
  private readonly measureRoot: HTMLElement
  private readonly dataListeners = new Set<(data: string) => void>()
  private readonly renderListeners = new Set<() => void>()
  private readonly resizeListeners = new Set<(size: { cols: number; rows: number }) => void>()
  private readonly selectionListeners = new Set<() => void>()
  private readonly primaryScreenWaiters = new Set<() => void>()
  private customKeyHandler: ((event: KeyboardEvent) => boolean) | null = null
  cellWidth: number
  cellHeight: number
  private unbindInput = (): void => undefined
  constructor(measureRoot: HTMLElement, appearance: Partial<OrcaPaneAppearance> = {}) {
    this.options = resolveOrcaPaneAppearance(appearance)
    this.measureRoot = measureRoot
    const surface = createOrcaPaneSurface(this.options)
    this.element = surface.canvas
    this.engine = surface.engine
    this.renderer = surface.renderer
    this.cellWidth = surface.cellWidth
    this.cellHeight = surface.cellHeight
    this.parser = createOrcaPaneParser()
    this.unbindInput = bindOrcaPaneSession(this, {
      customKeyHandler: () => this.customKeyHandler,
      onSelectionChange: () => notifySelectionListeners(this.selectionListeners)
    })
  }

  get cols(): number {
    return this.engine.cols
  }
  get rows(): number {
    return this.engine.rows
  }
  get isAlternateScreen(): boolean {
    return this.engine.isAlternateScreen
  }

  get buffer(): { active: IBuffer } {
    return createOrcaPaneBuffer(this.engine, () => this.baseY)
  }
  write(data: string | Uint8Array, onDone?: () => void): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    this.engine.writePtyOutput(this.parser.consume(text))
    this.refresh()
    flushWaiters(this.isAlternateScreen, this.primaryScreenWaiters)
    onDone?.()
  }

  get cursor(): { x: number; y: number } {
    return this.engine.cursor
  }
  get viewportY(): number {
    return readScrollbar(...this.vt()).offset
  }

  get baseY(): number {
    const bar = readScrollbar(...this.vt())
    return Math.max(0, bar.total - bar.len)
  }

  get modes(): {
    bracketedPasteMode: boolean
    mouseTrackingMode: 'none' | 'on'
    sendFocusMode: boolean
    showCursor: boolean
  } {
    return {
      bracketedPasteMode: this.engine.getMode(2004),
      mouseTrackingMode: this.engine.mouseTracking ? 'on' : 'none',
      sendFocusMode: this.engine.getMode(1004),
      showCursor: this.engine.getMode(25)
    }
  }

  reset(): void {
    this.engine.reset()
    this.refresh()
  }
  clear(): void {
    this.engine.writePtyOutput('\x1b[2J\x1b[3J\x1b[H')
    this.refresh()
  }

  input(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data)
    }
  }

  onData(listener: (data: string) => void): OrcaDisposable {
    this.dataListeners.add(listener)
    return { dispose: () => this.dataListeners.delete(listener) }
  }

  onResize(listener: (size: { cols: number; rows: number }) => void): OrcaDisposable {
    this.resizeListeners.add(listener)
    return { dispose: () => this.resizeListeners.delete(listener) }
  }
  onRender(listener: () => void): OrcaDisposable {
    this.renderListeners.add(listener)
    return { dispose: () => this.renderListeners.delete(listener) }
  }
  onTitleChange(listener: (title: string) => void): OrcaDisposable {
    listener(this.engine.title)
    return noopDisposable()
  }
  onSelectionChange(listener: () => void): OrcaDisposable {
    this.selectionListeners.add(listener)
    return { dispose: () => this.selectionListeners.delete(listener) }
  }
  onWriteParsed(listener: () => void): OrcaDisposable {
    return this.onData(() => listener())
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.customKeyHandler = handler
  }
  registerLinkProvider(provider: ILinkProvider): OrcaDisposable {
    return registerOrcaPaneLinkProvider(this.linkProviders, provider)
  }
  registerCharacterJoiner(_handler: (text: string) => number[][]): number {
    return 0
  }
  deregisterCharacterJoiner(_id: number): void {}

  hasSelection(): boolean {
    return this.getSelection().length > 0
  }
  getSelectionPosition():
    | { start: { x: number; y: number }; end: { x: number; y: number } }
    | undefined {
    return undefined
  }

  resize(cols: number, rows: number): void {
    this.engine.resize({ cols, rows, cellWidthPx: this.cellWidth, cellHeightPx: this.cellHeight })
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
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    this.renderer.draw(this.engine, dpr)
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
    clearSelectionOnGhostty(this.engine)
    this.refresh()
    notifySelectionListeners(this.selectionListeners)
  }

  setPreedit(text: string): void {
    this.renderer.setPreedit(text)
    this.refresh()
  }
  selectAll(): void {
    selectAllOnGhostty(this.engine)
    this.refresh()
    notifySelectionListeners(this.selectionListeners)
  }

  paste(text: string): void {
    this.input(pasteIntoGhostty(this.engine, text))
  }

  getSelection(): string {
    return this.engine.readSelection()
  }

  scrollToTop(): void {
    scrollViewport(...this.vt(), 'TOP')
    this.refresh()
  }
  scrollToBottom(): void {
    scrollViewport(...this.vt(), 'BOTTOM')
    this.refresh()
  }
  scrollToLine(line: number): void {
    scrollViewport(...this.vt(), 'ROW', line)
    this.refresh()
  }

  encodeKey(event: KeyboardEvent): string {
    return encodeGhosttyKey(this.engine, event)
  }
  encodeMouse(event: MouseEvent): string {
    const rect = this.element.getBoundingClientRect()
    return encodeGhosttyMouse(this.engine, event, {
      left: rect.left,
      top: rect.top,
      cellWidth: this.cellWidth,
      cellHeight: this.cellHeight,
      cols: this.cols,
      rows: this.rows
    })
  }

  findNext(query: string, _options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    const hit = findGhosttyNext(this.engine, query)
    if (hit) {
      this.refresh()
    }
    return hit
  }

  findPrevious(query: string, _options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    const hit = findGhosttyPrevious(this.engine, query)
    if (hit) {
      this.refresh()
    }
    return hit
  }

  serialize(_opts?: { scrollback?: number }): string {
    return this.engine.readVt()
  }

  whenPrimaryScreen(callback: () => void): OrcaDisposable {
    if (!this.isAlternateScreen) {
      callback()
      return noopDisposable()
    }
    this.primaryScreenWaiters.add(callback)
    return { dispose: () => this.primaryScreenWaiters.delete(callback) }
  }

  applyMetrics(): void {
    const cells = measureCellSize(this.options)
    this.cellWidth = cells.width
    this.cellHeight = cells.height
    this.resize(this.cols, this.rows)
  }
  hyperlinkAt(clientX: number, clientY: number): string | null {
    return hitTestGhosttyHyperlink(
      this.engine,
      this.element,
      this.cellWidth,
      this.cellHeight,
      clientX,
      clientY
    )
  }
  dispose(): void {
    this.unbindInput()
    this.primaryScreenWaiters.clear()
    this.renderer.dispose()
    this.engine.dispose()
  }
  private vt(): [ReturnType<GhosttyTerminal['hostHandle']>['host'], number] {
    const handle = this.engine.hostHandle()
    return [handle.host, handle.term]
  }
}
