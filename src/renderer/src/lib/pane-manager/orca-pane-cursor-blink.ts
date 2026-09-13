import type { GhosttyRenderer } from '../../../../ghostty-vt/ghostty-renderer'

const CURSOR_BLINK_MS = 600

export function createOrcaPaneCursorBlink(opts: {
  textarea: HTMLTextAreaElement
  renderer: GhosttyRenderer
  isEnabled: () => boolean
  refresh: () => void
}): { sync: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setInterval> | undefined
  let visible = true
  const show = (): void => {
    visible = true
    opts.renderer.setBlinkVisible(true)
  }
  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer)
      timer = undefined
    }
    show()
  }
  const sync = (): void => {
    const focused = typeof document !== 'undefined' && document.activeElement === opts.textarea
    if (!opts.isEnabled() || !focused) {
      const wasRunning = timer !== undefined
      stop()
      if (wasRunning) {
        opts.refresh()
      }
      return
    }
    if (timer !== undefined) {
      return
    }
    timer = setInterval(() => {
      visible = !visible
      opts.renderer.setBlinkVisible(visible)
      opts.refresh()
    }, CURSOR_BLINK_MS)
  }
  opts.textarea.addEventListener('focus', sync)
  opts.textarea.addEventListener('blur', sync)
  return {
    sync,
    dispose() {
      opts.textarea.removeEventListener('focus', sync)
      opts.textarea.removeEventListener('blur', sync)
      if (timer !== undefined) {
        clearInterval(timer)
        timer = undefined
      }
    }
  }
}
