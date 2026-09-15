import type { ManagedPaneInternal } from './pane-manager-types'
import {
  clearTerminalWebglAttachBackoff,
  disposeWebgl,
  refreshPaneRenderer
} from './pane-webgl-renderer'
import { canRetryPaneWebglAfterContextLoss } from './pane-webgl-context-loss-policy'

export function clearPaneWebglContextLossForRetry(pane: ManagedPaneInternal): boolean {
  if (!pane.webglDisabledAfterContextLoss) {
    return true
  }
  if (!canRetryPaneWebglAfterContextLoss(pane)) {
    return false
  }
  pane.webglDisabledAfterContextLoss = false
  return true
}

export function reattachWebglIfNeeded(pane: ManagedPaneInternal): void {
  if (pane.gpuRenderingEnabled && clearPaneWebglContextLossForRetry(pane)) {
    refreshPaneRenderer(pane)
  }
}

export function rebuildAttachedWebgl(pane: ManagedPaneInternal): void {
  if (!pane.gpuRenderer || pane.webglDisabledAfterContextLoss) {
    return
  }
  if (pane.webglAttachmentDeferred) {
    pane.webglRebuildDeferred = true
    return
  }
  pane.webglRebuildDeferred = false
  disposeWebgl(pane)
  // Why: the live addon just proved context creation works, so a stale attach
  // backoff from an earlier failure must not downgrade this pane to DOM.
  clearTerminalWebglAttachBackoff(pane)
  refreshPaneRenderer(pane)
}
