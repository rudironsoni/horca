// @vitest-environment happy-dom
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'
import { installPreviewTerminalAppMenuClipboard } from '../../components/dashboard-popout/preview-terminal-app-menu-clipboard'
import { installPreviewTerminalRightClickPaste } from '../../components/dashboard-popout/preview-terminal-right-click-paste'
import {
  showOsc52ClipboardBlockedToast,
  showOsc52ClipboardFailedToast
} from '../../components/terminal-pane/osc52-clipboard-toast'
import { pasteTerminalClipboard } from '../../components/terminal-pane/terminal-clipboard-paste'
import { registerTerminalPanePasteListeners } from '../../components/terminal-pane/terminal-pane-paste-listeners'
import { executeTerminalStartupCommandPaste } from '../../components/terminal-pane/terminal-startup-command-paste'
import { useTerminalPanePasteListeners } from '../../components/terminal-pane/use-terminal-pane-paste-listeners'
import { CLIPBOARD_TEXT_TOO_LARGE_ERROR } from '../../../../shared/clipboard-text'

describe('ghostty clipboard installers', () => {
  it('pastes from the app menu only when focus is inside the preview', () => {
    const container = document.createElement('div')
    const field = document.createElement('div')
    field.tabIndex = 0
    container.appendChild(field)
    document.body.appendChild(container)
    const pasted: string[] = []
    let selected = 0
    const dispose = installPreviewTerminalAppMenuClipboard({
      container,
      getTerminal: () => ({
        getSelection: () => '',
        selectAll: () => {
          selected += 1
        },
        clearSelection: () => undefined
      }),
      pasteClipboardText: (_active, source) => {
        pasted.push(source)
      }
    })
    field.focus()
    window.dispatchEvent(new Event('orca-app-menu-paste'))
    expect(pasted).toEqual(['app-menu'])
    window.dispatchEvent(new CustomEvent('orca-app-menu-selection-action', { detail: 'select-all' }))
    expect(selected).toBe(1)
    dispose()
    window.dispatchEvent(new Event('orca-app-menu-paste'))
    expect(pasted).toEqual(['app-menu'])
  })

  it('copies a right-click selection and pastes when the preview has none', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    ;(window as unknown as { api: { ui: { writeTerminalClipboardText: (text: string) => Promise<void> } } }).api = {
      ui: { writeTerminalClipboardText: async () => undefined }
    }
    const pasted: string[] = []
    let selection = 'é'
    const dispose = installPreviewTerminalRightClickPaste({
      container,
      getTerminal: () => ({
        getSelection: () => selection,
        clearSelection: () => {
          selection = ''
        }
      }),
      isRightClickToPasteEnabled: () => true,
      pasteClipboardText: (_active, source) => {
        pasted.push(source)
      }
    })
    const selected = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.dispatchEvent(selected)
    expect(selected.defaultPrevented).toBe(true)
    expect(pasted).toEqual([])
    selection = ''
    const empty = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    container.dispatchEvent(empty)
    expect(pasted).toEqual(['right-click'])
    const ctrl = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, ctrlKey: true })
    container.dispatchEvent(ctrl)
    expect(ctrl.defaultPrevented).toBe(false)
    dispose()
  })

  it('shows each OSC 52 clipboard toast once', () => {
    showOsc52ClipboardBlockedToast()
    showOsc52ClipboardBlockedToast()
    showOsc52ClipboardFailedToast()
    showOsc52ClipboardFailedToast()
    const titles = toast.getToasts().map((item) => ('title' in item ? String(item.title) : ''))
    expect(titles.filter((title) => title.includes('Terminal clipboard write blocked'))).toHaveLength(1)
    expect(titles.filter((title) => title.includes('could not be confirmed'))).toHaveLength(1)
  })

  it('pastes clipboard text, rejects a false writer, and skips text that is too large', async () => {
    const written: Array<string | undefined> = []
    await expect(pasteTerminalClipboard({
      readClipboardText: async () => 'é',
      saveClipboardImageAsTempFile: async () => null,
      pasteText: (text, options) => {
        written.push(text, options?.forceBracketedPaste ? 'bracket' : 'plain')
      }
    })).resolves.toEqual({ status: 'pasted', kind: 'text' })
    expect(written).toEqual(['é', 'plain'])
    await expect(pasteTerminalClipboard({
      readClipboardText: async () => 'no',
      saveClipboardImageAsTempFile: async () => null,
      pasteText: () => false
    })).resolves.toEqual({ status: 'skipped', reason: 'text-paste-rejected' })
    const errors: string[] = []
    await expect(pasteTerminalClipboard({
      readClipboardText: async () => {
        throw new Error(CLIPBOARD_TEXT_TOO_LARGE_ERROR)
      },
      saveClipboardImageAsTempFile: async () => null,
      pasteText: () => undefined,
      onTextPasteError: (error) => {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    })).resolves.toEqual({ status: 'skipped', reason: 'text-too-large' })
    expect(errors).toEqual([CLIPBOARD_TEXT_TOO_LARGE_ERROR])
    await expect(pasteTerminalClipboard({
      readClipboardText: async () => '',
      saveClipboardImageAsTempFile: async () => '/tmp/shot.png',
      pasteText: (text, options) => {
        written.push(text, options?.forceBracketedPaste ? 'bracket' : 'plain')
      }
    })).resolves.toEqual({ status: 'pasted', kind: 'image-path' })
    expect(written).toContain('/tmp/shot.png')
    expect(written).toContain('bracket')
  })

  it('ignores a paste key inside search and still claims a pane paste event', () => {
    const container = document.createElement('div')
    const search = document.createElement('div')
    search.setAttribute('data-terminal-search-root', 'true')
    const searchField = document.createElement('input')
    search.appendChild(searchField)
    container.appendChild(search)
    document.body.appendChild(container)
    const pastes: string[] = []
    const dispose = registerTerminalPanePasteListeners({
      container,
      controller: {
        forceBracketedMultilineTextPaste: false,
        keybindings: undefined,
        managerRef: { current: null },
        setTerminalError: () => undefined,
        worktreeId: 'wt-1'
      } as never,
      execution: {
        executePanePasteText: () => undefined,
        pasteFromClipboard: (_pane, source) => {
          pastes.push(source)
        }
      } as never,
      isMac: true,
      shortcutPlatform: 'darwin'
    })
    searchField.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true }))
    expect(pastes).toEqual([])
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    container.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(true)
    expect(pastes).toEqual([])
    dispose()
  })

  it('sends a startup command through the terminal paste path', async () => {
    const pasted: string[] = []
    const result = await executeTerminalStartupCommandPaste({
      command: 'echo hi',
      pane: {
        id: 1,
        leafId: 'leaf-a',
        terminal: {
          modes: {},
          options: {},
          paste: (text: string) => {
            pasted.push(text)
          },
          input: () => undefined
        }
      } as never,
      ptyId: 'pty-1',
      runtime: { platform: 'darwin', runtimeKey: 'local:darwin', kind: 'local' },
      transport: { sendInput: () => true },
      isTargetCurrent: () => true
    })
    expect(pasted).toEqual(['echo hi'])
    expect(result.status).toBe('pasted')
  })

  it('installs pane paste listeners only while the pane is active', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    function Probe(): null {
      const [active, setActive] = useState(false)
      ;(window as unknown as { setPasteActive?: (value: boolean) => void }).setPasteActive = setActive
      useTerminalPanePasteListeners({
        containerRef: { current: container },
        isActive: active,
        keybindings: undefined,
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        forceBracketedMultilineTextPaste: false,
        managerRef: { current: null },
        paneTransportsRef: { current: new Map() },
        setTerminalError: () => undefined
      } as never)
      return null
    }
    act(() => {
      root.render(createElement(Probe))
    })
    const idle = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    container.dispatchEvent(idle)
    expect(idle.defaultPrevented).toBe(false)
    act(() => {
      ;(window as unknown as { setPasteActive: (value: boolean) => void }).setPasteActive(true)
    })
    const live = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    container.dispatchEvent(live)
    expect(live.defaultPrevented).toBe(true)
    act(() => {
      root.unmount()
    })
  })
})
