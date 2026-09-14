import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'

/**
 * Why: when devicePixelRatio changes while a pane is hidden, the Ghostty
 * canvas backing store can keep the old size until the next paint. Repair
 * is the public refresh path, which resizes from cols × cell × current dpr.
 */
export type PaneWebglCanvasDprRepairState = 'current' | 'deferred' | 'repaired'

type CanvasBacking = {
  width: number
  height: number
  isConnected: boolean
  ownerDocument?: { defaultView?: { devicePixelRatio: number } | null } | null
}

function isCanvasBacking(value: unknown): value is CanvasBacking {
  return (
    typeof value === 'object' &&
    value !== null &&
    'width' in value &&
    typeof value.width === 'number' &&
    'height' in value &&
    typeof value.height === 'number' &&
    'isConnected' in value &&
    typeof value.isConnected === 'boolean'
  )
}

export function repairPaneWebglCanvasDpr(pane: ManagedPane): PaneWebglCanvasDprRepairState {
  const canvas = isCanvasBacking(pane.terminal.element) ? pane.terminal.element : null
  if (!canvas) {
    return 'current'
  }
  if (!canvas.isConnected) {
    return 'deferred'
  }
  const view = canvas.ownerDocument?.defaultView
  const cols = pane.terminal.cols
  const rows = pane.terminal.rows
  const cellWidth = pane.terminal.cellWidth
  const cellHeight = pane.terminal.cellHeight
  if (!view || cols <= 0 || rows <= 0 || cellWidth <= 0 || cellHeight <= 0) {
    return 'deferred'
  }
  const expectedWidth = Math.max(1, Math.floor(cols * cellWidth * view.devicePixelRatio))
  const expectedHeight = Math.max(1, Math.floor(rows * cellHeight * view.devicePixelRatio))
  const roundingTolerance = Math.max(1, Math.ceil(view.devicePixelRatio / 2))
  const staleBackingWidth = canvas.width
  if (
    Math.abs(staleBackingWidth - expectedWidth) <= roundingTolerance &&
    Math.abs(canvas.height - expectedHeight) <= roundingTolerance
  ) {
    return 'current'
  }
  try {
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  } catch {
    return 'deferred'
  }
  recordTerminalWebglDiagnostic('webgl-canvas-dpr-repair', {
    paneId: pane.id,
    staleBackingWidth,
    expectedBackingWidth: expectedWidth,
    devicePixelRatio: view.devicePixelRatio
  })
  return 'repaired'
}

export function repairPaneWebglCanvasDprMismatch(pane: ManagedPane): boolean {
  return repairPaneWebglCanvasDpr(pane) === 'repaired'
}
