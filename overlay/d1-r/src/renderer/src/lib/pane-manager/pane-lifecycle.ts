import type { ManagedPaneInternal } from './pane-manager-types'
import { safeFit } from './pane-tree-ops'
import {
  attachPaneFitResizeObserver,
  detachPaneFitResizeObserver
} from './pane-fit-resize-observer'
import { clearPendingSplitScrollRestore } from './pane-split-scroll'
import { cancelDeferredScrollRestore } from './pane-scroll'
import { cancelPendingWebglRefresh, disposeWebgl } from './pane-webgl-renderer'

export { createPaneDOM } from './pane-dom-creation'

/** Open terminal into its container. Must be called after the container is in the DOM. */
export function openTerminal(pane: ManagedPaneInternal, ligaturesEnabled = false): void {
  const { terminal, container, xtermContainer, linkTooltip } = pane
  if (terminal.element && terminal.element.parentElement !== xtermContainer) {
    xtermContainer.appendChild(terminal.element)
  }
  if (terminal.textarea && terminal.textarea.parentElement !== xtermContainer) {
    xtermContainer.appendChild(terminal.textarea)
  }
  container.appendChild(linkTooltip)
  void ligaturesEnabled
  attachPaneFitResizeObserver(pane)

  if (pane.pendingInitialFitRafId != null) {
    cancelAnimationFrame(pane.pendingInitialFitRafId)
  }
  pane.pendingInitialFitRafId = requestAnimationFrame(() => {
    pane.pendingInitialFitRafId = null
    safeFit(pane)
  })
}

export function disposeLigatures(_pane: ManagedPaneInternal): void {}

export function attachLigatures(_pane: ManagedPaneInternal): void {}

export function setLigaturesEnabled(_pane: ManagedPaneInternal, _enabled: boolean): void {}

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
  try {
    pane.arabicShapingJoinerCleanup?.()
  } catch {
    /* ignore */
  }
  pane.arabicShapingJoinerCleanup = null
  if (pane.compositionHandler) {
    pane.terminal.element?.removeEventListener('compositionstart', pane.compositionHandler)
    pane.terminal.element?.removeEventListener('compositionupdate', pane.compositionHandler)
    pane.compositionHandler = null
  }
  try {
    clearPendingSplitScrollRestore(pane)
  } catch {
    /* ignore */
  }
  try {
    cancelDeferredScrollRestore(pane.terminal)
  } catch {
    /* ignore */
  }
  disposeWebgl(pane)
  try {
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
