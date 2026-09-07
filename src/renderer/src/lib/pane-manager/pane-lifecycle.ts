import type { ManagedPaneInternal } from './pane-manager-types'
import { safeFit } from './pane-tree-ops'
import {
  attachPaneFitResizeObserver,
  detachPaneFitResizeObserver
} from './pane-fit-resize-observer'
import { clearPendingSplitScrollRestore } from './pane-split-scroll'
import { cancelDeferredScrollRestore } from './pane-scroll'
import { cancelPendingWebglRefresh, disposeWebgl } from './pane-webgl-renderer'

// ---------------------------------------------------------------------------
// Pane creation, terminal open/close, addon management
// ---------------------------------------------------------------------------

export { createPaneDOM } from './pane-dom-creation'

/** Open terminal into its container and load addons. Must be called after the container is in the DOM. */
export function openTerminal(pane: ManagedPaneInternal): void {
  pane.container.appendChild(pane.linkTooltip)
  attachPaneFitResizeObserver(pane)
  if (pane.pendingInitialFitRafId != null) {
    cancelAnimationFrame(pane.pendingInitialFitRafId)
  }
  pane.pendingInitialFitRafId = requestAnimationFrame(() => {
    pane.pendingInitialFitRafId = null
    safeFit(pane)
  })
}

export function disposeLigatures(pane: ManagedPaneInternal): void {
  if (pane.ligaturesAddon) {
    try {
      pane.ligaturesAddon.dispose?.()
    } catch {
      /* ignore */
    }
    pane.ligaturesAddon = null
  }
}

export function attachLigatures(_pane: ManagedPaneInternal): void {}

/** Enable or disable ligatures in-place, reusing the running terminal so the
 *  setting can be toggled without dropping scrollback or the PTY binding. */
export function setLigaturesEnabled(pane: ManagedPaneInternal, enabled: boolean): void {
  if (enabled) {
    attachLigatures(pane)
  } else if (pane.ligaturesAddon) {
    disposeLigatures(pane)
    // Why: ligatures lived inside the WebGL atlas, so after disposing the
    // addon the atlas still holds the ligated glyphs. Rebuild it so text
    // renders as the non-ligated fallback immediately.
    pane.terminal.refresh()
  }
}

export function disposePane(
  pane: ManagedPaneInternal,
  panes: Map<number, ManagedPaneInternal>
): void {
  if (pane.pendingInitialFitRafId != null) {
    cancelAnimationFrame(pane.pendingInitialFitRafId)
    pane.pendingInitialFitRafId = null
  }
  cancelPendingWebglRefresh(pane)
  detachPaneFitResizeObserver(pane)
  if (pane.panePointerDownHandler) {
    pane.container.removeEventListener('pointerdown', pane.panePointerDownHandler)
    pane.panePointerDownHandler = null
  }
  if (pane.paneMouseEnterHandler) {
    pane.container.removeEventListener('mouseenter', pane.paneMouseEnterHandler)
    pane.paneMouseEnterHandler = null
  }
  pane.paneDragCleanup?.()
  pane.paneDragCleanup = null
  pane.focusClassSyncCleanup?.()
  pane.focusClassSyncCleanup = null
  pane.terminalScrollIntentDisposable?.dispose()
  pane.terminalScrollIntentDisposable = null
  pane.linkifierHoverResetDisposable?.dispose()
  pane.linkifierHoverResetDisposable = null
  pane.linkifierMouseLeaveResetDisposable?.dispose()
  pane.linkifierMouseLeaveResetDisposable = null
  pane.linkifierWindowBlurResetDisposable?.dispose()
  pane.linkifierWindowBlurResetDisposable = null
  // Deregister the RTL shaping joiner: terminal.dispose() below does not.
  try {
    pane.arabicShapingJoinerCleanup?.()
  } catch {
    /* ignore */
  }
  pane.arabicShapingJoinerCleanup = null
  if (pane.compositionHandler) {
    pane.terminal.element.removeEventListener('compositionstart', pane.compositionHandler)
    pane.terminal.element.removeEventListener('compositionupdate', pane.compositionHandler)
    pane.compositionHandler = null
  }
  try {
    clearPendingSplitScrollRestore(pane)
  } catch {
    /* ignore */
  }
  try {
    // Why: fit retries own xterm markers and frame callbacks independently of
    // split restoration; both must be released before terminal disposal.
    cancelDeferredScrollRestore(pane.terminal)
  } catch {
    /* ignore */
  }
  try {
    pane.ligaturesAddon?.dispose?.()
  } catch {
    /* ignore */
  }
  disposeWebgl(pane)
  try {
    pane.searchController.dispose()
  } catch {
    /* ignore */
  }
  try {
    pane.serializeController.dispose()
  } catch {
    /* ignore */
  }
  try {
    pane.fitController.dispose()
  } catch {
    /* ignore */
  }
  try {
    // Drop renderer selection state before a recovery remount replaces the surface.
    pane.terminal.clearSelection()
  } catch {
    /* ignore */
  }
  try {
    pane.terminal.dispose()
  } catch {
    /* ignore */
  }
  panes.delete(pane.id)
}
