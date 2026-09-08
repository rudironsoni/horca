import type { ManagedPane } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'

/**
 * Why: when devicePixelRatio changes while a pane is hidden (window moved
 * between retina/non-retina displays, then the worktree revealed), terminal's
 * WebGL renderer re-measures cell dimensions but its canvas keeps the old
 * backing-store size — the addon's own device-pixel observer misses changes
 * that land while the element has no box. The browser then composites the
 * stale-scale bitmap into the css box: half/double-size or smeared text until
 * a real resize. Proven live: backing 2160 px for a 1080 css box at dpr 1.
 * The repair is terminal's own resize path, which recomputes device dimensions
 * at the current dpr and resizes the canvas backing store.
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
  const staleBackingWidth = canvas.width
  const staleBackingHeight = canvas.height
  const cachedDevicePixelRatio = renderer._devicePixelRatio
  const devicePixelRatioChanged =
    typeof cachedDevicePixelRatio === 'number' && cachedDevicePixelRatio !== view.devicePixelRatio
  // terminal rounds its CSS canvas size before ResizeObserver converts it back to
  // device pixels; allow that round trip without forcing layout on every fit.
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
