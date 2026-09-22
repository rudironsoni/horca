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

function render(node: ReturnType<typeof createElement>): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return { container, root }
}

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

  it('focuses the Ghostty canvas when copy finds no selection', async () => {
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
      value: { ui: { writeTerminalClipboardText: async (text: string) => writes.push(text) } }
    })
    await copyTerminalPaneMenuSelection({
      id: 1,
      leafId: '11111111-1111-4111-8111-111111111111',
      container: host,
      terminal
    } as never)
    expect(terminal.getSelection()).toBe('')
    expect(writes).toEqual([])
    expect(document.activeElement).toBe(terminal.element)
    terminal.dispose()
  })
})
