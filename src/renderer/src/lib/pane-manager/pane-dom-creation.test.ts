// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { createPaneDOM } from './pane-dom-creation'

function stubCanvas(fillRects?: number[][], fillTexts?: string[]): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    textBaseline: 'top',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    measureText: () => ({ width: 8 }),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
      fillRects?.push([x, y, w, h])
    }),
    fillText: vi.fn((text: string) => {
      fillTexts?.push(text)
    })
  }
  return ctx as unknown as CanvasRenderingContext2D
}

describe('createPaneDOM link tooltips', () => {
  beforeAll(() => {
    getGhosttyVtHostOrThrow()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCanvas()) as never
  })

  it('anchors hover text to the unpadded terminal window corner', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )

    expect(pane.linkTooltip.classList.contains('pane-link-tooltip')).toBe(true)
    expect(pane.linkTooltip.style.left).toBe('')
    expect(pane.linkTooltip.style.bottom).toBe('')
    expect(pane.linkTooltip.style.display).toBe('none')
    expect(pane.terminal.element.tagName).toBe('CANVAS')
    pane.terminal.dispose()
  })

  it('constructs an Orca Ghostty canvas terminal, not xterm', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('hello ghostty')
    pane.terminal.scrollToBottom()
    expect(pane.terminalHost.contains(pane.terminal.element)).toBe(true)
    expect(pane.terminal.element.tagName).toBe('CANVAS')
    expect(pane.terminal.textarea.className).toBe('xterm-helper-textarea')
    expect(pane.terminal.serialize()).toContain('hello ghostty')
    pane.terminal.dispose()
  })

  it('paints selected cells from Ghostty render-state', async () => {
    const fillStyles: string[] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      const ctx = stubCanvas()
      let fill = ''
      Object.defineProperty(ctx, 'fillStyle', {
        set(value: string) {
          fillStyles.push(value)
          fill = value
        },
        get() {
          return fill
        }
      })
      return ctx
    }) as never
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('hello ghostty')
    pane.terminal.selectAll()
    pane.terminal.refresh()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    expect(fillStyles.some((style) => style.includes('221'))).toBe(true)
    pane.terminal.dispose()
  })

  it('repaints viewport cells after a clean idle frame', async () => {
    const fillTexts: string[] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCanvas(undefined, fillTexts)) as never
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('hello ghostty')
    pane.terminal.refresh()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    fillTexts.length = 0
    pane.terminal.refresh()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    expect(fillTexts.some((text) => text.includes('hello'))).toBe(true)
    pane.terminal.dispose()
  })

  it('paints the Ghostty render-state cursor after writing', async () => {
    const fillRects: number[][] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCanvas(fillRects)) as never
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('A')
    pane.terminal.refresh()
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve())
    })
    const cursor = fillRects.find(
      (rect) => rect[1] === 0 && rect[2] > 0 && rect[2] < 40 && rect[3] > 0
    )
    expect(cursor).toBeDefined()
    pane.terminal.dispose()
  })

  it('encodes Ghostty mouse bytes on pointerdown', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    const inputs: string[] = []
    pane.terminal.onData((data) => inputs.push(data))
    pane.terminal.write('\x1b[?1000h')
    pane.terminal.element.dispatchEvent(
      new MouseEvent('pointerdown', { clientX: 12, clientY: 8, button: 0, bubbles: true })
    )
    expect(inputs.some((seq) => seq.length > 0)).toBe(true)
    pane.terminal.dispose()
  })

  it('paints IME preedit on the canvas at the Ghostty cursor', () => {
    const texts: string[] = []
    HTMLCanvasElement.prototype.getContext = vi.fn(() => {
      const ctx = stubCanvas()
      ctx.fillText = vi.fn((value: string) => {
        texts.push(value)
      })
      return ctx
    }) as never
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('A')
    pane.terminal.element.dispatchEvent(new CompositionEvent('compositionupdate', { data: '가' }))
    pane.terminal.setPreedit('가')
    expect(texts.some((value) => value.includes('가'))).toBe(true)
    pane.terminal.dispose()
  })

  it('selects dragged text through Ghostty gestures on the pane canvas', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    pane.terminal.write('hello world')
    const width = pane.terminal.cellWidth
    pane.terminal.element.dispatchEvent(
      new MouseEvent('pointerdown', {
        clientX: 1,
        clientY: 1,
        button: 0,
        buttons: 1,
        bubbles: true
      })
    )
    pane.terminal.element.dispatchEvent(
      new MouseEvent('pointermove', {
        clientX: width * 5,
        clientY: 1,
        button: 0,
        buttons: 1,
        bubbles: true
      })
    )
    expect(pane.terminal.getSelection()).toContain('hello')
    pane.terminal.dispose()
  })
})
