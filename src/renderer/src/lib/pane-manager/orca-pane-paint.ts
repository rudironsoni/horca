const BACKGROUND_PAINT_MS = 50

export function createPaintScheduler(paint: () => void): {
  refresh: () => void
  refreshBackground: () => void
  flush: () => void
  dispose: () => void
} {
  let queued = false
  let dirty = false
  let raf = 0
  let deferred: ReturnType<typeof setTimeout> | undefined
  const cancelDeferred = (): void => {
    if (deferred !== undefined) {
      clearTimeout(deferred)
      deferred = undefined
    }
  }
  const cancel = (): void => {
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(raf)
    }
    cancelDeferred()
    queued = false
    dirty = false
    raf = 0
  }
  return {
    refresh() {
      dirty = true
      cancelDeferred()
      if (queued) {
        return
      }
      if (typeof requestAnimationFrame !== 'function') {
        dirty = false
        paint()
        return
      }
      queued = true
      raf = requestAnimationFrame(() => {
        queued = false
        raf = 0
        if (!dirty) {
          return
        }
        dirty = false
        paint()
      })
    },
    refreshBackground() {
      dirty = true
      if (queued || deferred !== undefined) {
        return
      }
      deferred = setTimeout(() => {
        deferred = undefined
        if (!dirty) {
          return
        }
        dirty = false
        paint()
      }, BACKGROUND_PAINT_MS)
    },
    flush() {
      cancel()
      paint()
    },
    dispose() {
      cancel()
    }
  }
}

export function refreshOrcaPanePaint(
  scheduler: ReturnType<typeof createPaintScheduler>,
  textarea: HTMLTextAreaElement
): void {
  const active = typeof document === 'undefined' ? null : document.activeElement
  const otherPaneFocused =
    active instanceof HTMLTextAreaElement &&
    active.classList.contains('orca-terminal-helper-textarea') &&
    active !== textarea
  if (otherPaneFocused) {
    scheduler.refreshBackground()
    return
  }
  scheduler.refresh()
}
