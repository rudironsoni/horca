export const HORCA_GHOSTTY_PASSTHRU_CHANNELS = {
  attach: 'horca:ghostty-passthru:attach',
  detach: 'horca:ghostty-passthru:detach',
  readSelection: 'horca:ghostty-passthru:read-selection',
  clearScreen: 'horca:ghostty-passthru:clear-screen',
  scroll: 'horca:ghostty-passthru:scroll',
  selectAll: 'horca:ghostty-passthru:select-all',
  search: 'horca:ghostty-passthru:search',
  hyperlinkAt: 'horca:ghostty-passthru:hyperlink-at'
} as const

export type HorcaGhosttyPassthruAttachPayload = {
  sessionId: string
  slot: string
}

export type HorcaGhosttyPassthruApi = {
  attach(payload: HorcaGhosttyPassthruAttachPayload): Promise<boolean>
  detach(slot: string): Promise<void>
  readSelection(slot: string): string
  pasteText(slot: string, text: string): void
  clearScreen(slot: string): void
  scroll(slot: string, dy: number): void
  selectAll(slot: string): void
  search(slot: string, needle: string, direction?: 'next' | 'previous'): boolean
  hyperlinkAt(slot: string, x: number, y: number): string
}
