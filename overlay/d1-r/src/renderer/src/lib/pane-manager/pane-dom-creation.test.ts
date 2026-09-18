// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { TerminalLeafId } from '../../../../shared/stable-pane-id'
import { createPaneDOM } from './pane-dom-creation'

const linkHandlerMock = vi.hoisted(() => ({
  current: null as null | {
    activate?: (event: MouseEvent, uri: string) => void
    hover?: (event: MouseEvent, uri: string) => void
    leave?: () => void
  }
}))

vi.mock('./ghostty-renderer/ghostty-pane-terminal', () => ({
  GhosttyPaneTerminal: class {
    element = document.createElement('canvas')
    textarea = document.createElement('textarea')
    constructor(opts: { measureRoot: HTMLElement; appearance?: { linkHandler?: typeof linkHandlerMock.current } }) {
      linkHandlerMock.current = opts.appearance?.linkHandler ?? null
      opts.measureRoot.appendChild(this.element)
    }
    dispose(): void {}
  }
}))

describe('createPaneDOM link tooltips', () => {
  it('anchors WebLinks hover text to the unpadded terminal window corner', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => 'open hint' },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    expect(pane.linkTooltip.classList.contains('pane-link-tooltip')).toBe(true)
    expect(pane.linkTooltip.style.left).toBe('')
    expect(pane.linkTooltip.style.bottom).toBe('')
    expect(pane.linkTooltip.style.display).toBe('none')
  })

  it('re-resolves the caller hint on every hover so setting changes apply live', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    let hint = 'first hint'
    const pane = createPaneDOM(
      1,
      leafId,
      { linkOpenHint: () => hint },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    linkHandlerMock.current?.hover?.({} as MouseEvent, 'http://localhost:5180/')
    expect(pane.linkTooltip.textContent).toBe('http://localhost:5180/ (first hint)')
    hint = 'second hint'
    linkHandlerMock.current?.hover?.({} as MouseEvent, 'http://localhost:5180/')
    expect(pane.linkTooltip.textContent).toBe('http://localhost:5180/ (second hint)')
  })

  it('lets callers replace WebLinks hover text for display-only labels', async () => {
    const labeledText = 'http://main.orca.localhost:60016/ (localhost:5180; click to open)'
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const pane = createPaneDOM(
      1,
      leafId,
      {
        linkOpenHint: () => 'open hint',
        formatLinkTooltip: async () => labeledText
      },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    linkHandlerMock.current?.hover?.({} as MouseEvent, 'http://localhost:5180/')
    await Promise.resolve()
    expect(pane.linkTooltip.textContent).toBe(labeledText)
  })

  it('identifies the hovered pane to both tooltip hooks', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const linkOpenHint = vi.fn(() => 'open hint')
    const formatLinkTooltip = vi.fn(() => null)
    createPaneDOM(
      7,
      leafId,
      { linkOpenHint, formatLinkTooltip },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    linkHandlerMock.current?.hover?.({} as MouseEvent, 'http://localhost:5180/')
    expect(linkOpenHint).toHaveBeenCalledWith(7)
    expect(formatLinkTooltip).toHaveBeenCalledWith(7, 'http://localhost:5180/', 'open hint')
  })

  it('identifies the clicked pane to link routing', () => {
    const leafId = '11111111-1111-4111-8111-111111111111' as TerminalLeafId
    const onLinkClick = vi.fn()
    createPaneDOM(
      7,
      leafId,
      { linkOpenHint: () => 'open hint', onLinkClick },
      { active: null } as never,
      {} as never,
      vi.fn(),
      vi.fn()
    )
    const event = {} as MouseEvent
    linkHandlerMock.current?.activate?.(event, 'https://example.com')
    expect(onLinkClick).toHaveBeenCalledWith(7, event, 'https://example.com')
  })
})
