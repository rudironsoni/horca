import type { ManagedPaneInternal } from './pane-manager-types'

export {
  presentPaneViewport,
  presentPaneViewportPreservingSynchronizedOutput
} from './pane-viewport-present'
export { primeTerminalWebglAddon } from './terminal-webgl-addon-loader'

export const ENABLE_WEBGL_RENDERER = false

export function resetTerminalWebglSuggestion(): void {}

export function clearTerminalWebglAttachBackoff(_pane: ManagedPaneInternal): void {}

export function shouldUseTerminalWebgl(_pane: ManagedPaneInternal): boolean {
  return false
}

export function cancelPendingWebglRefresh(pane: ManagedPaneInternal): void {
  if (pane.pendingWebglRefreshRafId != null) {
    cancelAnimationFrame(pane.pendingWebglRefreshRafId)
    pane.pendingWebglRefreshRafId = null
  }
}

export function isPaneWebglContextLost(_pane: ManagedPaneInternal): boolean {
  return false
}

export function disposeWebgl(
  pane: ManagedPaneInternal,
  _opts?: { refreshDimensions?: boolean }
): void {
  cancelPendingWebglRefresh(pane)
}

export function markComplexScriptOutput(pane: ManagedPaneInternal): void {
  pane.hasComplexScriptOutput = true
}

export function clearWebglTextureAtlas(_pane: ManagedPaneInternal): void {}

export function resetWebglTextureAtlas(_pane: ManagedPaneInternal): void {}

export function attachWebglAfterFitIfMissing(_pane: ManagedPaneInternal): void {}

export function attachWebgl(_pane: ManagedPaneInternal): void {}
