// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { readScrollbar } from '../../../../ghostty-vt/ghostty-terminal-ops'
import {
  bindGhosttyKeyboardInput,
  encodeGhosttyKey,
  hitTestGhosttyHyperlink
} from './orca-pane-terminal-io'

function fakeElement(): {
  element: HTMLElement
  dispatch: (type: string, event: KeyboardEvent) => void
} {
  const listeners = new Map<string, Set<(event: KeyboardEvent) => void>>()
  const element = {
    addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => {
      listeners.get(type)?.delete(listener)
    }
  } as unknown as HTMLElement
  return {
    element,
    dispatch: (type, event) => {
      for (const listener of listeners.get(type) ?? []) {
        listener(event)
      }
    }
  }
}

describe('encodeGhosttyKey', () => {
  let engine: GhosttyTerminal | undefined

  afterEach(() => {
    engine?.dispose()
    engine = undefined
  })

  it('encodes the full control surface through Ghostty', () => {
    engine = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    const seq = (partial: Partial<KeyboardEvent>) =>
      encodeGhosttyKey(engine!, {
        type: 'keydown',
        key: '',
        code: '',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        repeat: false,
        ...partial
      } as KeyboardEvent)
    const codes = (text: string) => [...text].map((ch) => ch.charCodeAt(0))
    const has = (text: string, byte: number) => codes(text).includes(byte)
    expect(has(seq({ key: 'Backspace', code: 'Backspace' }), 0x7f)).toBe(true)
    expect(has(seq({ key: 'c', code: 'KeyC', ctrlKey: true }), 0x03)).toBe(true)
    expect(has(seq({ key: 'd', code: 'KeyD', ctrlKey: true }), 0x04)).toBe(true)
    expect(has(seq({ key: 'z', code: 'KeyZ', ctrlKey: true }), 0x1a)).toBe(true)
    expect(seq({ key: 'Escape', code: 'Escape' })).toBe(String.fromCharCode(0x1b))
    expect(seq({ key: 'Tab', code: 'Tab' })).toBe('\t')
    expect(has(seq({ key: 'Enter', code: 'Enter' }), 0x0d)).toBe(true)
    expect(codes(seq({ key: 'ArrowUp', code: 'ArrowUp' }))[0]).toBe(0x1b)
    expect(codes(seq({ key: 'ArrowDown', code: 'ArrowDown' }))[0]).toBe(0x1b)
    expect(codes(seq({ key: 'Delete', code: 'Delete' }))[0]).toBe(0x1b)
  })
})

describe('bindGhosttyKeyboardInput', () => {
  it('encodes and sends a key when the Orca policy handler returns true', () => {
    const { element, dispatch } = fakeElement()
    const input = vi.fn()
    const encodeKey = vi.fn(() => 'a')
    const unbind = bindGhosttyKeyboardInput({
      element,
      encodeKey,
      input,
      customKeyHandler: () => () => true
    })
    dispatch('keydown', { key: 'a', preventDefault: () => undefined } as KeyboardEvent)
    expect(encodeKey).toHaveBeenCalled()
    expect(input).toHaveBeenCalledWith('a')
    unbind()
  })

  it('does not encode when the Orca policy handler returns false', () => {
    const { element, dispatch } = fakeElement()
    const input = vi.fn()
    const encodeKey = vi.fn(() => 'a')
    bindGhosttyKeyboardInput({
      element,
      encodeKey,
      input,
      customKeyHandler: () => () => false
    })
    dispatch('keydown', { key: 'a', preventDefault: () => undefined } as KeyboardEvent)
    expect(encodeKey).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
  })
})

describe('hitTestGhosttyHyperlink', () => {
  let engine: GhosttyTerminal | undefined

  afterEach(() => {
    engine?.dispose()
    engine = undefined
  })

  it('hits a visible OSC 8 cell after scrollback', () => {
    const cellWidth = 8
    const cellHeight = 16
    engine = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    engine.writePtyOutput(
      `${'pad\n'.repeat(12)}\x1b]8;;https://example.com/scrolled\x07LINK\x1b]8;;\x07`
    )
    const bar = readScrollbar(engine)
    expect(bar.offset).toBeGreaterThan(0)
    expect(bar.total).toBeGreaterThan(bar.len)
    const link = engine
      .collectHyperlinkRanges()
      .find((range) => range.uri === 'https://example.com/scrolled')
    expect(link).toBeDefined()
    const viewportRow = link!.row - bar.offset
    expect(viewportRow).toBeGreaterThanOrEqual(0)
    expect(viewportRow).toBeLessThan(engine.rows)
    expect(viewportRow).not.toBe(link!.row)
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 160, height: 64 })
    } as HTMLCanvasElement
    const uri = hitTestGhosttyHyperlink(
      engine,
      canvas,
      cellWidth,
      cellHeight,
      link!.startCol * cellWidth + 1,
      viewportRow * cellHeight + 1
    )
    expect(uri).toBe('https://example.com/scrolled')
  })
})
