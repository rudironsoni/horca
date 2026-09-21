// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { GhosttyPaneTerminal } from './ghostty-renderer/ghostty-pane-terminal'
import { createPaneDOM } from './pane-dom-creation'
import { disposePane, openTerminal } from './pane-lifecycle'
import { ENABLE_WEBGL_RENDERER } from './pane-webgl-renderer'
import { presentPaneViewports } from './pane-rendering-control'
import { captureLogicalLineAnchor } from './terminal-reflow-scroll-anchor'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import { createDragReorderState } from './pane-drag-reorder'
import type { PaneManagerOptions } from './pane-manager-types'

function stubCanvas(): { ops: string[] } {
  const ops: string[] = []
  HTMLCanvasElement.prototype.getContext = vi.fn(() => {
    const ctx: Record<string, unknown> = {
      font: '',
      fillStyle: '',
      measureText: () => ({ width: 8, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }),
      fillRect: () => {
        ops.push('fillRect')
      },
      fillText: () => {
        ops.push('fillText')
      },
      drawImage: () => {
        ops.push('drawImage')
      }
    }
    return ctx
  }) as never
  return { ops }
}

function paneOptions(): PaneManagerOptions {
  return {
    linkOpenHint: () => 'open',
    terminalGpuAcceleration: 'off'
  }
}

describe('MAIN Ghostty pane chrome, lifecycle, and remote bind', () => {
  it('creates one compositor canvas per pane with no local glyph rasterizer', () => {
    const { ops } = stubCanvas()
    const root = document.createElement('div')
    document.body.appendChild(root)
    const pane = createPaneDOM(
      1,
      '11111111-1111-4111-8111-111111111111' as TerminalLeafId,
      paneOptions(),
      createDragReorderState(),
      {
        getPanes: () => new Map(),
        getRoot: () => root,
        getStyleOptions: () => ({}),
        isDestroyed: () => false,
        safeFit: () => undefined,
        applyPaneOpacity: () => undefined,
        applyDividerStyles: () => undefined,
        refitPanesUnder: () => undefined
      },
      () => undefined,
      () => undefined
    )
    root.appendChild(pane.container)
    openTerminal(pane)
    expect(ENABLE_WEBGL_RENDERER).toBe(false)
    expect(pane.gpuRenderingEnabled).toBe(false)
    expect(pane.terminal).toBeInstanceOf(GhosttyPaneTerminal)
    if (!(pane.terminal instanceof GhosttyPaneTerminal)) {
      throw new Error('expected GhosttyPaneTerminal')
    }
    const canvas = pane.terminal.element
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error('expected compositor canvas')
    }
    expect(canvas.getAttribute('data-ghostty')).toMatch(/^pane-\d+$/)
    pane.terminal.write('hello')
    expect(ops.filter((op) => op === 'fillText')).toEqual([])
    expect(pane.terminal.encodeKey(new KeyboardEvent('keydown', { key: 'a' }))).toBe('')
    presentPaneViewports([pane])
    expect(captureLogicalLineAnchor(pane.terminal, 0)).toBeUndefined()
    disposePane(pane, new Map([[pane.id, pane]]))
  })

  it('gives two live panes distinct Ghostty slots and bindPty session ids', async () => {
    stubCanvas()
    const attach = vi.fn(async () => true)
    const detach = vi.fn(async () => undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { horcaGhosttyPassthru: { attach, detach } }
    })
    const a = new GhosttyPaneTerminal({ measureRoot: document.createElement('div') })
    const b = new GhosttyPaneTerminal({ measureRoot: document.createElement('div') })
    expect(a.slot).not.toBe(b.slot)
    a.bindPty('pty-remote-a')
    b.bindPty('pty-remote-b')
    await Promise.resolve()
    expect(attach).toHaveBeenCalledWith({ sessionId: 'pty-remote-a', slot: a.slot })
    expect(attach).toHaveBeenCalledWith({ sessionId: 'pty-remote-b', slot: b.slot })
    a.dispose()
    b.dispose()
    await Promise.resolve()
    expect(detach).toHaveBeenCalledWith(a.slot)
    expect(detach).toHaveBeenCalledWith(b.slot)
  })

  it('resizes, clears scrollback, and serializes on the Ghostty compositor terminal', () => {
    stubCanvas()
    const terminal = new GhosttyPaneTerminal({ measureRoot: document.createElement('div') })
    terminal.resize(100, 30)
    expect(terminal.cols).toBe(100)
    expect(terminal.rows).toBe(30)
    terminal.write('keep\n')
    terminal.write('\x1b[?1049h')
    expect(terminal.isAlternateScreen).toBe(true)
    terminal.clear()
    expect(terminal.serialize()).toBe('')
    terminal.dispose()
  })
})
