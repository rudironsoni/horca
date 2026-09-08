import { refreshTerminalImeInputContext } from '@/components/terminal-pane/terminal-ime-input-context-refresh'
import { UNCOVERED_TERMINAL_LEAF_SELECTOR } from '@/components/terminal-pane/native-chat-covered-pane'

/**
 * Move keyboard focus into the terminal canvas for a freshly-mounted tab.
 * double-rAF waits for that commit so focus lands on the new tab instead of
 * whatever surface (menu trigger, body, previous tab) just relinquished it.
 */

function cssAttributeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

let pendingFocusFrameIds: number[] = []

type FocusTerminalTabSurfaceOptions = {
  onlyIfFocusUnclaimed?: boolean
  onImeRefocusSkipped?: (activeElement: Element | null) => void
  refreshImeContext?: boolean
}

function focusTerminalHelper(helper: HTMLElement, options: FocusTerminalTabSurfaceOptions): void {
  if (options.onlyIfFocusUnclaimed) {
    const active = document.activeElement
    if (active !== helper && active !== null && active !== document.body) {
      return
    }
  }
  helper.focus()
  if (options.refreshImeContext) {
    // Why: a CSS-hidden, long-lived terminal can retain a stale macOS native text
    // input context even after DOM focus returns; blur/refocus rebuilds it.
    refreshTerminalImeInputContext(helper, {
      onRefocusSkipped: options.onImeRefocusSkipped
    })
  }
}

function cancelPendingFocusFrames(): void {
  if (typeof cancelAnimationFrame === 'function') {
    for (const frameId of pendingFocusFrameIds) {
      cancelAnimationFrame(frameId)
    }
  }
  pendingFocusFrameIds = []
}

function canUseSinglePaneStaleLeafFallback(tabId: string, leafId: string): boolean {
  const tabElement = document.querySelector(`[data-terminal-tab-id="${cssAttributeString(tabId)}"]`)
  const expectedLeafIds = tabElement
    ?.getAttribute('data-terminal-layout-leaf-ids')
    ?.split(' ')
    .filter(Boolean)
  return expectedLeafIds?.length === 1 && !expectedLeafIds.includes(leafId)
}

function queryFocusSurface(scope: string): HTMLElement | null {
  return (
    (document.querySelector(`${scope} .orca-terminal-helper-textarea`) as HTMLElement | null) ??
    (document.querySelector(`${scope} canvas.orca-terminal-canvas`) as HTMLElement | null)
  )
}

export function focusTerminalTabSurface(
  tabId: string,
  leafId?: string | null,
  options: FocusTerminalTabSurfaceOptions = {}
): void {
  cancelPendingFocusFrames()
  const firstFrameId = requestAnimationFrame(() => {
    pendingFocusFrameIds = pendingFocusFrameIds.filter((frameId) => frameId !== firstFrameId)
    const secondFrameId = requestAnimationFrame(() => {
      pendingFocusFrameIds = pendingFocusFrameIds.filter((frameId) => frameId !== secondFrameId)
      // Why: this can be queued before inline tab rename mounts. If it runs
      // afterward, focusing terminal blurs the rename input and commits it closed.
      if (document.querySelector('[data-tab-rename-input="true"]')) {
        return
      }
      const escapedTabId = cssAttributeString(tabId)
      const tabElement = document.querySelector(`[data-terminal-tab-id="${escapedTabId}"]`)
      if (tabElement?.getAttribute('data-terminal-chat-view') === 'true') {
        return
      }
      const tabScope = `[data-terminal-tab-id="${escapedTabId}"]`
      const uncoveredScope = leafId
        ? `${tabScope} [data-leaf-id="${cssAttributeString(leafId)}"]${UNCOVERED_TERMINAL_LEAF_SELECTOR}`
        : `${tabScope} ${UNCOVERED_TERMINAL_LEAF_SELECTOR}`
      const scoped = queryFocusSurface(uncoveredScope)
      if (scoped) {
        focusTerminalHelper(scoped, options)
        return
      }
      if (leafId) {
        if (!canUseSinglePaneStaleLeafFallback(tabId, leafId)) {
          // Why: exact mobile split-pane focus must not silently focus a sibling
          // pane when the requested UUID leaf has not mounted yet.
          return
        }
        // Why: old single-pane remounts could remint the leaf id. Only recover
        // after the tab layout no longer expects the requested leaf.
        const tabScopedHelpers = document.querySelectorAll(
          `${tabScope} ${UNCOVERED_TERMINAL_LEAF_SELECTOR} .orca-terminal-helper-textarea, ${tabScope} ${UNCOVERED_TERMINAL_LEAF_SELECTOR} canvas.orca-terminal-canvas`
        )
        if (tabScopedHelpers.length === 1) {
          const fallback = tabScopedHelpers.item(0) as HTMLElement | null
          if (fallback) {
            focusTerminalHelper(fallback, options)
          }
          return
        }
        return
      }
      const fallback = queryFocusSurface(UNCOVERED_TERMINAL_LEAF_SELECTOR)
      if (fallback) {
        focusTerminalHelper(fallback, options)
      }
    })
    pendingFocusFrameIds.push(secondFrameId)
  })
  pendingFocusFrameIds.push(firstFrameId)
}
