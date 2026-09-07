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
import {
  rearmTerminalWebglAddonLoad,
  setTerminalWebglAddonLoadHandlers
} from './terminal-webgl-addon-loader'

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
    const renderer = (pane.gpuRenderer as unknown as XtermWebglAddonInternals | null)?._renderer
    return renderer?._gl?.isContextLost?.() === true
  } catch {
    return true
  }
}

export function disposeWebgl(
  pane: ManagedPaneInternal,
  options?: { refreshDimensions?: boolean }
): void {
  cancelPendingWebglRefresh(pane)
  panesAwaitingWebglAddon.delete(pane)
  if (!pane.gpuRenderer) {
    return
  }
  releaseXtermWebglContext(pane.gpuRenderer)
  try {
    pane.gpuRenderer.dispose?.()
  } catch {
    /* ignore */
  }
  pane.gpuRenderer = null
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

function releaseXtermWebglContext(gpuRenderer: ManagedPaneInternal['gpuRenderer']): void {
  try {
    // Why: xterm removes the canvas on dispose, but Windows/ANGLE can keep the
    // driver context alive long enough for rapid terminal activation to hit
    // Chromium's active WebGL context budget (#6874).
    const renderer = (gpuRenderer as unknown as XtermWebglAddonInternals | null)?._renderer
    renderer?._gl?.getExtension('WEBGL_lose_context')?.loseContext()
    if (renderer?._canvas) {
      renderer._canvas.width = 0
      renderer._canvas.height = 0
    }
  } catch {
    /* ignore - WebGL teardown must not block fallback to the DOM renderer */
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
    // Why: rapid TUI redraws can corrupt xterm's WebGL glyph atlas without a
    // context-loss event. Clearing the atlas preserves GPU rendering and forces
    // a fresh paint when the pane becomes visible/focused again.
    pane.gpuRenderer?.clearTextureAtlas?.()
  } catch {
    /* ignore — pane may have been disposed in the meantime */
  }
}

export function resetWebglTextureAtlas(pane: ManagedPaneInternal): void {
  clearWebglTextureAtlas(pane)
  presentPaneViewport(pane)
}

function refitAfterLateWebglAttach(pane: ManagedPaneInternal): void {
  // Why: the grid this pane is running was measured under DOM cell metrics —
  // by the fit that triggered the attach, or by the initial fit that ran while
  // the addon was still loading — but WebGL floors the device cell width.
  // Keeping that grid leaves an unpainted right gutter and a PTY narrower than
  // the pane. Refit on the next frame (mirroring the dispose-side
  // refreshDimensions) so xterm has re-measured against the new renderer, and
  // so the running fit is never re-entered.
  if (typeof globalThis.requestAnimationFrame !== 'function') {
    return
  }
  pane.pendingWebglRefreshRafId = globalThis.requestAnimationFrame(() => {
    pane.pendingWebglRefreshRafId = null
    try {
      safeFit(pane)
    } catch {
      /* ignore — pane may have been disposed in the meantime */
    }
  })
}

/** Single pairing for every late attach: without the refit the pane keeps a
 *  grid measured under the DOM renderer. */
function attachWebglAndRefit(pane: ManagedPaneInternal, diagnosticKind: string): void {
  attachWebgl(pane)
  if (pane.gpuRenderer) {
    recordTerminalWebglDiagnostic(diagnosticKind, { paneId: pane.id })
    refitAfterLateWebglAttach(pane)
  }
}

export function attachWebglAfterFitIfMissing(pane: ManagedPaneInternal): void {
  if (
    !pane.gpuRenderer &&
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

export function attachWebgl(_pane: ManagedPaneInternal): void {}
