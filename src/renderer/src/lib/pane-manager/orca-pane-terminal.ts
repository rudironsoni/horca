import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { readScrollbar } from '../../../../ghostty-vt/ghostty-terminal-ops'
import type { OrcaDisposable, OrcaTerminalGrid } from '../../../../shared/orca-terminal-surface'
import {
  measureCellSize,
  resolveOrcaPaneAppearance,
  type OrcaPaneAppearance
} from './orca-pane-appearance'
import {
  createOrcaPaneBuffer,
  createOrcaPaneParser,
  flushWaiters,
  notifyTitleListeners,
  orcaPaneModes,
  schedulePrimaryScreenCallback,
  trackListener
} from './orca-pane-buffer'
import { applyOrcaPaneRendererMetrics } from './orca-pane-ghostty-appearance'
import { createOrcaPaneSurface } from './orca-pane-surface'
import { bindOrcaPaneHostChrome, type OrcaPaneHostChrome } from './orca-pane-host-chrome'
import { syncOrcaPaneMouseReportingClass } from './orca-pane-wheel'
import { createPaintScheduler, refreshOrcaPanePaint } from './orca-pane-paint'
import * as paneIo from './orca-pane-terminal-io'
import { findOrcaPane, scrollOrcaPane } from './orca-pane-viewport-nav'
import { OrcaPaneListenerHub } from './orca-pane-terminal-events'

export type { OrcaPaneAppearance } from './orca-pane-appearance'
export class OrcaPaneTerminal extends OrcaPaneListenerHub {
  readonly element: HTMLCanvasElement
  readonly textarea: HTMLTextAreaElement
  readonly options: OrcaPaneAppearance
  readonly parser: ReturnType<typeof createOrcaPaneParser>
  private readonly engine: GhosttyTerminal
  private readonly renderer: ReturnType<typeof createOrcaPaneSurface>['renderer']
  private readonly measureRoot: HTMLElement
  private readonly primaryScreenWaiters = new Set<() => void>()
  private chrome: OrcaPaneHostChrome
  cellWidth: number
  cellHeight: number
  private unbindInput = (): void => undefined
  private readonly paintScheduler = createPaintScheduler(() => {
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
    this.renderer.draw(this.engine, dpr)
    for (const listener of this.renderListeners) {
      listener()
    }
  })
  constructor(measureRoot: HTMLElement, appearance: Partial<OrcaPaneAppearance> = {}) {
    super()
    this.options = resolveOrcaPaneAppearance(appearance)
    this.measureRoot = measureRoot
    const surface = createOrcaPaneSurface(this.options)
    this.element = surface.canvas
    this.textarea = surface.textarea
    this.engine = surface.engine
    this.renderer = surface.renderer
    this.cellWidth = surface.cellWidth
    this.cellHeight = surface.cellHeight
    this.parser = createOrcaPaneParser()
    this.unbindInput = paneIo.bindOrcaPaneSession(
      this,
      {
        customKeyHandler: () => this.customKeyHandler,
        onSelectionChange: () => paneIo.notifySelectionListeners(this.selectionListeners)
      },
      this.engine
    )
    this.chrome = bindOrcaPaneHostChrome(this.element, this.measureRoot, this.engine, (delta) =>
      this.scrollLines(delta)
    )
    surface.bindRefresh(() => this.refresh())
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
  get title(): string {
    return this.engine.title
  }
  readViewportText(): string {
    return this.engine.readViewportText()
  }
  get buffer(): { active: OrcaTerminalGrid } {
    return createOrcaPaneBuffer(
      this.engine,
      () => this.baseY,
      () => this.viewportY
    )
  }
  get cursor(): { x: number; y: number } {
    return this.engine.cursor
  }
  get viewportY(): number {
    return readScrollbar(this.engine).offset
  }
  get baseY(): number {
    const bar = readScrollbar(this.engine)
    return Math.max(0, bar.total - bar.len)
  }
  write(data: string | Uint8Array, onDone?: () => void): void {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const title = this.engine.title
    this.engine.writePtyOutput(this.parser.consume(text))
    this.chrome.write(text)
    this.refresh()
    notifyTitleListeners(title, this.engine.title, this.titleListeners)
    flushWaiters(this.isAlternateScreen, this.primaryScreenWaiters)
    onDone?.()
  }
  get modes(): ReturnType<typeof orcaPaneModes> {
    return orcaPaneModes(this.engine)
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

  onTitleChange(listener: (title: string) => void): OrcaDisposable {
    listener(this.engine.title)
    return trackListener(this.titleListeners, listener)
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
    this.engine.resize({ cols, rows, cellWidthPx: this.cellWidth, cellHeightPx: this.cellHeight })
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
    refreshOrcaPanePaint(this.paintScheduler, this.textarea)
    this.chrome.sync()
    syncOrcaPaneMouseReportingClass(this.element, this.engine.mouseTracking)
  }
  focus(): void {
    this.textarea.focus()
  }
  blur(): void {
    this.textarea.blur()
  }
  clearSelection(): void {
    paneIo.clearSelectionOnGhostty(this.engine)
    this.refresh()
    paneIo.notifySelectionListeners(this.selectionListeners)
  }
  setPreedit(text: string): void {
    this.renderer.setPreedit(text)
    this.paintScheduler.flush()
  }
  selectAll(): void {
    paneIo.selectAllOnGhostty(this.engine)
    this.refresh()
    paneIo.notifySelectionListeners(this.selectionListeners)
  }
  paste(text: string): void {
    this.input(paneIo.pasteIntoGhostty(this.engine, text))
  }
  getSelection(): string {
    return this.engine.readSelection()
  }
  scrollToTop(): void {
    scrollOrcaPane(this.engine, () => this.refresh(), 'TOP')
  }
  scrollToBottom(): void {
    scrollOrcaPane(this.engine, () => this.refresh(), 'BOTTOM')
  }
  scrollToLine(line: number): void {
    scrollOrcaPane(this.engine, () => this.refresh(), 'ROW', line)
  }
  scrollLines(delta: number): void {
    scrollOrcaPane(this.engine, () => this.refresh(), 'DELTA', delta)
  }
  encodeKey(event: KeyboardEvent): string {
    return paneIo.encodeGhosttyKey(this.engine, event)
  }
  encodeMouse(event: MouseEvent & { deltaY?: number }): string {
    const rect = this.element.getBoundingClientRect()
    return paneIo.encodeGhosttyMouse(this.engine, event, {
      left: rect.left,
      top: rect.top,
      cellWidth: this.cellWidth,
      cellHeight: this.cellHeight,
      cols: this.cols,
      rows: this.rows
    })
  }
  findNext(query: string, _options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    return findOrcaPane(this.engine, () => this.refresh(), query, 'next')
  }
  findPrevious(query: string, _options?: { caseSensitive?: boolean; regex?: boolean }): boolean {
    return findOrcaPane(this.engine, () => this.refresh(), query, 'previous')
  }
  serialize(_opts?: { scrollback?: number }): string {
    return this.engine.readVt()
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
    applyOrcaPaneRendererMetrics(this.renderer, this.options, cells)
    this.resize(this.cols, this.rows)
  }
  hyperlinkAt(clientX: number, clientY: number): string | null {
    return paneIo.hitTestGhosttyHyperlink(
      this.engine,
      this.element,
      this.cellWidth,
      this.cellHeight,
      clientX,
      clientY
    )
  }
  get isDisposed(): boolean {
    return this.engine.isDisposed
  }
  loseGpuContext(): void {
    this.renderer.loseContext()
  }
  invalidateGpuAtlas(): void {
    this.renderer.invalidate()
  }
  isGpuContextLost(): boolean {
    return this.renderer.isContextLost()
  }
  dispose(): void {
    this.unbindInput()
    this.chrome.dispose()
    this.paintScheduler.dispose()
    this.primaryScreenWaiters.clear()
    this.renderer.dispose()
    this.engine.dispose()
  }
}
