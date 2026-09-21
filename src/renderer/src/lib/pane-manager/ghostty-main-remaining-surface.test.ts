// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { GhosttyPaneTerminal } from './ghostty-renderer/ghostty-pane-terminal'
import { buildDefaultTerminalOptions } from './pane-terminal-options'
import { clearTerminalScrollbackAndFollowOutput } from './terminal-scrollback-clear'
import { forceTerminalViewportScrollbarSync } from './terminal-viewport-scrollbar-sync'
import { getTheme, getThemeNames } from '../terminal-themes-data'
import { createPreviewGridClaim } from '../../components/dashboard-popout/preview-grid-claim'
import { buildPreviewAppearanceOptions } from '../../components/dashboard-popout/preview-terminal-options'

describe('remaining MAIN Ghostty surface modules', () => {
  it('builds pane options and Horca themes for the compositor terminal', () => {
    const opts = buildDefaultTerminalOptions()
    expect(opts.fontSize).toBeGreaterThan(0)
    expect(getThemeNames().length).toBeGreaterThan(0)
    expect(getTheme(getThemeNames()[0] ?? '')).not.toBeNull()
    const appearance = buildPreviewAppearanceOptions(null, false)
    expect(appearance.fontSize).toBe(14)
  })

  it('clears Ghostty scrollback and no-ops scrollbar sync at the bottom', () => {
    const terminal = new GhosttyPaneTerminal({ measureRoot: document.createElement('div') })
    terminal.write('line\n')
    clearTerminalScrollbackAndFollowOutput(terminal)
    expect(terminal.serialize()).toBe('')
    forceTerminalViewportScrollbarSync(terminal)
    terminal.dispose()
  })

  it('claims preview grid from a data-ghostty canvas', async () => {
    vi.useFakeTimers()
    const fit = vi.fn(async (_ptyId: string, _cols: number, _rows: number) => undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { terminalPreview: { fit } }
    })
    const box = document.createElement('div')
    Object.defineProperty(box, 'clientWidth', { value: 800 })
    Object.defineProperty(box, 'clientHeight', { value: 400 })
    const container = document.createElement('div')
    const canvas = document.createElement('canvas')
    canvas.className = 'orca-terminal-canvas'
    canvas.setAttribute('data-ghostty', 'pane-1')
    Object.defineProperty(canvas, 'offsetWidth', { value: 640 })
    Object.defineProperty(canvas, 'offsetHeight', { value: 320 })
    container.appendChild(canvas)
    box.appendChild(container)
    document.body.appendChild(box)
    const terminal = new GhosttyPaneTerminal({ measureRoot: container })
    terminal.resize(80, 24)
    const claim = createPreviewGridClaim({
      ptyId: 'pty-preview',
      container,
      getTerminal: () => terminal
    })
    claim.schedule()
    await vi.runAllTimersAsync()
    expect(fit).toHaveBeenCalled()
    const [, cols, rows] = fit.mock.calls[0]
    expect(cols).toBeGreaterThanOrEqual(20)
    expect(rows).toBeGreaterThanOrEqual(8)
    claim.dispose()
    terminal.dispose()
    vi.useRealTimers()
  })
})
