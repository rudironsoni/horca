import { GhosttyRenderer } from '../../../../ghostty-vt/ghostty-renderer'
import { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { measureCellSize, type OrcaPaneAppearance } from './orca-pane-appearance'
import { bindOrcaPaneGhosttyAppearance } from './orca-pane-ghostty-appearance'
import { createOrcaPaneCursorBlink } from './orca-pane-cursor-blink'

export function createOrcaPaneSurface(appearance: OrcaPaneAppearance): {
  canvas: HTMLCanvasElement
  textarea: HTMLTextAreaElement
  engine: GhosttyTerminal
  renderer: GhosttyRenderer
  cellWidth: number
  cellHeight: number
  bindRefresh: (refresh: () => void) => void
} {
  const cells = measureCellSize(appearance)
  const canvas = document.createElement('canvas')
  canvas.className = 'orca-terminal-canvas'
  canvas.tabIndex = -1
  canvas.style.display = 'block'
  const textarea = document.createElement('textarea')
  textarea.className = 'orca-terminal-helper-textarea'
  textarea.tabIndex = 0
  textarea.setAttribute('aria-label', 'Terminal input')
  const host = getGhosttyVtHostOrThrow()
  const engine = new GhosttyTerminal(host, {
    cols: 80,
    rows: 24,
    scrollbackLines: appearance.scrollback
  })
  const renderer = new GhosttyRenderer(host, canvas, {
    cellWidth: cells.width,
    cellHeight: cells.height,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    fontWeight: appearance.fontWeight,
    fontWeightBold: appearance.fontWeightBold
  })
  const refreshRef = { current: (): void => undefined }
  const refresh = (): void => refreshRef.current()
  const blink = createOrcaPaneCursorBlink({
    textarea,
    renderer,
    isEnabled: () => appearance.cursorBlink === true,
    refresh
  })
  bindOrcaPaneGhosttyAppearance(appearance, engine, renderer, canvas, refresh, () => blink.sync())
  const disposeRenderer = renderer.dispose.bind(renderer)
  renderer.dispose = () => {
    blink.dispose()
    disposeRenderer()
  }
  return {
    canvas,
    textarea,
    engine,
    renderer,
    cellWidth: cells.width,
    cellHeight: cells.height,
    bindRefresh: (next) => {
      refreshRef.current = next
    }
  }
}
