import type { ITheme, OrcaDisposable, OrcaLinkProvider, OrcaTerminalGrid } from '../../../../shared/orca-terminal-surface'

export type PaneTerminalSearchOptions = {
  caseSensitive?: boolean
  regex?: boolean
  wholeWord?: boolean
  incremental?: boolean
}

export type PaneTerminalSerializeOptions = {
  scrollback?: number
}

export type PaneTerminalOptions = {
  theme?: ITheme
  fontFamily?: string
  fontSize?: number
  fontWeight?: string | number
  fontWeightBold?: string | number
  lineHeight?: number
  scrollback?: number
  minimumContrastRatio?: number
  allowTransparency?: boolean
  cursorStyle?: string
  cursorInactiveStyle?: string
  cursorBlink?: boolean
  scrollSensitivity?: number
  fastScrollSensitivity?: number
  macOptionIsMeta?: boolean
  mouseEventsRequireAlt?: boolean
  ignoreBracketedPasteMode?: boolean
  screenReaderMode?: boolean
  linkHandler?: {
    activate: (event: MouseEvent, uri: string) => void
    hover?: (event: MouseEvent, uri: string) => void
    leave?: (event: MouseEvent, uri: string) => void
    allowNonHttpProtocols?: boolean
  }
}

export type PaneTerminal = {
  readonly cols: number
  readonly rows: number
  readonly element: HTMLElement | undefined
  readonly textarea?: HTMLTextAreaElement
  readonly slot?: string
  bindPty?: (sessionId: string) => void
  options: PaneTerminalOptions
  readonly buffer: { active: OrcaTerminalGrid }
  readonly modes: {
    bracketedPasteMode?: boolean
    mouseTrackingMode?: string
    sendFocusMode?: boolean
    showCursor?: boolean
  }
  readonly parser: {
    registerOscHandler: (
      ident: number,
      handler: (data: string) => boolean
    ) => OrcaDisposable
    registerCsiHandler: (
      id: { prefix?: string; final: string },
      handler: (params: (number | number[])[]) => boolean
    ) => OrcaDisposable
  }
  write: (data: string | Uint8Array, onDone?: () => void) => void
  input: (data: string) => void
  paste: (text: string) => void
  focus: () => void
  blur: () => void
  dispose: () => void
  resize: (cols: number, rows: number) => void
  refresh: (start?: number, end?: number) => void
  fit: () => void
  proposeDimensions: () => { cols: number; rows: number } | undefined | null
  serialize: (opts?: PaneTerminalSerializeOptions) => string
  findNext: (term: string, opts?: PaneTerminalSearchOptions) => boolean
  findPrevious: (term: string, opts?: PaneTerminalSearchOptions) => boolean
  clearSearch: () => void
  hasSelection: () => boolean
  getSelection: () => string
  clearSelection: () => void
  selectAll: () => void
  scrollToBottom: () => void
  scrollToLine: (line: number) => void
  registerLinkProvider: (provider: OrcaLinkProvider) => OrcaDisposable
  onResize: (listener: (size: { cols: number; rows: number }) => void) => OrcaDisposable
  onSelectionChange: (listener: () => void) => OrcaDisposable
  onData: (listener: (data: string) => void) => OrcaDisposable
  onTitleChange: (listener: (title: string) => void) => OrcaDisposable
  onRender: (listener: () => void) => OrcaDisposable
  attachCustomKeyEventHandler: (handler: (event: KeyboardEvent) => boolean) => void
}
