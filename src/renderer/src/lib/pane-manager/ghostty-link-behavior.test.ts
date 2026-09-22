// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  isTerminalLinkActionActivation,
  isTerminalLinkDirectActivation,
  isTerminalOwnedLinkGesture
} from '../../components/terminal-pane/terminal-link-activation'
import { isTerminalHttpLinkActivation } from '../../components/terminal-pane/terminal-http-link-activation'
import { TERMINAL_HTTP_URL_MAX_LENGTH } from '../../components/terminal-pane/terminal-http-link-limits'
import {
  getTerminalFileOpenHint,
  getTerminalUrlOpenHint,
  getTerminalWorktreePathOpenHint
} from '../../components/terminal-pane/terminal-link-open-hints'
import { extractOrchestrationTaskLinks } from '../../components/terminal-pane/terminal-orchestration-task-links'
import { extractTerminalHandleLinks } from '../../components/terminal-pane/terminal-handle-links'
import { requestTerminalLinkAction } from '../../components/terminal-pane/terminal-link-action-request'
import {
  normalizeWorktreeRootPathForTerminalLink,
  resolveKnownWorktreeRootPathLink
} from '../../components/terminal-pane/terminal-worktree-path-link'
import {
  guardLinkProvider,
  installGuardedLinkProviderRegistration
} from './terminal-link-provider-guard'
import {
  isTerminalCursorBlinkSuspended,
  resumeTerminalCursorBlink,
  setTerminalCursorBlinkOption,
  suspendTerminalCursorBlink
} from './pane-cursor-blink-suspension'
import {
  isTerminalLinkifierHoverActive,
  resetTerminalLinkifierHoverState
} from './terminal-linkifier-hover-reset'

describe('ghostty link behavior', () => {
  it('treats Cmd-click as a direct open and a plain click as the action menu', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const commandClick = { metaKey: true, ctrlKey: false, button: 0, altKey: false, shiftKey: false }
    const plainClick = { metaKey: false, ctrlKey: false, button: 0, altKey: false, shiftKey: false }
    expect(isTerminalLinkDirectActivation(commandClick)).toBe(true)
    expect(isTerminalLinkActionActivation(plainClick)).toBe(true)
    expect(isTerminalLinkActionActivation(commandClick)).toBe(false)
    expect(isTerminalOwnedLinkGesture(plainClick)).toBe(true)
    expect(isTerminalHttpLinkActivation(commandClick as never)).toBe(true)
    expect(isTerminalHttpLinkActivation(plainClick as never)).toBe(false)
    expect(getTerminalFileOpenHint()).toContain('⌘+click to open')
    expect(getTerminalUrlOpenHint({ modifierInverts: true, openLinksInApp: false })).toContain(
      'open in Orca'
    )
    expect(getTerminalWorktreePathOpenHint(false, false)).toContain('switch workspace')
  })

  it('finds a task id and a terminal handle and ignores a glued token', () => {
    expect(extractOrchestrationTaskLinks('see task_abc-1 next')).toEqual([
      { taskId: 'task_abc-1', startIndex: 4, endIndex: 14 }
    ])
    expect(extractOrchestrationTaskLinks('xtask_abc')).toEqual([])
    expect(extractTerminalHandleLinks('open term_pane-1 now')).toEqual([
      { handle: 'term_pane-1', startIndex: 5, endIndex: 16 }
    ])
    expect(TERMINAL_HTTP_URL_MAX_LENGTH).toBe(2048)
  })

  it('refuses a link action when the click is not a plain primary click', () => {
    const prevented = new MouseEvent('click', { clientX: 4, clientY: 8, metaKey: true })
    expect(
      requestTerminalLinkAction(
        prevented,
        {
          paneId: 1,
          pointerGesture: { canRequestAction: () => true },
          claimPtyMouse: () => true,
          request: () => undefined,
          focusTerminal: () => undefined
        } as never,
        { destination: 'https://example.com', kind: 'url', primary: { id: 'open', label: 'Open' }, alternate: null } as never
      )
    ).toBe(false)
  })

  it('strips a trailing slash and resolves one known worktree root', () => {
    expect(normalizeWorktreeRootPathForTerminalLink('/repo/app/')).toBe('/repo/app')
    expect(
      resolveKnownWorktreeRootPathLink('/repo/app', {
        worktreesByRepo: { repo: [{ id: 'wt-1', path: '/repo/app' }] }
      } as never)
    ).toEqual({ id: 'wt-1', path: '/repo/app' })
    expect(
      resolveKnownWorktreeRootPathLink('/missing', { worktreesByRepo: {} } as never)
    ).toBeNull()
  })

  it('reports no links when a provider throws before its callback', () => {
    const guarded = guardLinkProvider(
      {
        provideLinks: () => {
          throw new Error('wide line')
        }
      },
      'file'
    )
    let links: unknown = 'pending'
    guarded.provideLinks(3, (value) => {
      links = value
    })
    expect(links).toBeUndefined()
    const registered: unknown[] = []
    const terminal = {
      registerLinkProvider: (provider: unknown) => {
        registered.push(provider)
      }
    }
    installGuardedLinkProviderRegistration(terminal as never)
    terminal.registerLinkProvider({ provideLinks: () => undefined })
    expect(registered).toHaveLength(1)
    expect(registered[0]).not.toEqual({ provideLinks: () => undefined })
  })

  it('parks cursor blink while a pane is hidden and restores the old value', () => {
    const terminal = { options: { cursorBlink: true } }
    suspendTerminalCursorBlink(terminal as never)
    expect(terminal.options.cursorBlink).toBe(false)
    expect(isTerminalCursorBlinkSuspended(terminal as never)).toBe(true)
    setTerminalCursorBlinkOption(terminal as never, true)
    expect(terminal.options.cursorBlink).toBe(false)
    resumeTerminalCursorBlink(terminal as never)
    expect(terminal.options.cursorBlink).toBe(true)
    expect(isTerminalCursorBlinkSuspended(terminal as never)).toBe(false)
  })

  it('clears a hovered link and its pointer class', () => {
    const screen = document.createElement('div')
    screen.className = 'xterm-screen xterm-cursor-pointer'
    const element = document.createElement('div')
    element.appendChild(screen)
    let cleared = 0
    const terminal = {
      element,
      _core: {
        linkifier: {
          _currentLink: { text: 'https://example.com' },
          _lastBufferCell: { x: 1 },
          _activeLine: 4,
          _clearCurrentLink: () => {
            cleared += 1
          }
        }
      }
    }
    expect(isTerminalLinkifierHoverActive(terminal as never)).toBe(true)
    resetTerminalLinkifierHoverState(terminal as never)
    expect(cleared).toBe(1)
    expect(isTerminalLinkifierHoverActive(terminal as never)).toBe(false)
    expect(screen.classList.contains('xterm-cursor-pointer')).toBe(false)
    expect(terminal._core.linkifier._activeLine).toBe(-1)
  })
})
