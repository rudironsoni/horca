import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPointerSelection,
  resetSelectionGesture
} from '../../ghostty-vt/ghostty-selection-gesture'
import { GhosttyTerminal } from '../../ghostty-vt/ghostty-terminal'
import {
  encodeMouse,
  readGridLine,
  readScrollbar,
  scrollViewport
} from '../../ghostty-vt/ghostty-terminal-ops'
import { GHOSTTY_VT_REVISION } from '../../ghostty-vt/revision'
import { getGhosttyVtHost } from './ghostty-vt-node-host'

describe('GhosttyTerminal', () => {
  let terminal: GhosttyTerminal | undefined

  afterEach(() => {
    terminal?.dispose()
    terminal = undefined
  })

  it('pins an immutable Ghostty revision', () => {
    expect(GHOSTTY_VT_REVISION).toBe('492300cad104195411d12217dd22f1cd05f31376')
  })

  it('writes VT bytes and reads Ghostty viewport text', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    terminal.writePtyOutput('hello world')
    expect(terminal.readViewportText()).toContain('hello world')
    expect(terminal.cols).toBe(80)
    expect(terminal.rows).toBe(24)
  })

  it('preserves graphemes and wide cells in viewport text', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 40, rows: 8 })
    terminal.writePtyOutput('日本語 😀')
    const text = terminal.readViewportText()
    expect(text).toContain('日本語')
    expect(text).toContain('😀')
  })

  it('restores native snapshot without ANSI reconstruction', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    terminal.writePtyOutput('\x1b[31mred snapshot\x1b[0m')
    const capture = terminal.capture()
    expect(capture.nativeSnapshot.subarray(0, 8)).toEqual(new TextEncoder().encode('GHOSTSNP'))
    terminal.writePtyOutput('\r\nmutated after capture')
    terminal.restore(capture)
    expect(terminal.readViewportText()).toContain('red snapshot')
    expect(terminal.readViewportText()).not.toContain('mutated after capture')
  })

  it('routes WRITE_PTY query replies through the Orca callback', () => {
    const replies: string[] = []
    terminal = new GhosttyTerminal(getGhosttyVtHost(), {
      cols: 80,
      rows: 24,
      onWritePty: (bytes) => {
        replies.push(new TextDecoder().decode(bytes))
      }
    })
    terminal.writePtyOutput('\x1b[c')
    expect(replies.join('')).toContain('\x1b[?')
  })

  it('does not emit WRITE_PTY when no callback is registered', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    terminal.writePtyOutput('\x1b[c')
    expect(terminal.readViewportText().includes('\x1b')).toBe(false)
  })

  it('exposes Ghostty render-state graphemes after VT writes', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 20, rows: 4 })
    terminal.writePtyOutput('Ab')
    expect(terminal.readViewportText()).toContain('Ab')
    expect(terminal.cols).toBe(20)
  })

  it('encodes paste bytes and reads a Ghostty select-all snapshot', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    terminal.writePtyOutput('hello paste world')
    expect(terminal.encodePaste('abc')).toBe('abc')
    terminal.selectAll()
    expect(terminal.readSelection()).toContain('hello paste world')
  })

  it('encodes a mouse press after mouse-tracking is enabled', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    terminal.writePtyOutput('\x1b[?1000h')
    const encoded = encodeMouse(
      terminal,
      {
        type: 'pointerdown',
        button: 0,
        clientX: 8,
        clientY: 16,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      },
      { left: 0, top: 0, cellWidth: 8, cellHeight: 16, cols: 80, rows: 24 }
    )
    expect(encoded.startsWith('\x1b[')).toBe(true)
    expect(encoded.length).toBeGreaterThan(2)
  })

  it('selects dragged cells and a double-click word through Ghostty gestures', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 20, rows: 4 })
    terminal.writePtyOutput('hello world')
    const surface = { left: 0, top: 0, cellWidth: 10, cellHeight: 16, cols: 20, rows: 4 }
    applyPointerSelection(
      terminal,
      { type: 'pointerdown', button: 0, buttons: 1, clientX: 2, clientY: 8, timeStamp: 1 },
      surface
    )
    applyPointerSelection(
      terminal,
      { type: 'pointermove', button: 0, buttons: 1, clientX: 46, clientY: 8, timeStamp: 2 },
      surface
    )
    expect(terminal.readSelection()).toContain('hello')
    applyPointerSelection(
      terminal,
      { type: 'pointerup', button: 0, buttons: 0, clientX: 46, clientY: 8, timeStamp: 3 },
      surface
    )
    resetSelectionGesture(terminal)
    applyPointerSelection(
      terminal,
      { type: 'pointerdown', button: 0, buttons: 1, clientX: 62, clientY: 8, timeStamp: 1000 },
      surface
    )
    applyPointerSelection(
      terminal,
      { type: 'pointerup', button: 0, buttons: 0, clientX: 62, clientY: 8, timeStamp: 1001 },
      surface
    )
    applyPointerSelection(
      terminal,
      { type: 'pointerdown', button: 0, buttons: 1, clientX: 62, clientY: 8, timeStamp: 1002 },
      surface
    )
    expect(terminal.readSelection()).toContain('world')
    applyPointerSelection(
      terminal,
      { type: 'pointerup', button: 0, buttons: 0, clientX: 62, clientY: 8, timeStamp: 1003 },
      surface
    )
    applyPointerSelection(
      terminal,
      { type: 'pointerdown', button: 0, buttons: 1, clientX: 62, clientY: 8, timeStamp: 1004 },
      surface
    )
    expect(terminal.readSelection()).toContain('hello world')
  })

  it('does not expose a public hostHandle ABI seam', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 24 })
    expect('hostHandle' in terminal).toBe(false)
    expect('handle' in terminal).toBe(false)
  })

  it('exposes wrap, wide cells, and bold from Ghostty grid introspection', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 8, rows: 4 })
    terminal.writePtyOutput('\x1b[1m日本語\x1b[0mabcdefghij')
    const first = readGridLine(terminal, 0)
    const second = readGridLine(terminal, 1)
    expect(first?.cells[0]?.width).toBe(2)
    expect(first?.cells[0]?.bold).toBe(true)
    expect(second?.isWrapped).toBe(true)
  })

  it('keeps requested scrollback lines instead of the 10KiB Ghostty default', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), {
      cols: 80,
      rows: 24,
      scrollbackLines: 5000
    })
    terminal.writePtyOutput('TOP\r\n')
    terminal.writePtyOutput('filler\r\n'.repeat(2000))
    expect(terminal.totalRows).toBeGreaterThan(2000)
  })

  it('scrolls the viewport to bottom without a result code', () => {
    terminal = new GhosttyTerminal(getGhosttyVtHost(), { cols: 80, rows: 8 })
    terminal.writePtyOutput(`${'line\n'.repeat(20)}tail`)
    scrollViewport(terminal, 'BOTTOM')
    const bar = readScrollbar(terminal)
    expect(bar.offset + bar.len).toBe(bar.total)
  })
})
