import { GhosttyRenderer } from '../../../../ghostty-vt/ghostty-renderer'
import { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { measureCellSize, type OrcaPaneAppearance } from './orca-pane-appearance'

export function createOrcaPaneSurface(appearance: OrcaPaneAppearance): {
  canvas: HTMLCanvasElement
  engine: GhosttyTerminal
  renderer: GhosttyRenderer
  cellWidth: number
  cellHeight: number
} {
  const cells = measureCellSize(appearance)
  const canvas = document.createElement('canvas')
  canvas.className = 'xterm orca-terminal-canvas'
  canvas.tabIndex = 0
  const host = getGhosttyVtHostOrThrow()
  const engine = new GhosttyTerminal(host, {
    cols: 80,
    rows: 24,
    scrollbackLines: appearance.scrollback
  })
  const renderer = new GhosttyRenderer(host, canvas, {
    cellWidth: cells.width,
    cellHeight: cells.height,
    fontFamily: appearance.fontFamily
  })
  return {
    canvas,
    engine,
    renderer,
    cellWidth: cells.width,
    cellHeight: cells.height
  }
}
