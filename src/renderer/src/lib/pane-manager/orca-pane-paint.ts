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
      if (queued) {
        dirty = true
        return
      }
      paint()
      queued = true
      dirty = false
      if (typeof requestAnimationFrame !== 'function') {
        queued = false
        return
      }
      raf = requestAnimationFrame(() => {
        queued = false
        raf = 0
        if (dirty) {
          paint()
        }
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
