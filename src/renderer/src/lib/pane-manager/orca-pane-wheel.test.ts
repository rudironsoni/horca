// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { primeGhosttyVtHostForTests } from '../../../../ghostty-vt/prime-host-for-tests'
import { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'

primeGhosttyVtHostForTests()
import { bindOrcaPaneWheel, syncOrcaPaneMouseReportingClass } from './orca-pane-wheel'

describe('orca pane wheel', () => {
  let engine: GhosttyTerminal | undefined

  afterEach(() => {
    engine?.dispose()
    engine = undefined
  })

  it('scrolls the Ghostty viewport by DELTA when mouse tracking is off', () => {
    engine = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    engine.writePtyOutput(`${'pad\n'.repeat(20)}bottom`)
    const refresh = vi.fn()
    const input = vi.fn()
    const canvas = document.createElement('canvas')
    const unbind = bindOrcaPaneWheel(
      {
        element: canvas,
        cellHeight: 16,
        encodeMouse: () => '',
        input,
        refresh,
        customWheelHandler: () => null
      },
      engine
    )
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 32, deltaMode: 0, bubbles: true }))
    expect(refresh).toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
    unbind()
  })

  it('toggles the mouse-reporting class from Ghostty tracking state', () => {
    const canvas = document.createElement('canvas')
    syncOrcaPaneMouseReportingClass(canvas, true)
    expect(canvas.classList.contains('enable-mouse-events')).toBe(true)
    syncOrcaPaneMouseReportingClass(canvas, false)
    expect(canvas.classList.contains('enable-mouse-events')).toBe(false)
  })
})
