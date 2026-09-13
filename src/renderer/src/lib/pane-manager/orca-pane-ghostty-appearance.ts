import type { ITheme } from '../../../../shared/orca-terminal-surface'
import {
  applyGhosttyColorTheme,
  applyGhosttyCursorDefaults,
  parseCssColorToRgb
} from '../../../../ghostty-vt/ghostty-color-theme'
import type { GhosttyRenderer } from '../../../../ghostty-vt/ghostty-renderer'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import type { OrcaPaneAppearance } from './orca-pane-appearance'

export function applyOrcaPaneRendererMetrics(
  renderer: GhosttyRenderer,
  appearance: OrcaPaneAppearance,
  cells: { width: number; height: number }
): void {
  renderer.setMetrics({
    cellWidth: cells.width,
    cellHeight: cells.height,
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    fontWeight: appearance.fontWeight,
    fontWeightBold: appearance.fontWeightBold
  })
}

export function bindOrcaPaneGhosttyAppearance(
  options: OrcaPaneAppearance,
  engine: GhosttyTerminal,
  renderer: GhosttyRenderer,
  canvas: HTMLCanvasElement,
  refresh: () => void,
  onCursorChange: () => void
): void {
  let theme = options.theme
  let cursorStyle = options.cursorStyle
  let cursorBlink = options.cursorBlink
  let allowTransparency = options.allowTransparency
  Object.defineProperty(options, 'theme', {
    configurable: true,
    enumerable: true,
    get: () => theme,
    set: (value: ITheme | undefined) => {
      theme = value
      applyTheme()
      refresh()
    }
  })
  Object.defineProperty(options, 'cursorStyle', {
    configurable: true,
    enumerable: true,
    get: () => cursorStyle,
    set: (value: string | undefined) => {
      cursorStyle = value
      applyCursor()
      refresh()
    }
  })
  Object.defineProperty(options, 'cursorBlink', {
    configurable: true,
    enumerable: true,
    get: () => cursorBlink,
    set: (value: boolean | undefined) => {
      cursorBlink = value
      applyCursor()
      onCursorChange()
    }
  })
  Object.defineProperty(options, 'allowTransparency', {
    configurable: true,
    enumerable: true,
    get: () => allowTransparency,
    set: (value: boolean | undefined) => {
      allowTransparency = value
      applyTheme()
      refresh()
    }
  })
  applyTheme()
  applyCursor()

  function applyTheme(): void {
    canvas.classList.toggle('allow-transparency', allowTransparency === true)
    if (!theme) {
      renderer.setBackgroundAlpha(1)
      renderer.setSelectionColors(null, null)
      renderer.invalidate()
      return
    }
    const background = applyGhosttyColorTheme(engine, theme)
    renderer.setBackgroundAlpha(allowTransparency === true ? background.alpha : 1)
    const selectionBg = theme.selectionBackground
      ? parseCssColorToRgb(theme.selectionBackground)?.rgb
      : null
    const selectionFg = theme.selectionForeground
      ? parseCssColorToRgb(theme.selectionForeground)?.rgb
      : null
    renderer.setSelectionColors(selectionBg ?? null, selectionFg ?? null)
    renderer.invalidate()
  }

  function applyCursor(): void {
    applyGhosttyCursorDefaults(
      engine,
      cursorStyle === 'bar' || cursorStyle === 'underline' ? cursorStyle : 'block',
      cursorBlink === true
    )
  }
}
