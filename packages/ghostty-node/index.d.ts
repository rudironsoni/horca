export type GhosttyTerminalOptions = {
  cols?: number
  rows?: number
  scrollbackLimit?: number
  onReply?: (data: Buffer) => void
  onTitleChanged?: (title: Buffer | null) => void
  onPwdChanged?: (pwd: Buffer | null) => void
}

export type GhosttySnapshot = {
  vt?: string
  cursor?: { x: number; y: number }
  cols?: number
  rows?: number
  alternateScreen?: boolean
  scrollbar?: { offset: number; len: number }
}

export type GhosttyTerminal = {
  feed(data: Buffer): void
  resize(cols: number, rows: number): void
  snapshot(): GhosttySnapshot
  dispose(): void
}

export declare function createTerminal(opts?: GhosttyTerminalOptions): GhosttyTerminal

export declare function getNativeInfo(): {
  platform: string
  arch: string
}
