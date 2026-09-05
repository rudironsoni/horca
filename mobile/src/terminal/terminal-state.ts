import type { RuntimeMobileTerminalTheme } from '../../../src/shared/runtime-types'

export type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any'

export type TerminalModes = {
  bracketedPasteMode: boolean
  altScreen: boolean
  mouseTrackingMode: TerminalMouseTrackingMode
  sgrMouseMode: boolean
  sgrMousePixelsMode: boolean
}

export type TerminalKeyboardAvoidanceMetrics = {
  cursorY: number
  contentBottomRow: number
  rows: number
  altScreen: boolean
}

export function parseTerminalKeyboardAvoidanceMetrics(
  candidate: Record<string, unknown>
): TerminalKeyboardAvoidanceMetrics {
  const rows = toNonNegativeInteger(candidate.rows)
  const maxRow = Math.max(0, rows - 1)
  const cursorY = Math.min(toNonNegativeInteger(candidate.cursorY), maxRow)
  return {
    cursorY,
    contentBottomRow:
      candidate.contentBottomRow === undefined
        ? cursorY
        : Math.min(toNonNegativeInteger(candidate.contentBottomRow), maxRow),
    rows,
    altScreen: candidate.altScreen === true
  }
}

function toNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

export type MobileTerminalTheme = RuntimeMobileTerminalTheme
