import type { HorcaGhosttyPassthruApi } from '../../../../shared/horca/ghostty-passthru-api'

function passthruApi(): HorcaGhosttyPassthruApi | null {
  if (typeof window === 'undefined') {
    return null
  }
  const api = window.api as { horcaGhosttyPassthru?: HorcaGhosttyPassthruApi } | undefined
  return api?.horcaGhosttyPassthru ?? null
}

export function attachHorcaGhosttyPassthruPane(sessionId: string, slot: string): void {
  void passthruApi()?.attach({ sessionId, slot })
}

export function detachHorcaGhosttyPassthruPane(slot: string): void {
  void passthruApi()?.detach(slot)
}

export function readHorcaGhosttySelection(slot: string): string {
  return passthruApi()?.readSelection(slot) ?? ''
}

export function sendHorcaGhosttyText(slot: string, text: string): void {
  passthruApi()?.pasteText(slot, text)
}

export function clearHorcaGhosttyScreen(slot: string): void {
  passthruApi()?.clearScreen(slot)
}

export function scrollHorcaGhosttyViewport(slot: string, dy: number): void {
  passthruApi()?.scroll(slot, dy)
}

export function selectAllHorcaGhostty(slot: string): void {
  passthruApi()?.selectAll(slot)
}

export function searchHorcaGhostty(
  slot: string,
  needle: string,
  direction?: 'next' | 'previous'
): boolean {
  return passthruApi()?.search(slot, needle, direction) ?? false
}

export function hyperlinkAtHorcaGhostty(slot: string, x: number, y: number): string {
  return passthruApi()?.hyperlinkAt(slot, x, y) ?? ''
}
