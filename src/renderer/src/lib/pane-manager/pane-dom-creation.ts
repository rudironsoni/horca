import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import type { DragReorderCallbacks, DragReorderState } from './pane-drag-reorder'
import { attachPaneDrag } from './pane-drag-pointer'
import type { ManagedPaneInternal, PaneManagerOptions } from './pane-manager-types'
import { OrcaPaneTerminal } from './orca-pane-terminal'
import { shouldFocusTerminalFromPanePointerDown } from './pane-pointer-focus'

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

  const terminalHost = document.createElement('div')
  terminalHost.className = 'xterm-container'
  container.appendChild(terminalHost)

  const userOpts = options.terminalOptions?.(id) ?? {}
  const terminal = new OrcaPaneTerminal(terminalHost, userOpts)
  terminalHost.appendChild(terminal.element)
  terminalHost.appendChild(terminal.textarea)

  let linkTooltipHoverToken = 0
  const linkTooltip = document.createElement('div')
  linkTooltip.className = 'pane-link-tooltip xterm-hover'
  linkTooltip.style.display = 'none'

  const showLinkTooltip = (uri: string): void => {
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
  }

  const hideLinkTooltip = (): void => {
    linkTooltipHoverToken += 1
    linkTooltip.style.display = 'none'
  }

  terminal.element.addEventListener('pointermove', (event) => {
    const uri = terminal.hyperlinkAt(event.clientX, event.clientY)
    if (uri) {
      showLinkTooltip(uri)
    } else {
      hideLinkTooltip()
    }
  })
  terminal.element.addEventListener('pointerleave', hideLinkTooltip)
  terminal.element.addEventListener('click', (event) => {
    const uri = terminal.hyperlinkAt(event.clientX, event.clientY)
    if (uri) {
      options.onLinkClick?.(id, event, uri)
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
    terminalHost,
    linkTooltip,
    terminalTuiScrollSensitivity: options.terminalTuiScrollSensitivity,
    terminalGpuAcceleration: options.terminalGpuAcceleration ?? 'auto',
    gpuRenderingEnabled: false,
    webglAttachmentDeferred: false,
    webglDisabledAfterContextLoss: false,
    webglRebuildDeferred: false,
    hasComplexScriptOutput: false,
    fitController: {
      fit: () => terminal.fit(),
      proposeDimensions: () => terminal.proposeDimensions(),
      dispose: () => undefined
    },
    fitResizeObserver: null,
    pendingInitialFitRafId: null,
    pendingWebglRefreshRafId: null,
    pendingObservedFitRafId: null,
    searchController: {
      findNext: (query) => terminal.findNext(query),
      findPrevious: (query) => terminal.findPrevious(query),
      clearDecorations: () => undefined,
      dispose: () => undefined
    },
    serializeController: {
      serialize: () => terminal.serialize(),
      dispose: () => undefined
    },
    unicode11Addon: null,
    webLinksAddon: null,
    gpuRenderer: null,
    ligaturesAddon: null,
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
