import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  captureScrollState,
  getTerminalOutputEpoch,
  recordTerminalOutput,
  restoreScrollState,
  restoreScrollStateAfterFit
} from './pane-scroll'
import type { ScrollableTerminal } from './pane-scroll'
import type { ScrollState } from './pane-manager-types'

function createTerminal(args: {
  viewportY: number
  baseY: number
  alternate?: boolean
  missingElement?: boolean
}): ScrollableTerminal {
  const state = {
    viewportY: args.viewportY,
    baseY: args.baseY,
    isAlternateScreen: args.alternate === true
  }
  return {
    get viewportY() {
      return state.viewportY
    },
    get baseY() {
      return state.baseY
    },
    get isAlternateScreen() {
      return state.isAlternateScreen
    },
    element: args.missingElement
      ? (undefined as unknown as HTMLCanvasElement)
      : ({} as HTMLCanvasElement),
    scrollToBottom: vi.fn(() => {
      state.viewportY = state.baseY
    }),
    scrollToLine: vi.fn((line: number) => {
      state.viewportY = line
    })
  }
}

describe('scroll state', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('captures the numeric viewport position', () => {
    const terminal = createTerminal({ viewportY: 42, baseY: 100 })
    expect(captureScrollState(terminal)).toEqual({
      bufferType: 'normal',
      wasAtBottom: false,
      viewportY: 42,
      baseY: 100
    })
  })

  it('tracks output epochs per terminal', () => {
    const terminalA = createTerminal({ viewportY: 0, baseY: 0 })
    const terminalB = createTerminal({ viewportY: 0, baseY: 0 })
    recordTerminalOutput(terminalA)
    recordTerminalOutput(terminalA)
    recordTerminalOutput(terminalB)
    expect(getTerminalOutputEpoch(terminalA)).toBe(2)
    expect(getTerminalOutputEpoch(terminalB)).toBe(1)
  })

  it('restores the captured viewport line', () => {
    const terminal = createTerminal({ viewportY: 10, baseY: 100 })
    const state: ScrollState = {
      bufferType: 'normal',
      wasAtBottom: false,
      viewportY: 42,
      baseY: 100
    }
    restoreScrollState(terminal, state)
    expect(terminal.scrollToLine).toHaveBeenCalledWith(42)
    expect(terminal.viewportY).toBe(42)
  })

  it('skips restore when the terminal element is gone', () => {
    const terminal = createTerminal({ viewportY: 10, baseY: 100, missingElement: true })
    const state: ScrollState = {
      bufferType: 'normal',
      wasAtBottom: false,
      viewportY: 42,
      baseY: 100
    }
    expect(restoreScrollState(terminal, state)).toBe(false)
    expect(terminal.scrollToLine).not.toHaveBeenCalled()
  })

  it('scrolls to bottom when the capture was at bottom', () => {
    const terminal = createTerminal({ viewportY: 10, baseY: 100 })
    restoreScrollState(terminal, {
      bufferType: 'normal',
      wasAtBottom: true,
      viewportY: 100,
      baseY: 100
    })
    expect(terminal.scrollToBottom).toHaveBeenCalled()
    expect(terminal.viewportY).toBe(100)
  })

  it('skips restore on the alternate screen', () => {
    const terminal = createTerminal({ viewportY: 0, baseY: 0, alternate: true })
    restoreScrollState(terminal, {
      bufferType: 'normal',
      wasAtBottom: false,
      viewportY: 12,
      baseY: 40
    })
    expect(terminal.scrollToLine).not.toHaveBeenCalled()
  })

  it('retries restore after fit when the first attempt has no element', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    const terminal = createTerminal({ viewportY: 10, baseY: 100, missingElement: true })
    const onRestored = vi.fn()
    restoreScrollStateAfterFit(
      terminal,
      {
        bufferType: 'normal',
        wasAtBottom: false,
        viewportY: 42,
        baseY: 100
      },
      { onRestored, shouldRestore: () => true }
    )
    expect(onRestored).not.toHaveBeenCalled()
  })
})
