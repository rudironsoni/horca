export type OrcaDisposable = { dispose: () => void }
export type IDisposable = OrcaDisposable

export type IBufferRange = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export type OrcaTerminalCell = {
  getChars: () => string
  getWidth: () => number
  isBold: () => boolean
  isDim: () => boolean
  isFgDefault: () => boolean
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
  type?: 'normal' | 'alternate'
  getLine: (y: number) => OrcaTerminalLine | undefined
}

export type OrcaLink = {
  range: IBufferRange
  text?: string
  activate?: (event: MouseEvent, text: string) => void
  hover?: (event: MouseEvent, text: string) => void
  leave?: (event: MouseEvent, text: string) => void
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
  options?: {
    theme?: ITheme
    fontFamily?: string
    fontSize?: number
    scrollback?: number
    mouseEventsRequireAlt?: boolean
    ignoreBracketedPasteMode?: boolean
  }
  buffer?: { active: OrcaTerminalGrid }
  parser?: IParser
  addLinkProvider?: (provider: OrcaLinkProvider) => OrcaDisposable
  registerLinkProvider?: (provider: OrcaLinkProvider) => OrcaDisposable
  clearSelection?: () => void
  hasSelection?: () => boolean
}

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
