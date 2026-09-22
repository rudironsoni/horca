// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createPreviewGridClaim } from '../../components/dashboard-popout/preview-grid-claim'
import { createPreviewBoxFit } from '../../components/dashboard-popout/preview-terminal-box-fit'
import { shouldClaimRemoteDesktopViewport } from '../../components/terminal-pane/remote-desktop-viewport-claim'
import { canReleaseReplayedScrollbackFromStore } from '../../components/terminal-pane/replayed-scrollback-store-release'
import { resolveHiddenRestoreScrollbackRows } from '../../components/terminal-pane/terminal-hidden-restore-scrollback'
import { buildFreshShellViewportBlankingSequence } from '../../components/terminal-pane/terminal-restored-viewport'
import { detachPaneFitResizeObserver } from './pane-fit-resize-observer'
import { presentPaneViewport } from './pane-viewport-present'
import { captureLogicalLineAnchor } from './terminal-reflow-scroll-anchor'
import { clearTerminalScrollbackAndFollowOutput } from './terminal-scrollback-clear'
import { forceTerminalViewportScrollbarSync } from './terminal-viewport-scrollbar-sync'

describe('ghostty resize behavior', () => {
  it('keeps the desktop scrollback depth and blanks a fresh shell viewport', () => {
    expect(resolveHiddenRestoreScrollbackRows(undefined)).toBe(5_000)
    expect(resolveHiddenRestoreScrollbackRows(200)).toBe(200)
    const blank = buildFreshShellViewportBlankingSequence(2)
    expect(blank.startsWith('\x1b[?6l\x1b[r')).toBe(true)
    expect(blank).toContain('\r\n\r\n')
    expect(blank.endsWith('\x1b[H')).toBe(true)
  })

  it('claims a remote desktop viewport only when the pane and document are visible', () => {
    const current = { cols: 80, rows: 24 }
    expect(shouldClaimRemoteDesktopViewport({
      holdMode: 'remote-desktop-fit',
      prior: { cols: 40, rows: 12 },
      current,
      paneGeometryChanged: false,
      paneVisible: true,
      documentVisible: true,
      documentFocused: true
    })).toBe(true)
    expect(shouldClaimRemoteDesktopViewport({
      holdMode: 'remote-desktop-fit',
      prior: current,
      current,
      paneGeometryChanged: false,
      paneVisible: true,
      documentVisible: true,
      documentFocused: true
    })).toBe(false)
    expect(canReleaseReplayedScrollbackFromStore({
      hasScrollbackRefs: true,
      worktreeId: 'wt-1',
      repos: []
    })).toBe(true)
  })

  it('does not jiggle the scrollbar at the bottom and clears scrollback through write when clear is missing', () => {
    const bottomScrolls: number[] = []
    forceTerminalViewportScrollbarSync({
      buffer: { active: { viewportY: 4, baseY: 4 } },
      scrollLines: (delta: number) => {
        bottomScrolls.push(delta)
      }
    } as never)
    expect(bottomScrolls).toEqual([])
    const scrolled: number[] = []
    forceTerminalViewportScrollbarSync({
      buffer: { active: { viewportY: 2, baseY: 5 } },
      scrollLines: (delta: number) => {
        scrolled.push(delta)
      }
    } as never)
    expect(scrolled).toEqual([-1, 1])
    const writes: string[] = []
    let followed = 0
    clearTerminalScrollbackAndFollowOutput({
      write: (data) => {
        writes.push(data)
      },
      scrollToBottom: () => {
        followed += 1
      }
    } as never)
    expect(writes).toEqual(['\x1b[2J\x1b[3J\x1b[H'])
    expect(followed).toBe(1)
  })

  it('skips a reflow anchor when the buffer has no line reader', () => {
    expect(captureLogicalLineAnchor({
      buffer: { active: { baseY: 0, cursorY: 0 } },
      options: {}
    } as never, 0)).toBeUndefined()
  })

  it('does not request a preview grid when the terminal is missing and leaves an unmeasured box unscaled', () => {
    const container = document.createElement('div')
    const parent = document.createElement('div')
    parent.appendChild(container)
    const claim = createPreviewGridClaim({
      ptyId: 'pty-1',
      container,
      getTerminal: () => null
    })
    claim.schedule()
    claim.dispose()
    const fit = createPreviewBoxFit({
      container,
      getTerminal: () => ({ rows: 24, buffer: { active: { cursorY: 0 } } })
    })
    fit.fit()
    expect(container.style.transform).toBe('')
  })

  it('detaches a fit observer that was never attached and refreshes a hidden pane', () => {
    const pane = {
      container: document.createElement('div'),
      terminal: {
        proposeDimensions: () => null,
        rows: 24,
        refresh: (start: number, end: number) => {
          pane.refreshed = [start, end]
        }
      },
      refreshed: null as [number, number] | null
    }
    pane.container.style.display = 'none'
    detachPaneFitResizeObserver(pane as never)
    presentPaneViewport(pane as never)
    expect(pane.refreshed).toEqual([0, 23])
  })
})
