// @vitest-environment happy-dom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const terminalHarness = vi.hoisted(() => ({
  instances: [] as {
    write: ReturnType<typeof vi.fn>
    writeCallbacks: (() => void)[]
    onDataListener: ((data: string) => void) | null
    dispose: ReturnType<typeof vi.fn>
    resize: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    paste: ReturnType<typeof vi.fn>
    input: ReturnType<typeof vi.fn<(data: string) => void>>
    scrollToTop: ReturnType<typeof vi.fn>
    scrollToBottom: ReturnType<typeof vi.fn>
    selectAll: ReturnType<typeof vi.fn>
    modes: { bracketedPasteMode: boolean }
    selectionText: string
    customKeyHandler: ((event: KeyboardEvent) => boolean) | null
    element: HTMLCanvasElement
  }[],
  userInputListener: null as (() => void) | null,
  userInputDispose: vi.fn()
}))

const platformState = vi.hoisted(() => ({ value: 'linux' }))
const storeState = vi.hoisted(() => ({
  settings: null,
  keybindings: {} as Record<string, string[]>
}))

const imeHarness = vi.hoisted(() => ({
  forwarders: [] as {
    claimKeyEvent: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    sendInput: (data: string) => void
    getKittyKeyboardFlags: () => number
  }[],
  trackers: [] as { dispose: ReturnType<typeof vi.fn> }[],
  claimResult: false
}))

vi.mock('@/lib/ghostty-vt-web-host', () => ({
  primeGhosttyVtHost: () => Promise.resolve({})
}))
vi.mock('@/lib/pane-manager/orca-pane-terminal', () => ({
  OrcaPaneTerminal: class {
    cols = 80
    rows = 24
    cursor = { x: 0, y: 0 }
    writeCallbacks: (() => void)[] = []
    onDataListener: ((data: string) => void) | null = null
    selectionText = ''
    options = {}
    write = vi.fn((_data: string, callback?: () => void) => {
      if (callback) {
        this.writeCallbacks.push(callback)
      }
    })
    focus = vi.fn()
    dispose = vi.fn()
    resize = vi.fn()
    reset = vi.fn()
    applyMetrics = vi.fn()
    modes = { bracketedPasteMode: false }
    paste = vi.fn((data: string) => {
      this.onDataListener?.(data)
    })
    input = vi.fn((data: string) => {
      this.onDataListener?.(data)
    })
    element = document.createElement('canvas')
    scrollToTop = vi.fn()
    scrollToBottom = vi.fn()
    selectAll = vi.fn()
    getSelection = vi.fn(() => this.selectionText)
    clearSelection = vi.fn()
    encodeKey = vi.fn(() => '')
    get customKeyHandler(): ((event: KeyboardEvent) => boolean) | null {
      return (event: KeyboardEvent) => {
        this.element.dispatchEvent(event)
        return !event.defaultPrevented
      }
    }
    onData = vi.fn((listener: (data: string) => void) => {
      this.onDataListener = listener
      return { dispose: vi.fn() }
    })

    constructor() {
      terminalHarness.instances.push(this)
    }
  }
}))
vi.mock(import('@/lib/pane-manager/pane-terminal-options'), async (importOriginal) =>
  importOriginal()
)
vi.mock('@/components/terminal-pane/terminal-user-input-signal', () => ({
  subscribeToTerminalUserInput: (_terminal: unknown, listener: () => void) => {
    terminalHarness.userInputListener = listener
    return { dispose: terminalHarness.userInputDispose }
  }
}))
vi.mock('@/components/terminal-pane/use-system-prefers-dark', () => ({
  useSystemPrefersDark: () => false
}))
vi.mock('@/lib/shortcut-platform', () => ({
  getShortcutPlatform: () => platformState.value
}))
vi.mock('@/components/terminal-pane/terminal-ime-native-text-forwarder', () => ({
  installTerminalImeNativeTextForwarder: (args: {
    sendInput: (data: string) => void
    getKittyKeyboardFlags?: () => number
  }) => {
    const forwarder = {
      claimKeyEvent: vi.fn(() => imeHarness.claimResult),
      dispose: vi.fn(),
      sendInput: args.sendInput,
      // Why captured: the bridge's whole job is handing the live mirror to the
      // forwarder, so the test reads what a real commit would read.
      getKittyKeyboardFlags: args.getKittyKeyboardFlags ?? ((): number => 0)
    }
    imeHarness.forwarders.push(forwarder)
    return forwarder
  }
}))
vi.mock('@/components/terminal-pane/terminal-ime-composition-tracker', () => ({
  installTerminalImeCompositionTracker: () => {
    const tracker = { isActive: () => false, dispose: vi.fn() }
    imeHarness.trackers.push(tracker)
    return tracker
  }
}))
vi.mock('@/store', () => {
  const useAppStore = (selector: (s: typeof storeState) => unknown): unknown => selector(storeState)
  useAppStore.getState = (): typeof storeState => storeState
  return { useAppStore }
})

import { AgentTerminalPreview } from './AgentTerminalPreview'

describe('AgentTerminalPreview', () => {
  const input = vi.fn(async (_ptyId: string, _data: string) => true)
  const fit = vi.fn(async (_ptyId: string, cols: number, rows: number) => ({ cols, rows }))
  const ack = vi.fn(async () => {})
  const unsubscribe = vi.fn(async () => {})
  const connect = vi.fn()
  const readClipboardText = vi.fn(async () => 'clip-text')
  const writeClipboardText = vi.fn(async () => {})
  const writeTerminalClipboardText = vi.fn(async () => {})
  let emitData: ((payload: unknown) => void) | null

  beforeEach(() => {
    terminalHarness.instances.length = 0
    terminalHarness.userInputListener = null
    platformState.value = 'linux'
    storeState.keybindings = {}
    imeHarness.forwarders.length = 0
    imeHarness.trackers.length = 0
    imeHarness.claimResult = false
    emitData = null
    connect.mockResolvedValue({
      snapshot: { data: '', cols: 80, rows: 24, seq: 1 },
      replay: []
    })
    readClipboardText.mockResolvedValue('clip-text')
    Object.assign(window, {
      api: {
        terminalPreview: {
          connect,
          input,
          fit,
          ack,
          unsubscribe,
          onData: (listener: (payload: unknown) => void) => {
            emitData = listener
            return vi.fn()
          }
        },
        ui: {
          readClipboardText,
          writeClipboardText,
          writeTerminalClipboardText,
          performNativeSelectionAction: vi.fn()
        }
      }
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('routes signaled user input while a live write parses and drops parser replies', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.onDataListener).not.toBeNull())

    act(() => {
      emitData?.({ type: 'data', ptyId: 'pty-1', data: '\x1b[6n', bytes: 4 })
    })
    expect(terminal.write).toHaveBeenCalledWith('\x1b[6n', expect.any(Function))

    act(() => {
      terminal.input('k')
    })
    expect(input).toHaveBeenCalledTimes(1)
    expect(input).toHaveBeenCalledWith('pty-1', 'k')

    act(() => terminal.writeCallbacks.shift()?.())
    expect(ack).toHaveBeenCalledWith('pty-1', 4)
  })

  it('installs the macOS IME native-text forwarder and lets its claims bypass chord handling', async () => {
    platformState.value = 'darwin'
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())
    expect(imeHarness.forwarders).toHaveLength(1)
    expect(imeHarness.trackers).toHaveLength(1)

    imeHarness.forwarders[0]!.sendInput('。')
    expect(terminal.input).toHaveBeenCalledOnce()
    expect(input).toHaveBeenCalledOnce()
    expect(input).toHaveBeenCalledWith('pty-1', '。')

    // A claimed native-text key bypasses terminal AND the clipboard chords.
    imeHarness.claimResult = true
    terminal.selectionText = 'selected text'
    const claimed = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true
    })
    terminal.customKeyHandler!(claimed)
    expect(claimed.defaultPrevented).toBe(true)
    expect(writeClipboardText).not.toHaveBeenCalled()
    expect(writeTerminalClipboardText).not.toHaveBeenCalled()

    // Unclaimed events still reach the chord handling.
    imeHarness.claimResult = false
    const copied = terminal.customKeyHandler!(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        metaKey: true,
        cancelable: true
      })
    )
    expect(copied).toBe(false)
    expect(writeTerminalClipboardText).toHaveBeenCalledWith('selected text')
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('does not install the IME native-text forwarder off macOS', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    await waitFor(() => expect(terminalHarness.instances[0]!.customKeyHandler).not.toBeNull())
    expect(imeHarness.forwarders).toHaveLength(0)
    expect(imeHarness.trackers).toHaveLength(0)
  })

  // The bridge omitted this dependency entirely, so every Preview
  // commit was evaluated at flags 0. Ordering and provenance live in
  // preview-terminal-snapshot-replay.test.ts; this pins the wiring.
  it('hands the forwarder the live mirror seeded from the snapshot flags', async () => {
    platformState.value = 'darwin'
    connect.mockResolvedValue({
      snapshot: { data: '', cols: 80, rows: 24, seq: 1, kittyKeyboardFlags: 8 },
      replay: []
    })
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(imeHarness.forwarders).toHaveLength(1))
    await waitFor(() => expect(imeHarness.forwarders[0]!.getKittyKeyboardFlags()).toBe(8))

    // Live output keeps advancing the same mirror the forwarder reads.
    act(() => {
      emitData?.({ type: 'data', ptyId: 'pty-1', data: '\x1b[<u', bytes: 4 })
    })
    expect(imeHarness.forwarders[0]!.getKittyKeyboardFlags()).toBe(0)
  })

  it('disposes the IME bridge on unmount', async () => {
    platformState.value = 'darwin'
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(imeHarness.forwarders).toHaveLength(1))
    view.unmount()
    expect(imeHarness.forwarders[0]!.dispose).toHaveBeenCalledTimes(1)
    expect(imeHarness.trackers[0]!.dispose).toHaveBeenCalledTimes(1)
  })

  it('disposes the IME bridge once when the PTY disappears', async () => {
    platformState.value = 'darwin'
    connect.mockResolvedValueOnce({
      snapshot: { data: '', cols: 80, rows: 24, seq: 1 },
      replay: []
    })
    connect.mockResolvedValueOnce({ snapshot: null, replay: [] })
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(imeHarness.forwarders).toHaveLength(1))

    act(() => emitData?.({ type: 'resync', ptyId: 'pty-1' }))
    await waitFor(() => expect(imeHarness.forwarders[0]!.dispose).toHaveBeenCalledOnce())
    expect(imeHarness.trackers[0]!.dispose).toHaveBeenCalledOnce()

    view.unmount()
    expect(imeHarness.forwarders[0]!.dispose).toHaveBeenCalledOnce()
    expect(imeHarness.trackers[0]!.dispose).toHaveBeenCalledOnce()
  })

  it('copies the terminal selection on the copy chord and blocks terminal handling', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    terminal.selectionText = 'selected text'
    const keydown = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true
    })
    terminal.customKeyHandler!(keydown)
    const keyup = new KeyboardEvent('keyup', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true
    })
    terminal.customKeyHandler!(keyup)
    expect(keydown.defaultPrevented).toBe(true)
    expect(keyup.defaultPrevented).toBe(true)
    expect(writeTerminalClipboardText).toHaveBeenCalledWith('selected text')
    expect(writeClipboardText).not.toHaveBeenCalled()
  })

  it('keeps an empty copy chord from leaking terminal input', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const keydown = new KeyboardEvent('keydown', {
      key: 'C',
      code: 'KeyC',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true
    })
    terminal.customKeyHandler!(keydown)
    expect(keydown.defaultPrevented).toBe(true)
    expect(writeTerminalClipboardText).not.toHaveBeenCalled()
    expect(terminal.input).not.toHaveBeenCalled()
  })

  it('leaves bare Ctrl+C available to the terminal without a selection', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const handled = terminal.customKeyHandler!(
      new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', ctrlKey: true })
    )
    expect(handled).toBe(true)
    expect(writeTerminalClipboardText).not.toHaveBeenCalled()
  })

  it('selects all terminal text on Cmd+A and blocks terminal handling', async () => {
    platformState.value = 'darwin'
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const keydown = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      metaKey: true,
      cancelable: true
    })
    expect(terminal.customKeyHandler!(keydown)).toBe(false)
    expect(keydown.defaultPrevented).toBe(true)

    const repeat = new KeyboardEvent('keydown', {
      key: 'a',
      code: 'KeyA',
      metaKey: true,
      repeat: true,
      cancelable: true
    })
    expect(terminal.customKeyHandler!(repeat)).toBe(false)
    expect(repeat.defaultPrevented).toBe(true)
    expect(terminal.selectAll).toHaveBeenCalledOnce()
  })

  it('sends the word-kill byte on Ctrl+Backspace and blocks terminal handling', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const keydown = new KeyboardEvent('keydown', {
      key: 'Backspace',
      code: 'Backspace',
      ctrlKey: true,
      cancelable: true
    })
    const handled = terminal.customKeyHandler!(keydown)

    expect(handled).toBe(false)
    expect(keydown.defaultPrevented).toBe(true)
    expect(terminal.input).toHaveBeenCalledWith('\x17')
    await waitFor(() => expect(input).toHaveBeenCalledWith('pty-1', '\x17'))
  })

  it('swallows a pane-scoped chord instead of leaking its control byte to the agent', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    // Ctrl+Shift+D splits a pane on Linux; terminal would otherwise send Ctrl+D.
    const keydown = new KeyboardEvent('keydown', {
      key: 'D',
      code: 'KeyD',
      ctrlKey: true,
      shiftKey: true,
      cancelable: true
    })
    const handled = terminal.customKeyHandler!(keydown)

    expect(handled).toBe(false)
    expect(keydown.defaultPrevented).toBe(true)
    expect(terminal.input).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()
  })

  it('keeps a native input-source chord from inserting text into the preview', async () => {
    storeState.keybindings = { 'terminal.switchInputSource': ['Shift+Space'] }
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const keydown = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    terminal.customKeyHandler!(keydown)
    expect(keydown.defaultPrevented).toBe(false)

    const keypress = new KeyboardEvent('keypress', {
      key: ' ',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(keypress)
    expect(keypress.defaultPrevented).toBe(true)

    const beforeInput = new InputEvent('beforeinput', {
      data: ' ',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(beforeInput)
    expect(beforeInput.defaultPrevented).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }))
    const unarmedBeforeInput = new InputEvent('beforeinput', {
      data: ' ',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true
    })
    window.dispatchEvent(unarmedBeforeInput)
    expect(unarmedBeforeInput.defaultPrevented).toBe(false)
    expect(terminal.input).not.toHaveBeenCalled()
    expect(input).not.toHaveBeenCalled()

    view.unmount()
  })

  it('defers Option chords to terminal once the TUI negotiates kitty keyboard mode', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const altBackspace = (): KeyboardEvent =>
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        altKey: true,
        cancelable: true
      })
    expect(terminal.customKeyHandler!(altBackspace())).toBe(false)
    expect(terminal.input).toHaveBeenCalledWith('\x1b\x7f')

    // The agent's TUI pushes kitty flags (CSI > 1 u) on the live stream.
    act(() => {
      emitData?.({ type: 'data', ptyId: 'pty-1', data: '\x1b[>1u', bytes: 5 })
    })
    terminal.input.mockClear()

    expect(terminal.customKeyHandler!(altBackspace())).toBe(true)
    expect(terminal.input).not.toHaveBeenCalled()
  })

  // Why: a snapshot carries the TUI's one-time kitty push and the post-snapshot
  // replay redelivers it. Applying replays with stack semantics would leave the
  // TUI's single pop on a stale frame, so a plain shell keeps getting
  // kitty-encoded Option chords.
  it('does not let a redelivered kitty push outlive the TUI pop', async () => {
    connect.mockResolvedValueOnce({
      snapshot: { data: '\x1b[>1u', cols: 80, rows: 24, seq: 1 },
      replay: ['\x1b[>1u']
    })
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const altBackspace = (): KeyboardEvent =>
      new KeyboardEvent('keydown', {
        key: 'Backspace',
        code: 'Backspace',
        altKey: true,
        cancelable: true
      })
    expect(terminal.customKeyHandler!(altBackspace())).toBe(true)

    // The TUI exits and pops once on the live stream.
    act(() => {
      emitData?.({ type: 'data', ptyId: 'pty-1', data: '\x1b[<u', bytes: 4 })
    })

    expect(terminal.customKeyHandler!(altBackspace())).toBe(false)
    expect(terminal.input).toHaveBeenCalledWith('\x1b\x7f')
  })

  it('scrolls the viewport on the macOS scrollback chord', async () => {
    platformState.value = 'darwin'
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const handled = terminal.customKeyHandler!(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        code: 'ArrowUp',
        metaKey: true,
        cancelable: true
      })
    )

    expect(handled).toBe(false)
    expect(terminal.scrollToTop).toHaveBeenCalled()
    expect(terminal.input).not.toHaveBeenCalled()
  })

  it('leaves an unmodified Backspace to terminal', async () => {
    render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    await waitFor(() => expect(terminal.customKeyHandler).not.toBeNull())

    const handled = terminal.customKeyHandler!(
      new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', cancelable: true })
    )

    expect(handled).toBe(true)
    expect(terminal.input).not.toHaveBeenCalled()
  })

  it('keeps the existing terminal visible while a resync snapshot is captured', async () => {
    let resolveRefresh!: (value: {
      snapshot: { data: string; cols: number; rows: number; seq: number }
      replay: string[]
    }) => void
    connect
      .mockResolvedValueOnce({
        snapshot: { data: 'first', cols: 80, rows: 24, seq: 1 },
        replay: []
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRefresh = resolve
          })
      )
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!

    act(() => emitData?.({ type: 'resync', ptyId: 'pty-1' }))
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    expect(terminalHarness.instances).toHaveLength(1)
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(terminal.reset).not.toHaveBeenCalled()
    expect(view.queryByText(/No live terminal/)).not.toBeInTheDocument()

    await act(async () => {
      resolveRefresh({
        snapshot: { data: 'second', cols: 100, rows: 30, seq: 2 },
        replay: []
      })
    })
    await waitFor(() => expect(terminal.reset).toHaveBeenCalledTimes(1))
    expect(terminal.resize).toHaveBeenCalledWith(100, 30)
    expect(terminalHarness.instances).toHaveLength(1)
    expect(terminal.dispose).not.toHaveBeenCalled()
    expect(view.queryByText(/No live terminal/)).not.toBeInTheDocument()
  })

  it('disposes a stale terminal when resync confirms the pty is gone', async () => {
    connect
      .mockResolvedValueOnce({
        snapshot: { data: 'first', cols: 80, rows: 24, seq: 1 },
        replay: []
      })
      .mockResolvedValueOnce({ snapshot: null, replay: [] })
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!

    act(() => emitData?.({ type: 'resync', ptyId: 'pty-1' }))

    await waitFor(() => expect(view.getByText(/No live terminal/)).toBeInTheDocument())
    expect(terminal.dispose).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledWith('pty-1')
  })

  it('does not claim a remote pane closed when no snapshot can exist for it', async () => {
    connect.mockResolvedValueOnce({ snapshot: null, replay: [] })
    const view = render(<AgentTerminalPreview ptyId="ssh:devbox@@pty-3" />)

    await waitFor(() => expect(view.getByText(/remote session/)).toBeInTheDocument())
    expect(view.queryByText(/pane has closed/)).not.toBeInTheDocument()
  })

  it('connects a replacement pty after the previous pty was gone', async () => {
    connect.mockResolvedValueOnce({ snapshot: null, replay: [] }).mockResolvedValueOnce({
      snapshot: { data: 'replacement', cols: 80, rows: 24, seq: 1 },
      replay: []
    })
    const view = render(<AgentTerminalPreview ptyId="pty-gone" />)
    await waitFor(() => expect(view.getByText(/No live terminal/)).toBeInTheDocument())

    view.rerender(<AgentTerminalPreview ptyId="pty-live" />)

    await waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    expect(connect).toHaveBeenLastCalledWith('pty-live', { scrollbackRows: 24 })
    expect(view.queryByText(/No live terminal/)).not.toBeInTheDocument()
  })

  it('claims a grid sized to the dialog box and never re-requests an unchanged target', async () => {
    vi.useFakeTimers()
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await vi.waitFor(() => expect(terminalHarness.instances).toHaveLength(1))

    const host = view.container.querySelector<HTMLElement>('.origin-bottom-left')!
    const box = host.parentElement!
    Object.defineProperty(box, 'clientWidth', { configurable: true, value: 900 })
    Object.defineProperty(box, 'clientHeight', { configurable: true, value: 480 })
    const terminal = terminalHarness.instances[0]!
    Object.defineProperty(terminal.element, 'offsetWidth', { configurable: true, value: 800 })
    Object.defineProperty(terminal.element, 'offsetHeight', { configurable: true, value: 384 })

    await vi.advanceTimersByTimeAsync(200)
    expect(fit).toHaveBeenCalledTimes(1)
    expect(fit).toHaveBeenCalledWith('pty-1', 90, 30)

    // A reconnect (e.g. the host reclaiming the grid) computes the same
    // target — no repeat claim, so no resize tug-of-war with the host.
    act(() => emitData?.({ type: 'resync', ptyId: 'pty-1' }))
    await vi.waitFor(() => expect(connect).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(400)
    expect(fit).toHaveBeenCalledTimes(1)
  })

  it('delays repeated capture after an overflow and cancels the retry on unmount', async () => {
    vi.useFakeTimers()
    connect.mockResolvedValue({
      snapshot: { data: 'screen', cols: 80, rows: 24, seq: 1 },
      replay: [],
      resyncRequired: true
    })
    const view = render(<AgentTerminalPreview ptyId="pty-1" />)
    await vi.waitFor(() => expect(terminalHarness.instances).toHaveLength(1))
    const terminal = terminalHarness.instances[0]!
    expect(connect).toHaveBeenCalledTimes(1)

    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    await vi.advanceTimersByTimeAsync(149)
    expect(connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(connect).toHaveBeenCalledTimes(2)

    act(() => terminal.writeCallbacks.splice(0).forEach((callback) => callback()))
    view.unmount()
    await vi.advanceTimersByTimeAsync(150)
    expect(connect).toHaveBeenCalledTimes(2)
  })
})
