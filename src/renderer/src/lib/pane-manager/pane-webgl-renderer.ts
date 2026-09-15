import type { ManagedPaneInternal } from './pane-manager-types'
import { recordTerminalWebglDiagnostic } from '../../../../shared/terminal-webgl-diagnostics'
import {
  getTerminalWebglAutoDecision,
  resetTerminalWebglAutoDecision
} from './terminal-webgl-auto-policy'
import { safeFitAndThen } from './pane-fit'
import { setPaneFitWebglAttachHook } from './pane-fit-webgl-attach-signal'
import { repairPaneWebglCanvasDprMismatch } from './terminal-canvas-dpr-repair'
import { presentPaneViewport } from './pane-viewport-present'
import { rearmTerminalWebglAddonLoad } from './terminal-webgl-addon-loader'

export {
  presentPaneViewport,
  presentPaneViewportPreservingSynchronizedOutput
} from './pane-viewport-present'

export { primeTerminalWebglAddon } from './terminal-webgl-addon-loader'

let suggestedRendererType: 'dom' | undefined

export function resetTerminalWebglSuggestion(): void {
  suggestedRendererType = undefined
  rearmTerminalWebglAddonLoad()
  resetTerminalWebglAutoDecision()
}

export function clearTerminalWebglAttachBackoff(pane: ManagedPaneInternal): void {
  pane.webglAttachFailedSinceRecovery = false
}

export function shouldUseTerminalWebgl(pane: ManagedPaneInternal): boolean {
  if (pane.terminalGpuAcceleration === 'on') {
    return true
  }
  if (pane.terminalGpuAcceleration !== 'auto' || suggestedRendererType === 'dom') {
    return false
  }
  return getTerminalWebglAutoDecision().allowWebgl
}

export function cancelPendingWebglRefresh(pane: ManagedPaneInternal): void {
  if (pane.pendingWebglRefreshRafId == null) {
    return
  }
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(pane.pendingWebglRefreshRafId)
  }
  pane.pendingWebglRefreshRafId = null
}

export function isPaneWebglContextLost(pane: ManagedPaneInternal): boolean {
  try {
    return pane.gpuRenderer?.isContextLost?.() === true
  } catch {
    return true
  }
}

export function disposeWebgl(
  pane: ManagedPaneInternal,
  options?: { refreshDimensions?: boolean }
): void {
  cancelPendingWebglRefresh(pane)
  if (!pane.gpuRenderer) {
    return
  }
  try {
    pane.gpuRenderer.loseContext?.()
  } catch {
    /* ignore */
  }
  try {
    pane.gpuRenderer.dispose?.()
  } catch {
    /* ignore */
  }
  if (options?.refreshDimensions) {
    pane.pendingWebglRefreshRafId = requestAnimationFrame(() => {
      pane.pendingWebglRefreshRafId = null
      try {
        safeFitAndThen(pane, 'webgl-fallback-refresh', () => {
          pane.terminal.refresh(0, pane.terminal.rows - 1)
        })
      } catch {
        /* ignore — pane may have been disposed in the meantime */
      }
    })
  }
}

export function markComplexScriptOutput(pane: ManagedPaneInternal): void {
  pane.hasComplexScriptOutput = true
}

export function clearWebglTextureAtlas(pane: ManagedPaneInternal): void {
  if (pane.webglDisabledAfterContextLoss) {
    return
  }
  try {
    pane.gpuRenderer?.clearTextureAtlas?.()
  } catch {
    /* ignore — pane may have been disposed in the meantime */
  }
}

export function resetWebglTextureAtlas(pane: ManagedPaneInternal): void {
  clearWebglTextureAtlas(pane)
  presentPaneViewport(pane)
}

export function attachWebglAfterFitIfMissing(pane: ManagedPaneInternal): void {
  if (
    pane.gpuRenderer &&
    pane.gpuRenderingEnabled &&
    !pane.webglAttachmentDeferred &&
    !pane.webglDisabledAfterContextLoss &&
    shouldUseTerminalWebgl(pane)
  ) {
    refreshPaneRenderer(pane)
    recordTerminalWebglDiagnostic('webgl-fit-attach', { paneId: pane.id })
  }
}

setPaneFitWebglAttachHook((pane) => {
  attachWebglAfterFitIfMissing(pane)
  repairPaneWebglCanvasDprMismatch(pane)
})

export function refreshPaneRenderer(pane: ManagedPaneInternal): void {
  presentPaneViewport(pane)
}
