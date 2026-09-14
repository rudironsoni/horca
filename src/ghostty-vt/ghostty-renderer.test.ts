// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { GhosttyRenderer } from './ghostty-renderer'
import { GhosttyTerminal } from './ghostty-terminal'
import { applyGhosttyColorTheme, rgbToCss } from './ghostty-color-theme'
import { getGhosttyVtHostOrThrow } from './host-singleton'

const SOLARIZED_LIGHT = {
  background: '#fdf6e3',
  foreground: '#657b83',
  red: '#dc322f'
}

type PaintOp = {
  op: 'fillRect' | 'fillText'
  fillStyle: string
  font: string
  args: unknown[]
}

const CELL = { cellWidth: 8, cellHeight: 16, fontFamily: 'monospace', fontSize: 12 }

function installRecordingCanvas(): { ops: PaintOp[] } {
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
        ops.push({
          op: 'fillRect',
          fillStyle: String(ctx.fillStyle),
          font: String(ctx.font),
          args
        })
      },
      fillText: (...args: unknown[]) => {
        ops.push({
          op: 'fillText',
          fillStyle: String(ctx.fillStyle),
          font: String(ctx.font),
          args
        })
      }
    }
    return ctx
  }) as never
  return { ops }
}

describe('GhosttyRenderer', () => {
  let terminal: GhosttyTerminal | undefined
  let renderer: GhosttyRenderer | undefined

  beforeAll(() => {
    getGhosttyVtHostOrThrow()
  })

  afterEach(() => {
    renderer?.dispose()
    renderer = undefined
    terminal?.dispose()
    terminal = undefined
  })

  it('clears with the theme background instead of black', () => {
    const { ops } = installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    applyGhosttyColorTheme(terminal, SOLARIZED_LIGHT)
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    renderer.draw(terminal)
    const firstFill = ops.find((op) => op.op === 'fillRect')
    expect(firstFill?.fillStyle).toBe(rgbToCss([253, 246, 227]))
    expect(firstFill?.fillStyle).not.toBe('#000000')
  })

  it('repaints after a theme change and refresh', () => {
    const { ops } = installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    renderer.draw(terminal)
    ops.length = 0
    applyGhosttyColorTheme(terminal, SOLARIZED_LIGHT)
    renderer.invalidate()
    renderer.draw(terminal)
    expect(ops.find((op) => op.op === 'fillRect')?.fillStyle).toBe(rgbToCss([253, 246, 227]))
  })

  it('paints a wide CJK run at two cell widths so the next ASCII cell is not shifted', () => {
    const { ops } = installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    terminal.writePtyOutput('\x1b[41m日\x1b[42mA')
    renderer.draw(terminal)
    const rowFills = ops.filter(
      (op) =>
        op.op === 'fillRect' &&
        op.args[1] === 0 &&
        op.args[3] === CELL.cellHeight &&
        (op.args[2] as number) < 20 * CELL.cellWidth
    )
    const wide = rowFills.find((op) => op.args[0] === 0 && op.args[2] === CELL.cellWidth * 2)
    const ascii = rowFills.find((op) => op.args[0] === CELL.cellWidth * 2)
    expect(wide).toBeDefined()
    expect(ascii).toBeDefined()
    expect(ascii?.args[2]).toBe(CELL.cellWidth)
  })

  it('skips canvas work on a second draw with no VT write', () => {
    const { ops } = installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    terminal.writePtyOutput('hello')
    renderer.draw(terminal)
    expect(ops.some((op) => op.op === 'fillRect')).toBe(true)
    ops.length = 0
    renderer.draw(terminal)
    expect(ops).toEqual([])
  })

  it('uses fontSize in the fillText font string after setMetrics', () => {
    const { ops } = installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    terminal.writePtyOutput('A')
    renderer.setMetrics({ ...CELL, fontSize: 22 })
    renderer.draw(terminal)
    const text = ops.find((op) => op.op === 'fillText')
    expect(text?.font).toContain('22px')
  })

  it('falls back to canvas2d when WebGL2 is a stub without shaders', () => {
    installRecordingCanvas()
    const canvas = document.createElement('canvas')
    terminal = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    renderer = new GhosttyRenderer(getGhosttyVtHostOrThrow(), canvas, CELL)
    expect(renderer.kind).toBe('canvas2d')
    expect(renderer.isContextLost()).toBe(false)
  })
})
