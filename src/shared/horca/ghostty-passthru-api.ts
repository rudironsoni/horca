export const HORCA_GHOSTTY_PASSTHRU_CHANNELS = {
  attach: 'horca:ghostty-passthru:attach',
  detach: 'horca:ghostty-passthru:detach',
  readSelection: 'horca:ghostty-passthru:read-selection',
  clearScreen: 'horca:ghostty-passthru:clear-screen'
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
}
