import { describe, expect, it } from 'vitest'
import {
  shouldBypassTerminalKeyboardEvent,
  shouldPreventDefaultTerminalImeCandidateKey,
  shouldSuppressTerminalImeKeyboardEvent
} from './terminal-bypass-policy'
import { event } from './terminal-bypass-event-fixture'

describe('shouldBypassTerminalKeyboardEvent — macOS', () => {
  const opts = { isMac: true, hasSelection: true }
  const noSel = { isMac: true, hasSelection: false }

  it('bubbles Cmd+C so Chromium copy fires and terminal populates clipboard', () => {
    // Why: this is the whole point of the policy. When kitty progressive
    // enhancement is on, the default terminal path CSI-u encodes Cmd+C and
    // preventDefaults the keydown, suppressing the browser copy event.
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'c', code: 'KeyC', metaKey: true }), opts)
    ).toBe(true)
  })

  it('bubbles Cmd+C even with no selection (no-op copy is harmless on macOS)', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'c', code: 'KeyC', metaKey: true }), noSel)
    ).toBe(true)
  })

  it('bubbles Cmd+V so web clients receive the native paste event', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'v', code: 'KeyV', metaKey: true }), noSel)
    ).toBe(true)
  })

  it('matches Cmd+C by produced logical key rather than physical key', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'c', code: 'KeyJ', metaKey: true }), opts)
    ).toBe(true)
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'j', code: 'KeyC', metaKey: true }), opts)
    ).toBe(false)
  })

  it('does NOT bubble other Cmd chords — Orca window handlers intercept them before terminal', () => {
    // Why: this policy is narrowly scoped to clipboard chords. Cmd+F, Cmd+D,
    // Cmd+K, Cmd+W, Cmd+Arrow, Cmd+Backspace are handled in keyboard-handlers.ts
    // with stopImmediatePropagation before terminal's textarea listener fires.
    // Cmd+A is claimed by keyboard-handlers.ts before terminal, including when
    // Kitty keyboard reporting replaces terminal's legacy select-all evaluator.
    const cases = [
      event({ key: 'a', code: 'KeyA', metaKey: true }),
      event({ key: 't', code: 'KeyT', metaKey: true })
    ]
    for (const e of cases) {
      expect(shouldBypassTerminalKeyboardEvent(e, opts)).toBe(false)
    }
  })

  it('bubbles already-handled Cmd app shortcuts so kitty does not also write to shell', () => {
    // Why: some window-level shortcuts call preventDefault without stopping
    // propagation. App shortcuts must not also become terminal input.
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ key: 'b', code: 'KeyB', defaultPrevented: true, metaKey: true }),
        opts
      )
    ).toBe(true)
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({
          key: 'ArrowLeft',
          code: 'ArrowLeft',
          defaultPrevented: true,
          metaKey: true,
          altKey: true
        }),
        opts
      )
    ).toBe(true)
  })

  it('does not bubble Cmd+Shift+C — already intercepted in keyboard-handlers.ts', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ key: 'C', code: 'KeyC', metaKey: true, shiftKey: true }),
        opts
      )
    ).toBe(false)
  })

  it('does not bubble Ctrl chords — those must reach the shell', () => {
    // Ctrl+C is SIGINT, Ctrl+D is EOF, etc. — terminal must see them.
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'c', code: 'KeyC', ctrlKey: true }), opts)
    ).toBe(false)
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'd', code: 'KeyD', ctrlKey: true }), opts)
    ).toBe(false)
  })

  it('does not bubble Cmd+Ctrl combos (unusual; defer to terminal)', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ key: 'c', code: 'KeyC', metaKey: true, ctrlKey: true }),
        opts
      )
    ).toBe(false)
  })

  it('does not bubble already-handled Ctrl chords on macOS', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ key: 'c', code: 'KeyC', defaultPrevented: true, ctrlKey: true }),
        opts
      )
    ).toBe(false)
  })

  it('does not bubble plain letters — those are normal input', () => {
    expect(shouldBypassTerminalKeyboardEvent(event({ key: 'c', code: 'KeyC' }), opts)).toBe(false)
  })

  it('no longer special-cases Backslash — the native-text forwarder owns it', () => {
    // Why: this policy carried a `code === 'Backslash'` bypass because the old
    // forwarder only claimed keys for input sources on a hardcoded allowlist.
    // The structural claim covers every printable key, so the exception is gone
    // and the physical key is no longer named anywhere in this file.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      for (const kittyKeyboardFlags of [0, 1]) {
        expect(
          shouldBypassTerminalKeyboardEvent(event({ type, key: '\\', code: 'Backslash' }), {
            ...noSel,
            kittyKeyboardFlags
          })
        ).toBe(false)
      }
    }
  })

  it('bubbles Shift+non-ASCII printable text so the active keyboard layout wins', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'Ф', code: 'KeyA', shiftKey: true }), opts)
    ).toBe(true)
  })

  it('bubbles Shift+non-ASCII keyup so kitty does not emit a Latin release sequence', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ type: 'keyup', key: 'Ф', code: 'KeyA', shiftKey: true }),
        opts
      )
    ).toBe(true)
  })

  it('does not bubble Shift+non-ASCII keypress because that carries the layout text', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(
        event({ type: 'keypress', key: 'Ф', code: 'KeyA', shiftKey: true }),
        opts
      )
    ).toBe(false)
  })

  it('does not bubble Shift+Latin printable text', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: 'A', code: 'KeyA', shiftKey: true }), opts)
    ).toBe(false)
  })

  it('leaves ordinary Shift+Space available to the terminal', () => {
    expect(
      shouldBypassTerminalKeyboardEvent(event({ key: ' ', code: 'Space', shiftKey: true }), opts)
    ).toBe(false)
  })
})

describe('shouldSuppressTerminalImeKeyboardEvent — macOS', () => {
  const idle = {
    isMac: true,
    isLinux: false,
    compositionActive: false,
    candidateKeyGuardActive: false,
    pendingCandidateKeyReleaseActive: false
  }
  const composing = {
    isMac: true,
    isLinux: false,
    compositionActive: true,
    candidateKeyGuardActive: true,
    pendingCandidateKeyReleaseActive: false
  }

  it('suppresses keyboard events while Chromium reports active IME composition', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ key: 'Backspace', code: 'Backspace', isComposing: true }),
        idle
      )
    ).toBe(true)
  })

  it('lets standalone Process keys reach terminal so its CompositionHelper can diff text', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ key: 'Process', code: 'KeyN', keyCode: 229 }),
        idle
      )
    ).toBe(false)
  })

  it('suppresses standalone Process keyups so kitty release reporting cannot leak', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ type: 'keyup', key: 'Process', code: 'KeyN', keyCode: 229 }),
        idle
      )
    ).toBe(true)
  })

  it('suppresses Process keys while the terminal composition tracker is active', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ key: 'Process', code: 'KeyN', keyCode: 229 }),
        composing
      )
    ).toBe(true)
  })

  it('does not suppress ordinary Backspace outside IME composition', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(event({ key: 'Backspace', code: 'Backspace' }), idle)
    ).toBe(false)
  })

  it('suppresses IME-owned editing keys while composition is active', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ key: 'Backspace', code: 'Backspace' }),
        composing
      )
    ).toBe(true)
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ key: 'ArrowDown', code: 'ArrowDown' }),
        composing
      )
    ).toBe(true)
  })

  it('does not suppress ordinary text keys solely because composition is active', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(event({ key: 'a', code: 'KeyA' }), composing)
    ).toBe(false)
  })

  it('does not suppress keypress events because they carry committed text', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ type: 'keypress', key: '中', code: '', isComposing: true }),
        idle
      )
    ).toBe(false)
  })

  it('does not apply the Linux/Sogou candidate guard to macOS', () => {
    expect(
      shouldSuppressTerminalImeKeyboardEvent(event({ key: ' ', code: 'Space' }), composing)
    ).toBe(false)
    expect(
      shouldSuppressTerminalImeKeyboardEvent(
        event({ type: 'keypress', key: '2', code: 'Digit2' }),
        composing
      )
    ).toBe(false)
    expect(
      shouldPreventDefaultTerminalImeCandidateKey(event({ key: ' ', code: 'Space' }), composing)
    ).toBe(false)
  })
})
