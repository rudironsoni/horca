import { requireXtermPaneState } from './xterm-renderer/xterm-pane-state'
import type { ManagedPaneInternal } from './pane-manager-types'
import { safeFit } from './pane-tree-ops'
import {
  attachPaneFitResizeObserver,
  detachPaneFitResizeObserver
} from './pane-fit-resize-observer'
import { clearPendingSplitScrollRestore } from './pane-split-scroll'
import { cancelDeferredScrollRestore } from './pane-scroll'
import { activateOrcaTerminalUnicodeProvider } from '../../../../shared/terminal-unicode-provider'
import { attachTerminalMouseWheelMultiplier } from './pane-terminal-mouse-wheel'
import { attachTerminalScrollIntentTracking } from './terminal-scroll-intent-dom-tracking'
import {
  installTerminalLinkifierHoverResetOnMouseLeave,
  installTerminalLinkifierHoverResetOnWindowBlur
} from './terminal-linkifier-hover-reset-on-mouseleave'
import { installTerminalLinkifierHoverResetOnWrite } from './terminal-linkifier-hover-reset-on-write'
import { attachDomRendererFocusClassSync } from './pane-dom-focus-class-sync'
import { attachWebgl, cancelPendingWebglRefresh, disposeWebgl } from './pane-webgl-renderer'
import { rebuildAttachedWebgl } from './pane-webgl-reattach'
import { configureLazyArabicShapingJoiner } from './terminal-arabic-shaping-joiner'
import { TerminalLigaturesAddon } from './terminal-ligatures-addon'
import { installTerminalImeCandidateAnchor } from './terminal-ime-candidate-anchor'

// ---------------------------------------------------------------------------
// Pane creation, terminal open/close, addon management
// ---------------------------------------------------------------------------

export { createPaneDOM } from './pane-dom-creation'

/** Open terminal into its container and load addons. Must be called after the container is in the DOM. */
export function openTerminal(pane: ManagedPaneInternal, ligaturesEnabled = false): void {
  const {
    terminal,
    container,
    xtermContainer,
    linkTooltip,
    terminalTuiScrollSensitivity
  } = pane
  const state = requireXtermPaneState(terminal)
  const xterm = state.term
  const fitAddon = state.fitAddon
  const searchAddon = state.searchAddon
  const serializeAddon = state.serializeAddon
  const unicode11Addon = state.unicode11Addon
  const webLinksAddon = state.webLinksAddon

  // Open terminal into DOM
  xterm.open(xtermContainer)
  // Why: terminal.element sits under the padded xterm container. Pane-level
  // placement keeps the hover URL on the true bottom-left window corner.
  container.appendChild(linkTooltip)

  // Load addons (order matters: WebGL must be after open())
  xterm.loadAddon(fitAddon)
  xterm.loadAddon(searchAddon)
  xterm.loadAddon(serializeAddon)
  xterm.loadAddon(unicode11Addon)
  xterm.loadAddon(webLinksAddon)
  attachTerminalMouseWheelMultiplier(xterm, {
    getTuiMouseWheelMultiplier: terminalTuiScrollSensitivity
  })
  pane.terminalScrollIntentDisposable = attachTerminalScrollIntentTracking(
    xterm,
    xtermContainer,
    pane.leafId
  )
  // Why: a link streamed into a visible pane under a stationary pointer would
  // otherwise stay un-underlined/un-clickable until the mouse crosses to a new
  // line; invalidate the linkifier hover cache when output lands so the next
  // pointer move re-linkifies it.
  pane.linkifierHoverResetDisposable = installTerminalLinkifierHoverResetOnWrite(xterm)
  pane.linkifierMouseLeaveResetDisposable = installTerminalLinkifierHoverResetOnMouseLeave(
    xterm,
    linkTooltip
  )
  pane.linkifierWindowBlurResetDisposable = installTerminalLinkifierHoverResetOnWindowBlur(
    xterm,
    linkTooltip
  )

  // Activate Orca's Unicode 11 width shim *before* any caller-driven write. CJK / emoji /
  // ZWJ codepoints get baked into the buffer at the active unicode version on
  // write — if a restore (snapshot, scrollback, cold-restore) writes bytes
  // through xterm while the default v6 width tables are still active, wide
  // chars lay out as single cells and any subsequent re-measurement breaks
  // pairing (visible as broken `?`-style glyphs). All restore paths
  // (replayTerminalLayout → splitPane/createInitialPane → openTerminal,
  // restoreScrollbackBuffers, handleReattachResult) run after openTerminal,
  // so the activation must stay at this position.
  activateOrcaTerminalUnicodeProvider(xterm)

  // Why: any xterm character joiner makes every repaint scan the whole grid.
  // Defer registration until the first RTL write; replay and live paths both
  // ensure it before parsing, so restored Arabic still shapes immediately.
  pane.arabicShapingJoinerCleanup = configureLazyArabicShapingJoiner(
    xterm,
    () => requireXtermPaneState(pane.terminal).webglAddon != null
  )

  // Store so disposePane() can remove it and avoid a memory leak.
  pane.compositionHandler = installTerminalImeCandidateAnchor(xterm)

  pane.focusClassSyncCleanup = attachDomRendererFocusClassSync(xterm.element)

  // Configure the first atlas with ligatures instead of immediately rebuilding it.
  if (ligaturesEnabled) {
    attachLigatures(pane)
  }
  if (pane.gpuRenderingEnabled) {
    attachWebgl(pane)
  }

  attachPaneFitResizeObserver(pane)

  // Initial fit (deferred to ensure layout has settled)
  if (pane.pendingInitialFitRafId != null) {
    cancelAnimationFrame(pane.pendingInitialFitRafId)
  }
  pane.pendingInitialFitRafId = requestAnimationFrame(() => {
    pane.pendingInitialFitRafId = null
    safeFit(pane)
  })
}

export function disposeLigatures(pane: ManagedPaneInternal): void {
  if (requireXtermPaneState(pane.terminal).ligaturesAddon) {
    try {
      requireXtermPaneState(pane.terminal).ligaturesAddon?.dispose()
    } catch {
      /* ignore */
    }
    requireXtermPaneState(pane.terminal).ligaturesAddon = null
  }
}

export function attachLigatures(pane: ManagedPaneInternal): void {
  if (requireXtermPaneState(pane.terminal).ligaturesAddon) {
    return
  }
  try {
    const ligaturesAddon = new TerminalLigaturesAddon()
    requireXtermPaneState(pane.terminal).term.loadAddon(ligaturesAddon)
    requireXtermPaneState(pane.terminal).ligaturesAddon = ligaturesAddon
    // Why: ligatures can be enabled after rows already rendered, especially
    // from Settings. Force existing glyph runs to be recomputed immediately.
    if (!pane.webglAttachmentDeferred) {
      pane.terminal.refresh(0, pane.terminal.rows - 1)
    }
    // Why: the WebGL renderer builds its glyph texture atlas at activation
    // time, so `font-feature-settings` applied after WebGL loaded won't
    // reach the GPU-rendered cells until the atlas is rebuilt. The upstream
    // docs call this out explicitly — reactivating WebGL after ligatures
    // forces a fresh atlas that includes the ligated glyphs.
    rebuildAttachedWebgl(pane)
  } catch (err) {
    console.warn('[terminal] ligatures addon failed to attach for pane', pane.id, err)
    requireXtermPaneState(pane.terminal).ligaturesAddon = null
  }
}

/** Enable or disable ligatures in-place, reusing the running terminal so the
 *  setting can be toggled without dropping scrollback or the PTY binding. */
export function setLigaturesEnabled(pane: ManagedPaneInternal, enabled: boolean): void {
  if (enabled) {
    attachLigatures(pane)
  } else if (requireXtermPaneState(pane.terminal).ligaturesAddon) {
    disposeLigatures(pane)
    // Why: ligatures lived inside the WebGL atlas, so after disposing the
    // addon the atlas still holds the ligated glyphs. Rebuild it so text
    // renders as the non-ligated fallback immediately.
    rebuildAttachedWebgl(pane)
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
    // Why: fit retries own xterm markers and frame callbacks independently of
    // split restoration; both must be released before terminal disposal.
    cancelDeferredScrollRestore(pane.terminal)
  } catch {
    /* ignore */
  }
  try {
    requireXtermPaneState(pane.terminal).ligaturesAddon?.dispose()
  } catch {
    /* ignore */
  }
  disposeWebgl(pane)
  try {
    requireXtermPaneState(pane.terminal).searchAddon.dispose()
  } catch {
    /* ignore */
  }
  try {
    requireXtermPaneState(pane.terminal).serializeAddon.dispose()
  } catch {
    /* ignore */
  }
  try {
    requireXtermPaneState(pane.terminal).unicode11Addon.dispose()
  } catch {
    /* ignore */
  }
  try {
    requireXtermPaneState(pane.terminal).webLinksAddon.dispose()
  } catch {
    /* ignore */
  }
  try {
    requireXtermPaneState(pane.terminal).fitAddon.dispose()
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
