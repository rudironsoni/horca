// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPreviewClipboardPaster } from '../../components/dashboard-popout/preview-terminal-paste'
import { shouldShowOsc52ClipboardDefaultOnNotice } from '../../components/terminal-pane/osc52-clipboard-default-on-notice'
import { OSC52_CLIPBOARD_SETTING_ID } from '../../components/terminal-pane/osc52-clipboard-setting-anchor'
import {
  handleOsc52ClipboardRequest,
  parseOsc52,
  resolveOsc52ClipboardGate
} from '../../components/terminal-pane/osc52-clipboard'
import { resolveProtectedMultilinePasteOptionsForAgentEvidence } from '../../components/terminal-pane/terminal-agent-paste-bracketing'
import {
  encodeWindowsInputRecordPasteText,
  markTerminalBracketedPasteInterrupted,
  observeTerminalBracketedPasteModeOutput,
  pasteTerminalText,
  sanitizeBracketedPasteText,
  wrapTerminalBracketedPasteText
} from '../../components/terminal-pane/terminal-bracketed-paste'
import { readTerminalClipboardSelection } from '../../components/terminal-pane/terminal-clipboard-selection-text'
import { installTerminalNativeCopyGutterTrim } from '../../components/terminal-pane/terminal-native-copy-gutter'
import { getTerminalPaneMenuShortcutPlatform } from '../../components/terminal-pane/terminal-pane-menu-paste'
import { formatClipboardImagePasteError } from '../../components/terminal-pane/terminal-pane-paste-execution'
import { chunkTerminalPastePlan } from '../../components/terminal-pane/terminal-paste-chunks'
import { createTerminalPastePayload } from '../../components/terminal-pane/terminal-paste-coordinator'
import { createRedactedPasteDiagnostic } from '../../components/terminal-pane/terminal-paste-diagnostics'
import { formatTerminalPasteExecutionError } from '../../components/terminal-pane/terminal-paste-errors'
import { getTerminalPasteOperationTimeoutMs } from '../../components/terminal-pane/terminal-paste-executor'
import {
  TERMINAL_PASTE_DIRECT_MAX_BYTES,
  TERMINAL_PASTE_OPERATION_TIMEOUT_MS,
  TERMINAL_REMOTE_PASTE_OPERATION_TIMEOUT_MS
} from '../../components/terminal-pane/terminal-paste-limits'
import { utf8ByteLength } from '../../components/terminal-pane/terminal-paste-payload-metadata'
import { getTerminalPasteSshRemotePlatform } from '../../components/terminal-pane/terminal-paste-ssh-platform'
import {
  isTerminalPanePasteFocusCurrent,
  isTerminalPanePasteTargetCurrent
} from '../../components/terminal-pane/terminal-paste-target-state'
import { handleTerminalProgrammaticTextPaste } from '../../components/terminal-pane/terminal-programmatic-text-paste'
import { copyTerminalSelection } from '../../components/terminal-pane/terminal-selection-copy'

describe('ghostty clipboard behavior', () => {
  it('brackets a paste, strips a framing escape, and sends a Windows newline as CSI-u', () => {
    expect(wrapTerminalBracketedPasteText('é\n')).toBe('\x1b[200~é\r\x1b[201~')
    expect(sanitizeBracketedPasteText('a\x1b[201~b')).toBe('a\u241b[201~b')
    expect(encodeWindowsInputRecordPasteText('a\nb', 'csi-u')).toBe('a\x1b[13;2ub')
    const sent: string[] = []
    const terminal = {
      modes: { bracketedPasteMode: true },
      options: { ignoreBracketedPasteMode: false },
      input: (data: string) => {
        sent.push(data)
      },
      paste: () => undefined
    }
    pasteTerminalText(terminal, 'é', { forceBracketedPaste: true })
    expect(sent).toEqual(['\x1b[200~é\x1b[201~'])
    markTerminalBracketedPasteInterrupted(terminal)
    observeTerminalBracketedPasteModeOutput(terminal, '\x1b[?2004h')
    observeTerminalBracketedPasteModeOutput(terminal, 'x')
    expect(sent).toEqual(['\x1b[200~é\x1b[201~'])
  })

  it('blocks an OSC 52 write while replaying and writes the decoded text when allowed', () => {
    expect(resolveOsc52ClipboardGate({ settingEnabled: true, replaying: true })).toEqual({
      allowClipboardWrite: false,
      shouldSurfaceBlockedWrite: false
    })
    expect(resolveOsc52ClipboardGate({ settingEnabled: false, replaying: false })).toEqual({
      allowClipboardWrite: false,
      shouldSurfaceBlockedWrite: true
    })
    expect(parseOsc52('c;?')).toEqual({ kind: 'query' })
    expect(parseOsc52('c;w6k=')).toEqual({ kind: 'write', selections: 'c', text: 'é' })
    const written: string[] = []
    expect(
      handleOsc52ClipboardRequest('c;w6k=', {
        allowClipboardWrite: true,
        writeClipboardText: async (text) => {
          written.push(text)
        }
      })
    ).toBe(true)
    expect(written).toEqual(['é'])
    expect(OSC52_CLIPBOARD_SETTING_ID).toBe('terminal-osc52-clipboard')
    expect(shouldShowOsc52ClipboardDefaultOnNotice({
      persistedUIReady: true,
      noticePending: true
    })).toBe(true)
    expect(shouldShowOsc52ClipboardDefaultOnNotice({
      persistedUIReady: false,
      noticePending: true
    })).toBe(false)
  })

  it('copies the selection text and trims nothing when the gutter setting is off', async () => {
    const copied: string[] = []
    let cleared = 0
    const terminal = {
      getSelection: () => 'é',
      clearSelection: () => {
        cleared += 1
      }
    }
    await expect(copyTerminalSelection({
      terminal,
      writeClipboardText: async (text) => {
        copied.push(text)
      },
      clearSelectionOnSuccess: true
    })).resolves.toBe(true)
    expect(copied).toEqual([readTerminalClipboardSelection(terminal)])
    expect(cleared).toBe(1)
    await expect(copyTerminalSelection({
      terminal: { getSelection: () => '', clearSelection: () => undefined },
      writeClipboardText: async () => undefined
    })).resolves.toBe(false)
  })

  it('keeps a paste only while the same connected pty still owns the pane', () => {
    const transport = { getPtyId: () => 'pty-1', isConnected: () => true }
    const transports = new Map([[3, transport]])
    expect(isTerminalPanePasteTargetCurrent({
      manager: { getPanes: () => [{ id: 3, leafId: 'leaf-a' }] },
      paneTransports: transports,
      paneId: 3,
      leafId: 'leaf-a',
      transport,
      ptyId: 'pty-1'
    })).toBe(true)
    expect(isTerminalPanePasteTargetCurrent({
      manager: { getPanes: () => [{ id: 3, leafId: 'leaf-a' }] },
      paneTransports: transports,
      paneId: 3,
      leafId: 'leaf-b',
      transport,
      ptyId: 'pty-1'
    })).toBe(false)
    const pane = document.createElement('div')
    const field = document.createElement('textarea')
    field.className = 'xterm-helper-textarea'
    pane.appendChild(field)
    field.focus()
    expect(isTerminalPanePasteFocusCurrent({
      requireSameFocusedElement: true,
      activeElementAtDispatch: field,
      paneContainer: pane
    })).toBe(true)
  })

  it('chunks a bracketed é and reports a local paste timeout', () => {
    expect(utf8ByteLength('é')).toBe(2)
    expect(TERMINAL_PASTE_DIRECT_MAX_BYTES).toBe(64 * 1024)
    const payload = createTerminalPastePayload({ text: 'é', source: 'keyboard' })
    expect(payload.byteLength).toBe(2)
    expect(payload.hasControlSequences).toBe(false)
    const chunks = chunkTerminalPastePlan({
      bracketed: true,
      payload: { plainText: 'é' },
      newlinePolicy: 'cr',
      maxChunkBytes: 16
    } as never)
    expect(chunks[0]).toBe('\x1b[200~')
    expect(chunks).toContain('é')
    expect(chunks.at(-1)).toBe('\x1b[201~')
    expect(formatTerminalPasteExecutionError('payload-too-large')).toContain('too large')
    expect(formatClipboardImagePasteError(new Error('denied'))).toBe('Image paste failed: denied')
    const plan = {
      mode: 'direct',
      runtimeKey: 'local:darwin',
      payload,
      target: { runtime: { kind: 'local' } }
    }
    expect(createRedactedPasteDiagnostic(plan as never)).toContain('bytes=2')
    expect(createRedactedPasteDiagnostic(plan as never)).toContain('content=redacted')
    expect(getTerminalPasteOperationTimeoutMs(plan as never)).toBe(TERMINAL_PASTE_OPERATION_TIMEOUT_MS)
    expect(getTerminalPasteOperationTimeoutMs({
      target: { runtime: { kind: 'ssh' } }
    } as never)).toBe(TERMINAL_REMOTE_PASTE_OPERATION_TIMEOUT_MS)
    expect(getTerminalPasteSshRemotePlatform(null)).toBeNull()
  })

  it('forces bracketed multiline paste for a live agent and ignores an empty programmatic paste', () => {
    expect(resolveProtectedMultilinePasteOptionsForAgentEvidence({
      isWindowsClient: false,
      hostPlatform: 'darwin',
      foregroundAgent: 'codex',
      entry: undefined
    })).toEqual({ forceBracketedPasteForMultiline: true })
    expect(resolveProtectedMultilinePasteOptionsForAgentEvidence({
      isWindowsClient: false,
      hostPlatform: 'darwin',
      foregroundAgent: 'zsh',
      entry: undefined
    })).toBeUndefined()
    handleTerminalProgrammaticTextPaste({
      detail: undefined,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      getManager: () => null,
      getPaneTransports: () => new Map()
    })
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    expect(getTerminalPaneMenuShortcutPlatform()).toBe('darwin')
  })

  it('writes the selected text on a native copy and returns when the preview clipboard read fails', async () => {
    const element = document.createElement('div')
    const terminal = {
      element,
      hasSelection: () => true,
      getSelection: () => 'é'
    }
    const trim = installTerminalNativeCopyGutterTrim(terminal as never)
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true })
    const data = new DataTransfer()
    Object.defineProperty(event, 'clipboardData', { value: data })
    element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(data.getData('text/plain')).toBe('é')
    trim.dispose()
    const paste = createPreviewClipboardPaster({
      ptyId: 'pty-1',
      container: document.createElement('div'),
      getTerminal: () => null,
      getTerminalInput: () => null,
      isDisposed: () => false
    })
    await paste(document.body, 'keyboard')
  })
})
