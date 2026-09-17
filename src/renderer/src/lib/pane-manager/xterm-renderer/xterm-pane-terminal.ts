import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import type { OrcaDisposable, OrcaLinkProvider } from '../../../../../shared/orca-terminal-surface'
import type {
  PaneTerminal,
  PaneTerminalSearchOptions,
  PaneTerminalSerializeOptions
} from '../pane-terminal'
import { registerXtermPaneState, unregisterXtermPaneState } from './xterm-pane-state'

export type XtermPaneTerminalOptions = {
  terminalOptions: ITerminalOptions
  onLinkClick?: (event: MouseEvent, uri: string) => void
  linkHover?: (uri: string) => void
  linkLeave?: () => void
}

export class XtermPaneTerminal implements PaneTerminal {
  private readonly term: Terminal
  private readonly fitAddon = new FitAddon()
  private readonly searchAddon = new SearchAddon()
  private readonly serializeAddon = new SerializeAddon()
  private readonly unicode11Addon = new Unicode11Addon()
  private readonly webLinksAddon: WebLinksAddon

  constructor(opts: XtermPaneTerminalOptions) {
    this.term = new Terminal(opts.terminalOptions)
    this.webLinksAddon = new WebLinksAddon(
      opts.onLinkClick,
      opts.linkHover || opts.linkLeave
        ? {
            hover: (_event: MouseEvent, uri: string) => opts.linkHover?.(uri),
            leave: () => opts.linkLeave?.()
          }
        : undefined
    )
    this.term.loadAddon(this.fitAddon)
    this.term.loadAddon(this.searchAddon)
    this.term.loadAddon(this.serializeAddon)
    this.term.loadAddon(this.unicode11Addon)
    this.term.loadAddon(this.webLinksAddon)
    registerXtermPaneState(this, {
      term: this.term,
      fitAddon: this.fitAddon,
      searchAddon: this.searchAddon,
      serializeAddon: this.serializeAddon,
      unicode11Addon: this.unicode11Addon,
      webLinksAddon: this.webLinksAddon,
      webglAddon: null,
      ligaturesAddon: null
    })
  }

  get cols(): number {
    return this.term.cols
  }
  get rows(): number {
    return this.term.rows
  }
  get element(): HTMLElement | undefined {
    return this.term.element
  }
  get textarea(): HTMLTextAreaElement | undefined {
    return this.term.textarea
  }
  get options(): PaneTerminal['options'] {
    return this.term.options as PaneTerminal['options']
  }
  set options(value: PaneTerminal['options']) {
    Object.assign(this.term.options, value)
  }
  get buffer(): PaneTerminal['buffer'] {
    return this.term.buffer as PaneTerminal['buffer']
  }
  get modes() {
    return this.term.modes
  }
  get parser() {
    return this.term.parser
  }

  write(data: string | Uint8Array, onDone?: () => void): void {
    this.term.write(data, onDone)
  }
  input(data: string): void {
    this.term.input(data)
  }
  focus(): void {
    this.term.focus()
  }
  blur(): void {
    this.term.blur()
  }
  dispose(): void {
    unregisterXtermPaneState(this)
    this.searchAddon.dispose()
    this.serializeAddon.dispose()
    this.unicode11Addon.dispose()
    this.webLinksAddon.dispose()
    this.fitAddon.dispose()
    this.term.dispose()
  }
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }
  refresh(start?: number, end?: number): void {
    this.term.refresh(start ?? 0, end ?? this.term.rows - 1)
  }
  fit(): void {
    this.fitAddon.fit()
  }
  proposeDimensions(): { cols: number; rows: number } | undefined | null {
    return this.fitAddon.proposeDimensions()
  }
  serialize(opts?: PaneTerminalSerializeOptions): string {
    return this.serializeAddon.serialize(opts)
  }
  findNext(term: string, opts?: PaneTerminalSearchOptions): boolean {
    return this.searchAddon.findNext(term, opts)
  }
  findPrevious(term: string, opts?: PaneTerminalSearchOptions): boolean {
    return this.searchAddon.findPrevious(term, opts)
  }
  clearSearch(): void {
    this.searchAddon.clearDecorations()
    this.searchAddon.findNext('')
  }
  hasSelection(): boolean {
    return this.term.hasSelection()
  }
  getSelection(): string {
    return this.term.getSelection()
  }
  clearSelection(): void {
    this.term.clearSelection()
  }
  selectAll(): void {
    this.term.selectAll()
  }
  scrollToBottom(): void {
    this.term.scrollToBottom()
  }
  scrollToLine(line: number): void {
    this.term.scrollToLine(line)
  }
  registerLinkProvider(provider: OrcaLinkProvider): OrcaDisposable {
    return this.term.registerLinkProvider(provider as Parameters<Terminal['registerLinkProvider']>[0])
  }
  onResize(listener: (size: { cols: number; rows: number }) => void): OrcaDisposable {
    return this.term.onResize(listener)
  }
  onSelectionChange(listener: () => void): OrcaDisposable {
    return this.term.onSelectionChange(listener)
  }
  onData(listener: (data: string) => void): OrcaDisposable {
    return this.term.onData(listener)
  }
  onTitleChange(listener: (title: string) => void): OrcaDisposable {
    return this.term.onTitleChange(listener)
  }
  onRender(listener: () => void): OrcaDisposable {
    return this.term.onRender(listener)
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
    this.term.attachCustomKeyEventHandler(handler)
  }
}
