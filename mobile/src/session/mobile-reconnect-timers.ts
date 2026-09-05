export type MobileReconnectTimers = {
  schedule: (fn: () => void, delayMs: number) => void
  dispose: () => void
}

export function createMobileReconnectTimers(): MobileReconnectTimers {
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let disposed = false

  return {
    schedule(fn, delayMs) {
      if (disposed) {
        return
      }
      const timer = setTimeout(() => {
        timers.delete(timer)
        fn()
      }, delayMs)
      timers.add(timer)
    },
    dispose() {
      disposed = true
      for (const timer of timers) {
        clearTimeout(timer)
      }
      timers.clear()
    }
  }
}
