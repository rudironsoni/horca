// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
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

describe('OrcaPaneTerminal compositor presentation', () => {
  it('paints through a data-ghostty canvas, not a local terminal rasterizer', async () => {
    const { ops } = stubRecordingCanvas()
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    terminal.options.theme = SOLARIZED_LIGHT
    terminal.write('x')
    expect(terminal.element.getAttribute('data-ghostty')).toMatch(/^pane-\d+$/)
    expect(ops.filter((op) => op.op === 'fillRect' || op.op === 'fillText')).toEqual([])
    const attach = vi.fn(async () => true)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { horcaGhosttyPassthru: { attach, detach: vi.fn(async () => undefined) } }
    })
    terminal.bindPty('pty-live')
    await Promise.resolve()
    expect(attach).toHaveBeenCalledWith({
      sessionId: 'pty-live',
      slot: terminal.slot
    })
    terminal.dispose()
  })

  it('updates cell metrics without drawing glyphs locally', () => {
    const { ops } = stubRecordingCanvas()
    const terminal = new OrcaPaneTerminal(document.createElement('div'), { fontSize: 14 })
    terminal.write('A')
    ops.length = 0
    terminal.options.fontSize = 22
    terminal.applyMetrics()
    expect(terminal.cellHeight).toBeGreaterThan(0)
    expect(ops.filter((op) => op.op === 'fillText')).toEqual([])
    terminal.dispose()
  })

  it('sends paste through Ghostty text instead of a raw PTY write', () => {
    const pasteText = vi.fn()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { horcaGhosttyPassthru: { pasteText, attach: vi.fn(), detach: vi.fn(), readSelection: vi.fn(() => '') } }
    })
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    const raw: string[] = []
    terminal.onData((data) => raw.push(data))
    terminal.paste('PASTE_HORCA')
    expect(pasteText).toHaveBeenCalledWith(terminal.slot, 'PASTE_HORCA')
    expect(raw).toEqual([])
    terminal.dispose()
  })
})
