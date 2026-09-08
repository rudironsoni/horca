type LinkifierHoverCache = {
  _lastBufferCell?: unknown
  _activeLine?: number
  // Private terminal cleanup that invokes the active provider's leave callback
  // and removes its pointer cursor decoration.
  _clearCurrentLink?: () => void
  // Set while terminal is showing a hovered link; cleared on mouseleave / when the
  // pointer moves off the link (Linkifier `_clearCurrentLink`).
  _currentLink?: unknown
}

type TerminalCoreWithLinkifier = {
  _core?: {
    linkifier?: LinkifierHoverCache
  }
}

/**
 * Force terminal's linkifier to re-run link providers on the next mousemove.
 *
 * Why: when a terminal is hidden (worktree/tab switch) the browser fires
 * `mouseleave`, which clears the linkifier's current link but leaves its
 * `_lastBufferCell` cache set. On reveal the pointer usually returns to the
 * same cell, so terminal's mousemove handler short-circuits (position unchanged)
 * and never re-linkifies — the link (file path, URL, term_* handle, OSC-8)
 * stays dead until a scroll shifts the buffer position. Clearing the cell/line
 * cache makes the next mousemove re-evaluate providers so the link and its
 * hover underline recover without a scroll.
 *
 * Reaches into the terminal linkifier hover cache
 * because there is no public API to invalidate the hover cache. Guarded so a
 * future terminal build that renames these fields degrades to the pre-fix
 * behavior (link recovers on the next genuine cell change) instead of throwing.
 */
export function resetTerminalLinkifierHoverState(terminal: unknown): void {
  try {
    const linkifier = (terminal as unknown as TerminalCoreWithLinkifier)._core?.linkifier
    // Why: window blur can strand terminal's active link without another mouse
    // event, so invoke its own leave path before invalidating the cache. Its
    // own try: this runs provider leave() callbacks, and a throwing one must
    // not skip the cache invalidation below.
    try {
      linkifier?._clearCurrentLink?.()
    } catch {
      /* provider leave() threw — cache invalidation below still applies */
    }
    if (linkifier && '_currentLink' in linkifier) {
      linkifier._currentLink = undefined
    }
    if (linkifier && '_lastBufferCell' in linkifier) {
      linkifier._lastBufferCell = undefined
    }
    if (linkifier && '_activeLine' in linkifier) {
      linkifier._activeLine = -1
    }
    // Why: keep the cursor recoverable if a future terminal build omits the
    // private cleanup method or has no last mouse event for it to use.
    ;(terminal as { element?: HTMLElement }).element
      ?.querySelector<HTMLElement>('.orca-terminal-canvas')
      ?.classList.remove('orca-terminal-cursor-pointer')
  } catch {
    /* linkifier internals unavailable — link recovers on the next cell change */
  }
}

/**
 * True while terminal is actively showing a hovered link.
 *
 * Why: callers that invalidate the hover cache on a timer (streamed output)
 * must skip while a link is hovered — clearing the cache makes the next
 * mousemove clear and (for async providers like file paths) re-query the active
 * link, flickering its underline/tooltip. Guarded like {@link
 * resetTerminalLinkifierHoverState} so a renamed field degrades to "not
 * hovering" rather than throwing.
 */
export function isTerminalLinkifierHoverActive(terminal: unknown): boolean {
  try {
    const linkifier = (terminal as unknown as TerminalCoreWithLinkifier)._core?.linkifier
    return Boolean(linkifier && '_currentLink' in linkifier && linkifier._currentLink)
  } catch {
    return false
  }
}
