export type TerminalScrollBufferType = 'normal' | 'alternate'

export type TerminalScrollBufferTarget = {
  isAlternateScreen?: boolean
  viewportY?: number
  baseY?: number
  buffer?: { active?: { viewportY?: number; baseY?: number } }
}

export type TerminalScrollBufferSnapshot = {
  bufferType: TerminalScrollBufferType
  viewportY: number
  baseY: number
}

export function readTerminalScrollBufferSnapshot(
  terminal: TerminalScrollBufferTarget
): TerminalScrollBufferSnapshot | null {
  const viewportY = terminal.viewportY ?? terminal.buffer?.active?.viewportY
  const baseY = terminal.baseY ?? terminal.buffer?.active?.baseY
  if (typeof viewportY !== 'number' || typeof baseY !== 'number') {
    return null
  }
  return {
    bufferType: terminal.isAlternateScreen ? 'alternate' : 'normal',
    viewportY,
    baseY
  }
}

export function isTerminalViewportAtBottom(viewportY: number, baseY: number): boolean {
  return viewportY >= baseY
}

export function clampTerminalViewportY(viewportY: number, baseY: number): number {
  return Math.max(0, Math.min(viewportY, baseY))
}

export function safeTerminalScrollCall(scroll: () => void): boolean {
  try {
    scroll()
    return true
  } catch (err) {
    if (err instanceof TypeError && /dimensions/.test(err.message)) {
      return false
    }
    throw err
  }
}
