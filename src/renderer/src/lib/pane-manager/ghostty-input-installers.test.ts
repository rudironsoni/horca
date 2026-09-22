// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { installPreviewImeBridge } from '../../components/dashboard-popout/preview-terminal-ime-bridge'
import { installPreviewTerminalKeyHandler } from '../../components/dashboard-popout/preview-terminal-key-handler'
import {
  TerminalPaneCodexRestartPortals,
  TerminalPaneProcessExitPortals
} from '../../components/terminal-pane/TerminalPaneRuntimePortals'
import { TerminalRemoteRuntimeReconnectBanner } from '../../components/terminal-pane/TerminalRemoteRuntimeReconnectBanner'
import { createTerminalStreamFixtures } from '../../components/terminal-pane/remote-runtime-pty-transport-stream-fixtures'
import { readyHostSessionInventoryResponse } from '../../components/terminal-pane/remote-runtime-pty-transport-test-harness'
import { createRemoteRuntimePtyTransport } from '../../components/terminal-pane/remote-runtime-pty-transport'
import {
  TERMINAL_IME_COMPOSER_PLACEHOLDER_CLASS,
  installTerminalImeComposerPlaceholderMask
} from '../../components/terminal-pane/terminal-ime-composer-placeholder-mask'
import { createTerminalImeLinuxCandidateState } from '../../components/terminal-pane/terminal-ime-linux-candidate-state'
import { installTerminalImeNativeTextForwarder } from '../../components/terminal-pane/terminal-ime-native-text-forwarder'
import {
  IPAD_DESKTOP_MODE_UA,
  deviceTraceKeystrokes
} from '../../components/terminal-pane/terminal-ios-hangul-preedit-fixture'
import { createTerminalIosHangulPreeditRenderer } from '../../components/terminal-pane/terminal-ios-hangul-preedit-overlay'
import { installTerminalIosHangulPreedit } from '../../components/terminal-pane/terminal-ios-hangul-preedit'
import { installTerminalImeCandidateAnchor } from './terminal-ime-candidate-anchor'
import { XTERM_COMPOSITION_SESSION_START_EVENT } from '../../components/terminal-pane/terminal-ime-composition-route'
import {
  decodeTerminalStreamFrame,
  decodeTerminalStreamText
} from '../../../../shared/terminal-stream-protocol'

function render(node: ReturnType<typeof createElement>): HTMLDivElement {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => {
    root.render(node)
  })
  return host
}

describe('ghostty input installers', () => {
  it('claims a single-character preview key and lets the caller dispose the bridge', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const sent: string[] = []
    const bridge = installPreviewImeBridge(
      {
        element: document.createElement('div'),
        input: (data: string) => {
          sent.push(data)
        }
      } as never,
      { getKittyKeyboardFlags: () => 0 }
    )
    expect(bridge).not.toBeNull()
    expect(bridge?.claimKeyEvent(new KeyboardEvent('keydown', { key: 'é' }))).toBe(true)
    expect(bridge?.claimKeyEvent(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(false)
    bridge?.dispose()
    expect(sent).toEqual([])
  })

  it('returns the preview key to the caller when the IME bridge already claimed it', () => {
    let handler: ((event: KeyboardEvent) => boolean) | undefined
    const dispose = installPreviewTerminalKeyHandler({
      terminal: {
        attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
          handler = fn
        }
      } as never,
      claimImeKeyEvent: () => true,
      pasteClipboardText: () => undefined,
      sendInput: () => undefined,
      getShortcutContext: () => ({}) as never
    })
    expect(handler?.(new KeyboardEvent('keydown', { key: 'a' }))).toBe(false)
    dispose()
  })

  it('skips runtime portals when the pane is inactive or has no pty', () => {
    const container = document.createElement('div')
    const inactive = render(
      createElement(TerminalPaneProcessExitPortals, {
        controller: { isActive: false, managedPanes: [], paneProcessExitsByPaneId: {} } as never
      })
    )
    expect(inactive.textContent).toBe('')
    const skipped = render(
      createElement(TerminalPaneCodexRestartPortals, {
        controller: {
          activePane: null,
          isActive: true,
          isVisible: true,
          managedPanes: [{ id: 1, leafId: 'leaf-a', container }],
          paneTransportsRef: { current: new Map() },
          savedLayout: {}
        } as never
      })
    )
    expect(container.textContent).toBe('')
    expect(skipped.textContent).toBe('')
  })

  it('shows the disconnected remote banner and runs the reconnect click', () => {
    let clicks = 0
    const host = render(
      createElement(TerminalRemoteRuntimeReconnectBanner, {
        phase: 'disconnected',
        onReconnect: () => {
          clicks += 1
        }
      })
    )
    expect(host.querySelector('[data-terminal-remote-runtime-reconnect-banner]')?.getAttribute(
      'data-terminal-remote-runtime-reconnect-banner'
    )).toBe('disconnected')
    const button = host.querySelector('button')
    expect(button).not.toBeNull()
    button?.click()
    expect(clicks).toBe(1)
  })

  it('emits a remote output frame that still contains the UTF-8 bytes of é', () => {
    const frames: Uint8Array[] = []
    const fixtures = createTerminalStreamFixtures({
      getCallbacks: () => ({
        onResponse: () => undefined,
        onBinary: (bytes) => {
          frames.push(bytes)
        }
      }),
      sendBinary: { mock: { calls: [] } } as never
    })
    fixtures.emitOutput(4, 'é', 9)
    const frame = decodeTerminalStreamFrame(frames[0])
    expect(frame?.streamId).toBe(4)
    expect(frame?.seq).toBe(9)
    expect(decodeTerminalStreamText(frame?.payload ?? new Uint8Array())).toBe('é')
    expect(Array.from(frame?.payload ?? [])).toEqual([0xc3, 0xa9])
  })

  it('builds a ready host inventory for the requested terminal handle', () => {
    const response = readyHostSessionInventoryResponse('pty-é', 'host-tab-9') as {
      ok: boolean
      result: { tabs: Array<{ terminal: string; parentTabId: string }> }
    }
    expect(response.ok).toBe(true)
    expect(response.result.tabs[0]?.terminal).toBe('pty-é')
    expect(response.result.tabs[0]?.parentTabId).toBe('host-tab-9')
  })

  it('starts a remote runtime transport with no pty id', () => {
    const transport = createRemoteRuntimePtyTransport('env-9')
    expect(transport.getPtyId()).toBeNull()
    expect(transport.getRuntimeEnvironmentId()).toBe('env-9')
  })

  it('does not mark a composer placeholder when the cursor line is empty', () => {
    const element = document.createElement('div')
    const mask = installTerminalImeComposerPlaceholderMask({
      element,
      rows: 24,
      buffer: { active: { baseY: 0, cursorY: 0, getLine: () => null } },
      onRender: () => ({ dispose: () => undefined })
    } as never)
    element.dispatchEvent(
      new CustomEvent(XTERM_COMPOSITION_SESSION_START_EVENT, { detail: { id: 3 } })
    )
    expect(element.classList.contains(TERMINAL_IME_COMPOSER_PLACEHOLDER_CLASS)).toBe(false)
    mask.dispose()
    expect(element.classList.contains(TERMINAL_IME_COMPOSER_PLACEHOLDER_CLASS)).toBe(false)
  })

  it('guards the next digit after an orphaned Linux letter keyup', () => {
    const plain = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false }
    const state = createTerminalImeLinuxCandidateState(() => 1_000)
    state.observeKeyboardEvent(
      { type: 'keyup', key: 'a', code: 'KeyA', ...plain } as never,
      { candidateDigitGuardActive: false }
    )
    expect(
      state.classifyKeyboardEvent({ type: 'keydown', key: '1', code: 'Digit1', ...plain } as never)
        .candidateDigitGuardActive
    ).toBe(true)
    state.reset()
    expect(
      state.classifyKeyboardEvent({ type: 'keydown', key: '1', code: 'Digit1', ...plain } as never)
        .candidateDigitGuardActive
    ).toBe(false)
  })

  it('claims a printable keydown and ignores a ctrl chord', () => {
    const element = document.createElement('div')
    const forwarder = installTerminalImeNativeTextForwarder({
      terminalElement: element,
      isComposing: () => false,
      sendInput: () => undefined,
      getKittyKeyboardFlags: () => 0
    })
    expect(
      forwarder.claimKeyEvent({
        type: 'keydown',
        key: 'é',
        code: 'KeyE',
        repeat: false
      })
    ).toBe(true)
    expect(
      forwarder.claimKeyEvent({
        type: 'keydown',
        key: 'c',
        code: 'KeyC',
        ctrlKey: true,
        repeat: false
      })
    ).toBe(false)
    forwarder.dispose()
    expect(installTerminalImeNativeTextForwarder({
      terminalElement: null,
      isComposing: () => false,
      sendInput: () => undefined
    }).claimKeyEvent({ type: 'keydown', key: 'a' })).toBe(false)
  })

  it('turns a recorded jamo and its field write into one keystroke', () => {
    expect(IPAD_DESKTOP_MODE_UA).toContain('Macintosh')
    expect(
      deviceTraceKeystrokes({
        source: 'ipad',
        userAgent: IPAD_DESKTOP_MODE_UA,
        maxTouchPoints: 5,
        typed: '가',
        expected: '가',
        observedSent: [],
        events: [
          { type: 'keydown', key: 'ᄀ', keyCode: 0, inputType: null, data: '', value: '' },
          { type: 'input', key: '', keyCode: null, inputType: 'insertText', data: '가', value: '가' }
        ]
      })
    ).toEqual([{ key: 'ᄀ', keyCode: 0, written: '가', replaces: false, shiftKey: false }])
  })

  it('paints a held Hangul syllable into the composition view', () => {
    const view = document.createElement('div')
    view.className = 'composition-view'
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    screen.getBoundingClientRect = () =>
      ({ width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) })
    const element = document.createElement('div')
    element.append(screen, view)
    const render = createTerminalIosHangulPreeditRenderer({
      element,
      cols: 80,
      rows: 24,
      buffer: { active: { cursorX: 2, cursorY: 3 } },
      options: { fontFamily: 'Menlo', fontSize: 13, theme: { background: '#111', foreground: '#eee' } }
    } as never)
    render('한')
    expect(view.textContent).toBe('한')
    expect(view.classList.contains('active')).toBe(true)
    expect(view.style.left).toBe('20px')
    render('')
    expect(view.textContent).toBe('')
    expect(view.classList.contains('active')).toBe(false)
  })

  it('holds a jamo and sends the syllable when the next key ends it', () => {
    const root = document.createElement('div')
    const textarea = document.createElement('textarea')
    textarea.className = 'xterm-helper-textarea'
    root.appendChild(textarea)
    const sent: string[] = []
    const painted: string[] = []
    const preedit = installTerminalIosHangulPreedit({
      terminalElement: root,
      isCompositionActive: () => false,
      isScreenReaderMode: () => false,
      sendInput: (data) => {
        sent.push(data)
      },
      renderPreedit: (text) => {
        painted.push(text)
      }
    })
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ᄀ', bubbles: true }))
    textarea.value = '가'
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '가' }))
    expect(preedit.heldText()).toBe('가')
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(sent).toEqual(['가'])
    expect(preedit.heldText()).toBe('')
    expect(painted.at(-1)).toBe('')
    preedit.dispose()
  })

  it('moves the IME textarea to the cursor cell', () => {
    const element = document.createElement('div')
    const screen = document.createElement('div')
    screen.className = 'xterm-screen'
    screen.getBoundingClientRect = () =>
      ({ width: 800, height: 480, top: 0, left: 0, right: 800, bottom: 480, x: 0, y: 0, toJSON: () => ({}) })
    const textarea = document.createElement('textarea')
    element.append(screen, textarea)
    document.body.appendChild(element)
    const terminal = {
      element,
      textarea,
      cols: 80,
      rows: 24,
      buffer: {
        active: {
          cursorX: 2,
          cursorY: 3,
          baseY: 0,
          getLine: () => undefined
        }
      }
    }
    const remove = installTerminalImeCandidateAnchor(terminal as never)
    expect(remove).not.toBeNull()
    element.dispatchEvent(new Event('compositionstart'))
    expect(textarea.style.top).toBe('60px')
    expect(textarea.style.left).toBe('20px')
    remove?.()
    expect(installTerminalImeCandidateAnchor({ element: null, textarea: null } as never)).toBeNull()
  })
})
