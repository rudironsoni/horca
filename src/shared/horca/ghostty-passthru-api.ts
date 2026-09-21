export const HORCA_GHOSTTY_PASSTHRU_CHANNELS = {
  attach: 'horca:ghostty-passthru:attach',
  detach: 'horca:ghostty-passthru:detach'
} as const

export type HorcaGhosttyPassthruAttachPayload = {
  sessionId: string
  slot: string
}

export type HorcaGhosttyPassthruApi = {
  attach(payload: HorcaGhosttyPassthruAttachPayload): Promise<boolean>
  detach(slot: string): Promise<void>
}
