// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { StructuredAgentSessionTerminalReturnButton } from '../../components/terminal-pane/StructuredAgentSessionTerminalReturnButton'
import { TerminalSessionStateSaveFailureDialog } from '../../components/terminal-pane/TerminalSessionStateSaveFailureDialog'
import { createPtyOutputProcessor } from '../../components/terminal-pane/pty-output-processor'
import { createPtyOutputSideEffectQueue } from '../../components/terminal-pane/pty-output-side-effect-queue'
import { copyTerminalPaneMenuSelection } from '../../components/terminal-pane/terminal-pane-menu-copy-actions'
import { usePendingStartupParkPresence } from '../../components/terminal-pane/terminal-pending-startup-park-presence'
import { GhosttyPaneTerminal } from './ghostty-renderer/ghostty-pane-terminal'
import { useTerminalPaneController } from '../../components/terminal-pane/use-terminal-pane-controller'
import { LinkRoutingPreferenceDialogProvider } from '../../components/link-routing-preference-dialog'
import { AgentSessionContinuationMenuItem } from '../../components/terminal-pane/AgentSessionContinuationMenuItem'
import { TerminalQuickCommandEditorDialog } from '../../components/terminal-pane/TerminalQuickCommandEditorDialog'
import { TerminalQuickCommandsSubmenu } from '../../components/terminal-pane/TerminalQuickCommandsSubmenu'
import { handleNativeTerminalFileDrop } from '../../components/terminal-pane/terminal-native-file-drop'
import { shutdownBufferCaptures } from '../../components/terminal-pane/shutdown-buffer-captures'
import { useAppStore } from '../../store'
import type { TerminalPaneController } from '../../components/terminal-pane/use-terminal-pane-controller'
import { DropdownMenu, DropdownMenuContent } from '../../components/ui/dropdown-menu'

function render(node: ReturnType<typeof createElement>): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return { container, root }
}

describe('ghostty pane controller', () => {
  it('mounts a Ghostty canvas through the pane hook chain', async () => {
    const unsubscribe = () => undefined
    const method = new Proxy(
      function apiMethod() {
        return unsubscribe
      },
      {
        get: () => method,
        apply: () => unsubscribe
      }
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: new Proxy(
        {},
        {
          get: (_target, prop) => {
            if (prop === 'platform') {
              return { get: () => ({ osRelease: '23.0.0' }) }
            }
            if (prop === 'app') {
              return {
                getKeyboardLayoutSnapshot: async () => ({
                  inputSourceId: 'com.apple.keylayout.US'
                }),
                getKeyboardInputSourceId: async () => 'com.apple.keylayout.US',
                onKeyboardLayoutChanged: () => unsubscribe
              }
            }
            return method
          }
        }
      )
    })
    const mounted: { controller: TerminalPaneController | null } = { controller: null }
    function Harness() {
      const controller = useTerminalPaneController(
        {
          tabId: 'tab-1',
          worktreeId: 'global-floating-terminal',
          cwd: '/repo',
          isActive: true,
          isVisible: true,
          onPtyExit: () => undefined,
          onCloseTab: () => undefined
        },
        null
      )
      mounted.controller = controller
      return createElement('div', { ref: controller.containerRef })
    }
    const view = render(
      createElement(LinkRoutingPreferenceDialogProvider, null, createElement(Harness))
    )
    const canvas = view.container.querySelector('canvas[data-ghostty]')
    expect(canvas).not.toBeNull()
    expect(view.container.querySelectorAll('canvas[data-ghostty]')).toHaveLength(1)
    const controller = mounted.controller
    const manager = controller?.managerRef.current
    expect(manager?.getPaneCount()).toBe(1)
    shutdownBufferCaptures.get('tab-1')?.()
    const layout = useAppStore.getState().terminalLayoutsByTabId['tab-1']
    expect(layout?.root).toBeTruthy()
    const pane = manager?.getPanes()[0]
    expect(pane).toBeTruthy()
    const writes: string[] = []
    controller?.paneTransportsRef.current.set(pane!.id, {
      getPtyId: () => 'pty-1',
      isConnected: () => true,
      sendInput: (data: string) => {
        writes.push(data)
        return true
      },
      sendInputAccepted: async (data: string) => {
        writes.push(data)
        return true
      }
    } as never)
    await handleNativeTerminalFileDrop({
      manager: manager!,
      paneTransports: controller!.paneTransportsRef.current,
      worktreeId: 'global-floating-terminal',
      tabId: 'tab-1',
      cwd: '/repo',
      data: { paths: ['/tmp/note.txt'], target: 'terminal', tabId: 'tab-1', paneLeafId: pane!.leafId }
    })
    expect(writes.join('')).toContain('/tmp/note.txt')
    manager?.closePane(pane!.id)
    expect(view.container.querySelectorAll('canvas[data-ghostty]')).toHaveLength(0)
    act(() => view.root.unmount())
    expect(view.container.querySelectorAll('canvas[data-ghostty]')).toHaveLength(0)
  })
})

describe('ghostty pane chrome dialogs', () => {
  it('shows continue-in-new-session on the Ghostty pane menu', () => {
    let selected = 0
    const view = render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(
          DropdownMenuContent,
          null,
          createElement(AgentSessionContinuationMenuItem, { onSelect: () => { selected += 1 } })
        )
      )
    )
    expect(document.body.textContent).toContain('Continue in New Session')
    act(() => view.root.unmount())
    expect(selected).toBe(0)
  })

  it('shows the quick-command submenu when the Ghostty pane has no commands', () => {
    const view = render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(
          DropdownMenuContent,
          null,
          createElement(TerminalQuickCommandsSubmenu, {
            hosts: [],
            hostLoadFailed: false,
            hostOwnershipPending: false,
            repoLabel: null,
            onAdd: () => undefined,
            onClose: () => undefined,
            onRun: () => undefined
          })
        )
      )
    )
    expect(document.body.textContent).toContain('Quick Commands')
    const trigger = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find((node) =>
      node.textContent?.includes('Quick Commands')
    )
    act(() => {
      trigger?.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }))
      trigger?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.textContent).toContain('No quick commands')
    act(() => view.root.unmount())
  })

  it('opens the quick-command editor over the Ghostty pane', () => {
    const view = render(
      createElement(TerminalQuickCommandEditorDialog, {
        command: {
          id: 'cmd-1',
          label: 'Build Horca',
          command: 'pnpm test',
          appendEnter: false
        },
        hostId: 'local',
        onOpenChange: () => undefined,
        onSave: () => undefined
      })
    )
    expect(document.body.textContent).toContain('pnpm test')
    expect(document.body.textContent).toContain('Add Quick Command')
    act(() => view.root.unmount())
  })
})

describe('ghostty pane chrome react modules', () => {
  it('returns to chat from the Ghostty pane title button', () => {
    let returned = 0
    const view = render(
      createElement(StructuredAgentSessionTerminalReturnButton, {
        enabled: true,
        onReturn: () => {
          returned += 1
        }
      })
    )
    const button = view.container.querySelector('button')
    expect(button?.textContent).toContain('Return to chat')
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(returned).toBe(1)
    act(() => view.root.unmount())
  })

  it('shows the save-failure dialog over the pane', () => {
    let dismissed = 0
    const view = render(
      createElement(TerminalSessionStateSaveFailureDialog, {
        open: true,
        onDismiss: () => {
          dismissed += 1
        },
        onOpenSpaceAnalyzer: () => undefined
      })
    )
    expect(document.body.textContent).toContain('Disk space is unavailable')
    act(() => view.root.unmount())
    expect(dismissed).toBe(0)
  })

  it('reports no pending startup for an empty Ghostty tab list', () => {
    function Probe() {
      const presence = usePendingStartupParkPresence([])
      return createElement('span', null, Object.keys(presence).length === 0 ? 'empty' : 'pending')
    }
    const view = render(createElement(Probe))
    expect(view.container.textContent).toBe('empty')
    act(() => view.root.unmount())
  })

  it('applies a queued title side effect', () => {
    const applied: string[][] = []
    const queue = createPtyOutputSideEffectQueue({
      countWorkingTitles: () => 0,
      apply: (effect) => applied.push(effect.titles)
    })
    queue.enqueue({
      payloads: [],
      titles: ['Build'],
      titleScanEffect: 'none',
      containsBell: false,
      suppressAttentionEvents: false
    })
    queue.flush()
    expect(applied).toEqual([['Build']])
    queue.disposeGauge()
  })

  it('feeds OSC title bytes through the output processor', () => {
    const chunks: string[] = []
    const titles: string[] = []
    const processor = createPtyOutputProcessor({
      onTitleChange: (title) => titles.push(title)
    })
    processor.processData('\x1b]0;Build\x07ready', { onData: (data) => chunks.push(data) })
    processor.flushPendingSideEffects()
    expect(chunks.join('')).toContain('ready')
    expect(titles).toContain('Build')
    processor.disposePendingSideEffectGauge()
  })

  it('writes the Ghostty selection when the pane menu copies', async () => {
    HTMLCanvasElement.prototype.getContext = (() => ({
      measureText: () => ({ width: 8 })
    })) as never
    const host = document.createElement('div')
    document.body.appendChild(host)
    const terminal = new GhosttyPaneTerminal({ measureRoot: host })
    host.appendChild(terminal.element)
    const writes: string[] = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ui: { writeTerminalClipboardText: async (text: string) => writes.push(text) },
        horcaGhosttyPassthru: {
          attach: async () => true,
          detach: async () => undefined,
          readSelection: () => 'HELLO'
        }
      }
    })
    await copyTerminalPaneMenuSelection({
      id: 1,
      leafId: '11111111-1111-4111-8111-111111111111',
      container: host,
      terminal
    } as never)
    expect(terminal.getSelection()).toBe('HELLO')
    expect(writes).toEqual(['HELLO'])
    expect(document.activeElement).toBe(terminal.element)
    terminal.dispose()
  })
})
