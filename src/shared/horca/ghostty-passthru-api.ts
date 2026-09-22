export const HORCA_GHOSTTY_PASSTHRU_CHANNELS = {
  attach: 'horca:ghostty-passthru:attach',
  detach: 'horca:ghostty-passthru:detach',
  readSelection: 'horca:ghostty-passthru:read-selection'
} as const

export type HorcaGhosttyPassthruAttachPayload = {
  sessionId: string
  slot: string
}

export type HorcaGhosttyPassthruApi = {
  attach(payload: HorcaGhosttyPassthruAttachPayload): Promise<boolean>
  detach(slot: string): Promise<void>
  readSelection(slot: string): string
}
