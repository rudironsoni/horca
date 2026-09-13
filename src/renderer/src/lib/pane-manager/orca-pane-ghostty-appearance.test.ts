// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { rgbToCss } from '../../../../ghostty-vt/ghostty-color-theme'
import { OrcaPaneTerminal } from './orca-pane-terminal'

const SOLARIZED_LIGHT = {
  background: '#fdf6e3',
  foreground: '#657b83',
  red: '#dc322f'
}

type PaintOp = { op: string; fillStyle: string; font: string; args: unknown[] }

function stubRecordingCanvas(): { ops: PaintOp[] } {
  const ops: PaintOp[] = []
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    const ctx: Record<string, unknown> = {
      font: '',
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      textBaseline: 'alphabetic',
      measureText: () => ({
        width: 8,
        actualBoundingBoxAscent: 10,
        actualBoundingBoxDescent: 2
      }),
      setTransform: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: (...args: unknown[]) => {
        ops.push({ op: 'fillRect', fillStyle: String(ctx.fillStyle), font: String(ctx.font), args })
      },
      fillText: (...args: unknown[]) => {
        ops.push({ op: 'fillText', fillStyle: String(ctx.fillStyle), font: String(ctx.font), args })
      }
    }
    return ctx
  }) as never
  return { ops }
}

describe('OrcaPaneTerminal Ghostty theme and metrics', () => {
  beforeAll(() => {
    getGhosttyVtHostOrThrow()
  })

  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('applies options.theme through the Ghostty palette so the first fill uses the theme background', () => {
    const { ops } = stubRecordingCanvas()
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    terminal.options.theme = SOLARIZED_LIGHT
    terminal.write('x')
    const firstFill = ops.find((op) => op.op === 'fillRect')
    expect(firstFill?.fillStyle).toBe(rgbToCss([253, 246, 227]))
    terminal.dispose()
  })

  it('updates the renderer font string when applyMetrics runs after a fontSize change', () => {
    const { ops } = stubRecordingCanvas()
    const terminal = new OrcaPaneTerminal(document.createElement('div'), { fontSize: 14 })
    terminal.write('A')
    ops.length = 0
    terminal.options.fontSize = 22
    terminal.applyMetrics()
    const text = ops.find((op) => op.op === 'fillText')
    expect(text?.font).toContain('22px')
    terminal.dispose()
  })
})
