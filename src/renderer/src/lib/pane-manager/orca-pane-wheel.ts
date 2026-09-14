import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { scrollViewport } from '../../../../ghostty-vt/ghostty-terminal-ops'

const MOUSE_REPORTING_CLASS = 'enable-mouse-events'

export type OrcaPaneWheelHost = {
  element: HTMLCanvasElement
  cellHeight: number
  encodeMouse: (event: MouseEvent) => string
  input: (data: string) => void
  refresh: () => void
  customWheelHandler: () => ((event: WheelEvent) => boolean) | null
}

export function syncOrcaPaneMouseReportingClass(canvas: HTMLElement, mouseTracking: boolean): void {
  canvas.classList.toggle(MOUSE_REPORTING_CLASS, mouseTracking)
}

export function bindOrcaPaneWheel(pane: OrcaPaneWheelHost, engine: GhosttyTerminal): () => void {
  const onWheel = (event: WheelEvent): void => {
    const custom = pane.customWheelHandler()
    if (custom && custom(event) === false) {
      event.preventDefault()
      return
    }
    if (engine.mouseTracking) {
      const seq = pane.encodeMouse(event)
      if (seq) {
        event.preventDefault()
        pane.input(seq)
      }
      return
    }
    const cell = pane.cellHeight || 16
    const lines =
      event.deltaMode === 1
        ? Math.round(event.deltaY) || Math.sign(event.deltaY)
        : Math.round(event.deltaY / cell) || Math.sign(event.deltaY)
    if (lines === 0) {
      return
    }
    event.preventDefault()
    scrollViewport(engine, 'DELTA', lines)
    pane.refresh()
  }
  pane.element.addEventListener('wheel', onWheel, { passive: false })
  return () => {
    pane.element.removeEventListener('wheel', onWheel)
  }
}
