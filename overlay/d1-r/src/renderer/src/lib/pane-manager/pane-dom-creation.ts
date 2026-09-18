import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import type { DragReorderCallbacks, DragReorderState } from './pane-drag-reorder'
import { attachPaneDrag } from './pane-drag-pointer'
import type { ManagedPaneInternal, PaneManagerOptions } from './pane-manager-types'
import { buildDefaultTerminalOptions } from './pane-terminal-options'
import { shouldFocusTerminalFromPanePointerDown } from './pane-pointer-focus'
import { ENABLE_WEBGL_RENDERER } from './pane-webgl-renderer'
import { GhosttyPaneTerminal } from './ghostty-renderer/ghostty-pane-terminal'

function defaultLinkTooltipText(uri: string, openLinkHint: string): string {
  return `${uri} (${openLinkHint})`
}

export function createPaneDOM(
  id: number,
  leafId: TerminalLeafId,
  options: PaneManagerOptions,
  dragState: DragReorderState,
  dragCallbacks: DragReorderCallbacks,
  onPointerDown: (id: number, options?: { focusTerminal?: boolean }) => void,
  onMouseEnter: (id: number, event: MouseEvent) => void
): ManagedPaneInternal {
  const container = document.createElement('div')
  container.className = 'pane'
  container.dataset.paneId = String(id)
  container.dataset.leafId = leafId

  const xtermContainer = document.createElement('div')
  xtermContainer.className = 'xterm-container'
  container.appendChild(xtermContainer)

  const userOpts = options.terminalOptions?.(id) ?? {}
  const terminalOpts = {
    ...buildDefaultTerminalOptions(),
    ...userOpts
  }

  let linkTooltipHoverToken = 0
  const linkTooltip = document.createElement('div')
  linkTooltip.className = 'pane-link-tooltip xterm-hover'
  linkTooltip.style.display = 'none'

  const terminal = new GhosttyPaneTerminal({
    measureRoot: xtermContainer,
    appearance: {
      ...terminalOpts,
      linkHandler: {
        activate: (event, uri) => {
          options.onLinkClick?.(id, event, uri)
        },
        hover: (_event, uri) => {
          linkTooltipHoverToken += 1
          const hoverToken = linkTooltipHoverToken
          const openLinkHint = options.linkOpenHint(id)
          linkTooltip.textContent = defaultLinkTooltipText(uri, openLinkHint)
          linkTooltip.style.display = ''
          const formatted = options.formatLinkTooltip?.(id, uri, openLinkHint)
          if (formatted && typeof formatted === 'object' && 'then' in formatted) {
            void formatted.then(
              (nextText) => {
                if (hoverToken === linkTooltipHoverToken && nextText) {
                  linkTooltip.textContent = nextText
                }
              },
              () => undefined
            )
          } else if (formatted) {
            linkTooltip.textContent = formatted
          }
        },
        leave: () => {
          linkTooltipHoverToken += 1
          linkTooltip.style.display = 'none'
        }
      }
    }
  })

  const dragHandle = document.createElement('div')
  dragHandle.className = 'pane-drag-handle'
  container.appendChild(dragHandle)
  const paneDragCleanup = attachPaneDrag(dragHandle, id, dragState, dragCallbacks)

  const panePointerDownHandler = (event: PointerEvent): void => {
    onPointerDown(id, {
      focusTerminal: shouldFocusTerminalFromPanePointerDown(event.target)
    })
  }
  const paneMouseEnterHandler = (event: MouseEvent): void => onMouseEnter(id, event)

  const pane: ManagedPaneInternal = {
    id,
    leafId,
    stablePaneId: leafId,
    terminal,
    container,
    xtermContainer,
    linkTooltip,
    terminalTuiScrollSensitivity: options.terminalTuiScrollSensitivity,
    terminalGpuAcceleration: options.terminalGpuAcceleration ?? 'auto',
    gpuRenderingEnabled: ENABLE_WEBGL_RENDERER,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    webglRebuildDeferred: false,
    hasComplexScriptOutput: false,
    fitResizeObserver: null,
    pendingInitialFitRafId: null,
    pendingWebglRefreshRafId: null,
    pendingObservedFitRafId: null,
    panePointerDownHandler,
    paneMouseEnterHandler,
    paneDragCleanup,
    compositionHandler: null,
    focusClassSyncCleanup: null,
    terminalScrollIntentDisposable: null,
    linkifierMouseLeaveResetDisposable: null,
    arabicShapingJoinerCleanup: null,
    pendingSplitScrollState: null,
    pendingSplitScrollRafIds: [],
    pendingSplitScrollTimerId: null,
    pendingSplitScrollBufferDisposable: null,
    debugLabel: options.debugLabel ?? null
  }

  container.addEventListener('pointerdown', panePointerDownHandler)
  container.addEventListener('mouseenter', paneMouseEnterHandler)

  return pane
}
