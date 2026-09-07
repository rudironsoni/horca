import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import type { TerminalWebglAutoDecision } from './terminal-webgl-auto-policy'
import type { OrcaPaneAppearance, OrcaPaneTerminal } from './orca-pane-terminal'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** Hints forwarded from splitPane() into onPaneCreated for a single split.
 *  Carries one-shot PTY spawn/adoption data for the new pane.
 *  Kept as a separate parameter (rather than extending ManagedPane) so the
 *  hint is scoped to pane creation and does not live on the pane afterwards. */
export type PaneSpawnHints = {
  cwd?: string
  cwdPromise?: Promise<string>
  ptyId?: string
}

export type PaneSplitOptions = PaneSpawnHints & {
  ratio?: number
  leafId?: string
}

export type ClosedPaneInfo = {
  paneId: number
  leafId: TerminalLeafId
  reason?: 'close' | 'detach' | 'retire'
}

export type PaneExternalDropTarget = {
  id: string
  rect: DOMRect
  overlayKind?: 'area' | 'insertion'
}

export type PaneExternalDropResolver = (args: {
  sourcePaneId: number
  clientX: number
  clientY: number
}) => PaneExternalDropTarget | null

export type PaneExternalDropHandler = (
  sourcePaneId: number,
  target: PaneExternalDropTarget
) => boolean

export type PaneManagerOptions = {
  onPaneCreated?: (pane: ManagedPane, spawnHints?: PaneSpawnHints) => void | Promise<void>
  onPaneClosed?: (paneId: number, closedPane?: ClosedPaneInfo) => void
  onActivePaneChange?: (pane: ManagedPane) => void
  onLayoutChanged?: () => void
  /** Why: Electron webviews can steal pointer streams from renderer-owned
   *  pane drags unless callers temporarily put them in pointer passthrough. */
  onPaneDragActiveChange?: (active: boolean) => void
  resolveExternalPaneDropTarget?: PaneExternalDropResolver
  onExternalPaneDrop?: PaneExternalDropHandler
  terminalOptions?: (paneId: number) => Partial<OrcaPaneAppearance>
  terminalLigaturesEnabled?: () => boolean
  terminalTuiScrollSensitivity?: () => number | undefined
  onLinkClick?: (paneId: number, event: MouseEvent | undefined, url: string) => void
  /** Resolved per hover so link-routing setting changes apply without recreating panes. */
  // Why: required so dropping the wiring is a compile error — an optional hint with a
  // default would silently serve stale copy that no test can distinguish.
  // Why: paneId-scoped because the hovered pane's host decides where its links can go.
  linkOpenHint: (paneId: number) => string
  formatLinkTooltip?: (
    paneId: number,
    url: string,
    openLinkHint: string
  ) => string | null | undefined | Promise<string | null | undefined>
  initialRenderingSuspended?: boolean
  retainHiddenWebgl?: boolean
  terminalGpuAcceleration?: GlobalSettings['terminalGpuAcceleration']
  // Why: diagnostic label for log correlation. safeFit and other internal
  // helpers log warnings that are hard to correlate without knowing which
  // tab/worktree the PaneManager belongs to.
  debugLabel?: string
}

export type PaneStyleOptions = {
  splitBackground?: string
  paneBackground?: string
  inactivePaneOpacity?: number
  activePaneOpacity?: number
  opacityTransitionMs?: number
  dividerThicknessPx?: number
  // Why this behavior flag lives on "style" options: this type is already
  // the single runtime-settings bag the PaneManager exposes. Splitting into
  // separate style vs behavior types is a refactor worth its own change
  // when a second behavior flag lands. See docs/focus-follows-mouse-design.md.
  focusFollowsMouse?: boolean
  paddingX?: number
  paddingY?: number
}

export type PaneFitController = {
  fit: () => void
  proposeDimensions: () => { cols: number; rows: number } | null
  dispose: () => void
}

export type PaneSearchController = {
  findNext: (query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean
  findPrevious: (query: string, options?: { caseSensitive?: boolean; regex?: boolean }) => boolean
  clearDecorations: () => void
  dispose: () => void
}

export type PaneSerializeController = {
  serialize: (opts?: { scrollback?: number }) => string
  dispose: () => void
}

export type ManagedPane = {
  id: number
  /** Durable terminal layout leaf UUID. Use this for paneKey/ORCA_PANE_KEY and
   *  persisted leaf-keyed state; `id` is only the live renderer handle. */
  leafId: TerminalLeafId
  /** Compatibility alias while callers migrate from the older stablePaneId name. */
  stablePaneId: TerminalLeafId
  terminal: OrcaPaneTerminal
  container: HTMLElement
  linkTooltip: HTMLElement
  fitController: PaneFitController
  searchController: PaneSearchController
  serializeController: PaneSerializeController
}

export type PaneRenderingDiagnostics = {
  paneId: number
  terminalGpuAcceleration: GlobalSettings['terminalGpuAcceleration']
  gpuRenderingEnabled: boolean
  webglAttachmentDeferred: boolean
  webglDisabledAfterContextLoss: boolean
  webglContextLossesInWindow?: number
  webglAttachFailedSinceRecovery: boolean
  hasComplexScriptOutput: boolean
  terminalWebglAutoDecision: TerminalWebglAutoDecision
  hasWebgl: boolean
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type ScrollState = {
  bufferType: 'normal' | 'alternate'
  wasAtBottom: boolean
  viewportY: number
  baseY: number
  firstVisibleLogicalCellOffset?: number
}

export type ManagedPaneInternal = {
  terminalHost: HTMLElement
  linkTooltip: HTMLElement
  terminalTuiScrollSensitivity?: () => number | undefined
  terminalGpuAcceleration: GlobalSettings['terminalGpuAcceleration']
  gpuRenderingEnabled: boolean
  webglAttachmentDeferred: boolean
  webglDisabledAfterContextLoss: boolean
  // Shared history bounds context-loss retries across resume and settled reveal.
  webglContextLossTimestamps?: number[]
  // Hidden retained renderers rebuild at the resume boundary, never behind the hidden surface.
  webglRebuildDeferred?: boolean
  // Why per-pane: one pane's failed WebGL attach must not strand every other
  // pane on the DOM renderer until the next recovery boundary. Optional so
  // absent means "never failed"; only the attach failure path sets it.
  webglAttachFailedSinceRecovery?: boolean
  // Why: expose complex-output diagnostics without changing renderer choice;
  // auto renderer fallback is reserved for platform or WebGL failures.
  hasComplexScriptOutput: boolean
  gpuRenderer: { dispose?: () => void; clearTextureAtlas?: () => void } | null
  ligaturesAddon: { dispose?: () => void } | null
  fitResizeObserver: ResizeObserver | null
  // Why: fit-element pixel size at the last successful fit; the reveal fit compares
  // against it to tell a real hidden-time resize from a transient cell-metric wobble.
  lastFitClientSize?: { width: number; height: number }
  // Stored so disposePane() can cancel the first post-open fit if a pane closes before paint.
  pendingInitialFitRafId?: number | null
  // Stored so disposePane() can cancel the post-WebGL-teardown refresh frame.
  pendingWebglRefreshRafId?: number | null
  pendingObservedFitRafId: number | null
  unicode11Addon: null
  webLinksAddon: null
  // Stored so disposePane() can remove pane-local DOM listeners explicitly.
  panePointerDownHandler?: ((event: PointerEvent) => void) | null
  paneMouseEnterHandler?: ((event: MouseEvent) => void) | null
  paneDragCleanup?: (() => void) | null
  // Stored so disposePane() can remove it and avoid a memory leak.
  compositionHandler: (() => void) | null
  // Stored so disposePane() can remove DOM-renderer focus synchronization.
  focusClassSyncCleanup?: (() => void) | null
  // Stored so disposePane() can remove user-scroll intent listeners.
  terminalScrollIntentDisposable?: { dispose: () => void } | null
  linkifierHoverResetDisposable?: { dispose: () => void } | null
  linkifierMouseLeaveResetDisposable?: { dispose: () => void } | null
  linkifierWindowBlurResetDisposable?: { dispose: () => void } | null
  // Stored so disposePane() can deregister the joiner; terminal.dispose()
  // does not remove registered character joiners.
  arabicShapingJoinerCleanup?: (() => void) | null
  // Why: splitPane reparents DOM; its delayed restore owns scroll until the
  // browser settles, so intermediate fits must not compete with it.
  pendingSplitScrollState: ScrollState | null
  // Stored so repeated split restores and disposePane() can cancel deferred
  // restore handles instead of leaving stale pane closures alive.
  pendingSplitScrollRafIds?: number[]
  pendingSplitScrollTimerId?: ReturnType<typeof setTimeout> | null
  // Stored so repeated split restores and disposePane() can remove the
  // deferred alt-screen buffer listener instead of stacking callbacks.
  pendingSplitScrollBufferDisposable?: { dispose: () => void } | null
  debugLabel: string | null
} & ManagedPane

export type DropZone = 'top' | 'bottom' | 'left' | 'right'
