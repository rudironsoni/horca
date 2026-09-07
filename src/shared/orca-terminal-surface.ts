export type OrcaDisposable = { dispose: () => void }
export type IDisposable = OrcaDisposable

export type IBufferRange = {
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export type IBufferCell = {
  getChars: () => string
  getWidth: () => number
  isBold: () => boolean
  isDim: () => boolean
  isFgDefault: () => boolean
}

export type IBufferLine = {
  length: number
  isWrapped: boolean
  translateToString: (trimRight?: boolean, startCol?: number, endCol?: number) => string
  getCell: (column: number) => IBufferCell | undefined
}

export type IBuffer = {
  cursorX: number
  cursorY: number
  baseY: number
  length?: number
  viewportY: number
  type?: 'normal' | 'alternate'
  getLine: (y: number) => IBufferLine | undefined
}

export type ILink = {
  range: IBufferRange
  text?: string
  activate?: (event: MouseEvent, text: string) => void
  hover?: (event: MouseEvent, text: string) => void
  leave?: (event: MouseEvent, text: string) => void
}

export type ILinkProvider = {
  provideLinks: (bufferLineNumber: number, callback: (links?: ILink[]) => void) => void
}

export type IParser = {
  registerCsiHandler: (
    id: { final: string },
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
  buffer?: { active: IBuffer }
  parser?: IParser
  registerLinkProvider?: (provider: ILinkProvider) => OrcaDisposable
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
