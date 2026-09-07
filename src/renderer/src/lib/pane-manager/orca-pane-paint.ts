export function createPaintScheduler(paint: () => void): {
  refresh: () => void
  flush: () => void
  dispose: () => void
} {
  let queued = false
  let dirty = false
  let raf = 0
  const cancel = (): void => {
    if (raf !== 0 && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(raf)
    }
    queued = false
    dirty = false
    raf = 0
  }
  return {
    refresh() {
      dirty = true
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
    flush() {
      cancel()
      paint()
    },
    dispose() {
      cancel()
    }
  }
}
