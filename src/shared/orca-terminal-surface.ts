export type OrcaDisposable = { dispose: () => void }
export type IDisposable = OrcaDisposable

type Fn<A extends unknown[], R = void> = {
  bivarianceHack(...args: A): R
}['bivarianceHack']

export type IBufferRange = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export type OrcaTerminalCell = {
  getChars: () => string
  getWidth: () => number
  isBold: () => boolean | number
  isDim: () => boolean | number
  isFgDefault: () => boolean | number
  getCode?: () => number
}

export type OrcaTerminalLine = {
  length: number
  isWrapped: boolean
  translateToString: (trimRight?: boolean, startCol?: number, endCol?: number) => string
  getCell: (column: number) => OrcaTerminalCell | undefined
}

export type OrcaTerminalGrid = {
  cursorX: number
  cursorY: number
  baseY: number
  length?: number
  viewportY: number
  type: 'normal' | 'alternate'
  getLine: (y: number) => OrcaTerminalLine | undefined
}

export type OrcaLink = {
  range: IBufferRange
  text?: string
  activate?: Fn<[event: MouseEvent, text: string, range?: IBufferRange]>
  hover?: Fn<[event: MouseEvent, text: string]>
  leave?: Fn<[event: MouseEvent, text: string]>
}

export type OrcaLinkProvider = {
  provideLinks: (bufferLineNumber: number, callback: (links?: OrcaLink[]) => void) => void
}

export type IBufferCell = OrcaTerminalCell
export type IBufferLine = OrcaTerminalLine
export type IBuffer = OrcaTerminalGrid
export type ILink = OrcaLink
export type ILinkProvider = OrcaLinkProvider

export type IParser = {
  registerCsiHandler: (
    id: { prefix?: string; final: string },
    handler: (params: (number | number[])[]) => boolean
  ) => OrcaDisposable
  registerOscHandler: (ident: number, handler: (data: string) => boolean) => OrcaDisposable
}

export type Terminal = {
  cols: number
  rows: number
  element?: HTMLElement
  textarea?: HTMLTextAreaElement
  options: ITerminalOptions
  buffer: { active: OrcaTerminalGrid }
  parser: IParser
  modes: {
    bracketedPasteMode?: boolean
    mouseTrackingMode?: string
    originMode?: boolean
    sendFocusMode?: boolean
    showCursor?: boolean
  }
  unicode?: { activeVersion?: string }
  write: Fn<[data: string | Uint8Array, onDone?: () => void]>
  input: Fn<[data: string]>
  paste: Fn<[text: string]>
  focus: Fn<[]>
  blur: Fn<[]>
  dispose: Fn<[]>
  resize: Fn<[cols: number, rows: number]>
  refresh: Fn<[start?: number, end?: number]>
  reset?: Fn<[]>
  loadAddon?: Fn<[addon: unknown]>
  open?: Fn<[element: HTMLElement]>
  attachCustomKeyEventHandler?: Fn<[handler: (event: KeyboardEvent) => boolean]>
  attachCustomWheelEventHandler?: Fn<[handler: (event: WheelEvent) => boolean]>
  addLinkProvider?: Fn<[provider: OrcaLinkProvider], OrcaDisposable>
  registerLinkProvider?: Fn<[provider: OrcaLinkProvider], OrcaDisposable>
  registerMarker?: Fn<
    [y?: number],
    { dispose: () => void; isDisposed?: boolean; line?: number } | undefined
  >
  registerCharacterJoiner?: Fn<[handler: (text: string) => [number, number][]], number>
  deregisterCharacterJoiner?: Fn<[id: number]>
  getSelectionPosition?: Fn<[], IBufferRange | undefined>
  onWriteParsed?: Fn<[listener: () => void], OrcaDisposable>
  clearSelection: Fn<[]>
  hasSelection: Fn<[], boolean>
  getSelection: Fn<[], string>
  selectAll: Fn<[]>
  scrollToBottom: Fn<[]>
  scrollToTop?: Fn<[]>
  scrollToLine: Fn<[line: number]>
  scrollLines?: Fn<[n: number]>
  onData: Fn<[listener: (data: string) => void], OrcaDisposable>
  onResize: Fn<[listener: (size: { cols: number; rows: number }) => void], OrcaDisposable>
  onSelectionChange: Fn<[listener: () => void], OrcaDisposable>
  onTitleChange: Fn<[listener: (title: string) => void], OrcaDisposable>
  onRender: Fn<[listener: () => void], OrcaDisposable>
}

export type ITerminalOptions = {
  allowProposedApi?: boolean
  cursorBlink?: boolean
  cursorStyle?: string
  cursorInactiveStyle?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string | number
  fontWeightBold?: string | number
  lineHeight?: number
  scrollback?: number
  scrollSensitivity?: number
  fastScrollSensitivity?: number
  allowTransparency?: boolean
  minimumContrastRatio?: number
  macOptionIsMeta?: boolean
  macOptionClickForcesSelection?: boolean
  mouseEventsRequireAlt?: boolean
  ignoreBracketedPasteMode?: boolean
  drawBoldTextInBrightColors?: boolean
  wordSeparator?: string
  theme?: ITheme
  scrollbar?: { width?: number }
  vtExtensions?: { kittyKeyboard?: boolean }
  cols?: number
  rows?: number
  disableStdin?: boolean
  windowsPty?: { backend?: 'conpty' | 'winpty'; buildNumber?: number }
  reflowCursorLine?: boolean
  linkHandler?: object | null
}
export type ITerminalInitOnlyOptions = ITerminalOptions

export type ITheme = {
  foreground?: string
  background?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  selectionForeground?: string
  selectionInactiveBackground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
  extendedAnsi?: string[]
  overviewRulerBorder?: string
  scrollbarSliderBackground?: string
  scrollbarSliderHoverBackground?: string
  scrollbarSliderActiveBackground?: string
}
