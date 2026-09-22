// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectHeadlessOscLinkRanges } from '../../../../main/daemon/headless-osc-link-ranges'
import { installPreviewTerminalLinks } from '../../components/dashboard-popout/preview-terminal-links'
import { buildEdgeWrappedHttpLogicalLineCandidates } from '../../components/terminal-pane/edge-wrapped-terminal-http-links'
import { buildHardWrappedHttpLogicalLineCandidates } from '../../components/terminal-pane/hard-wrapped-terminal-http-links'
import { handleTerminalFileLink } from '../../components/terminal-pane/terminal-file-link-actions'
import {
  buildCandidateLogicalLinesForBufferPosition,
  dedupeLogicalLines
} from '../../components/terminal-pane/terminal-file-link-hit-testing'
import { resolveTerminalHttpLinkSourceOwner } from '../../components/terminal-pane/terminal-http-link-source-owner'
import { createFilePathLinkProvider } from '../../components/terminal-pane/terminal-link-handlers'
import { createTerminalLinkTestDoubles } from '../../components/terminal-pane/terminal-link-handlers-test-fixtures'
import {
  createDeferred,
  setPlatform
} from '../../components/terminal-pane/terminal-link-handlers-test-harness'
import {
  collectLinks,
  containsBufferPoint,
  makeBufferLine
} from '../../components/terminal-pane/terminal-link-provider-buffer-fixtures'
import { installTerminalLinkifierClickPriming } from '../../components/terminal-pane/terminal-linkifier-click-priming'
import { handleOscLink } from '../../components/terminal-pane/terminal-osc-link-routing'
import { installTerminalPaneLinkHandling } from '../../components/terminal-pane/terminal-pane-pane-links'
import {
  findHttpLinkAtTerminalMouseEvent,
  openHttpLinkAtTerminalMouseEvent
} from '../../components/terminal-pane/terminal-url-link-hit-testing'
import { handleTerminalWebLinkClick } from '../../components/terminal-pane/terminal-web-link-click'
import { translateLineWithColumns } from '../../components/terminal-pane/wrapped-terminal-link-ranges'
import { installTerminalLinkifierHoverResetOnWrite } from './terminal-linkifier-hover-reset-on-write'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ghostty link installers', () => {
  it('returns no OSC ranges when the terminal has no link service', () => {
    const ranges = collectHeadlessOscLinkRanges(
      {
        cols: 4,
        rows: 1,
        buffer: { active: { length: 1, getNullCell: () => ({}), getLine: () => undefined } }
      } as never,
      undefined
    )
    expect(ranges).toEqual([])
  })

  it('reads one OSC 8 cell into a column range', () => {
    const scratch: { extended?: { urlId?: number }; hasExtendedAttrs?: () => boolean } = {}
    const line = {
      length: 2,
      getCell: (col: number, cell: typeof scratch) => {
        cell.extended = { urlId: col === 0 ? 7 : 0 }
        cell.hasExtendedAttrs = () => col === 0
        return cell
      }
    }
    const ranges = collectHeadlessOscLinkRanges(
      {
        cols: 2,
        rows: 1,
        buffer: {
          active: {
            length: 1,
            getNullCell: () => scratch,
            getLine: () => line
          }
        },
        _core: { _oscLinkService: { getLinkData: () => ({ uri: 'https://example.com/é' }) } }
      } as never,
      undefined
    )
    expect(ranges).toEqual([
      { row: 0, startCol: 0, endCol: 1, uri: 'https://example.com/é' }
    ])
  })

  it('registers a guarded preview link provider', () => {
    const registered: Array<{ provideLinks: (line: number, cb: (links?: unknown) => void) => void }> = []
    const terminal = {
      registerLinkProvider(provider: (typeof registered)[number]) {
        registered.push(provider)
        return { dispose: () => undefined }
      }
    }
    installPreviewTerminalLinks(terminal as never)
    expect(registered).toHaveLength(1)
    let delivered: unknown = 'pending'
    registered[0]?.provideLinks(1, (links) => {
      delivered = links
    })
    expect(delivered).toBe('pending')
  })

  it('skips wrapped HTTP scans when the row has no frame and no line', () => {
    expect(buildEdgeWrappedHttpLogicalLineCandidates({ getLine: () => undefined }, 1)).toEqual([])
    const plain = makeBufferLine('hello')
    expect(
      buildHardWrappedHttpLogicalLineCandidates({ getLine: () => plain as never }, 1)
    ).toEqual([])
  })

  it('does not open a file link on an Alt click', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const event = new MouseEvent('click', { button: 0, altKey: true })
    expect(
      handleTerminalFileLink('/repo/note.txt', null, null, event, {
        worktreeId: 'wt-1',
        worktreePath: '/repo'
      })
    ).toBe(false)
  })

  it('drops a duplicate logical line and keeps one plain row', () => {
    const line = { text: 'hello', rows: [], fingerprint: 'same' }
    expect(dedupeLogicalLines([line, line])).toEqual([line])
    expect(buildCandidateLogicalLinesForBufferPosition({ getLine: () => undefined }, 1)).toEqual([])
  })

  it('names a runtime owner, a retained ssh owner, and a local owner', () => {
    expect(
      resolveTerminalHttpLinkSourceOwner({
        getPtyId: () => null,
        getRuntimeEnvironmentId: () => 'env-1',
        getConnectionId: () => null
      })
    ).toEqual({ kind: 'runtime', runtimeEnvironmentId: 'env-1' })
    expect(
      resolveTerminalHttpLinkSourceOwner({
        getPtyId: () => null,
        getRuntimeEnvironmentId: () => '  ',
        getConnectionId: () => 'ssh-1'
      })
    ).toEqual({ kind: 'ssh', connectionId: 'ssh-1' })
    expect(resolveTerminalHttpLinkSourceOwner(null)).toEqual({ kind: 'local' })
  })

  it('resolves a deferred harness value and a platform stub', async () => {
    const deferred = createDeferred<string>()
    deferred.resolve('é')
    await expect(deferred.promise).resolves.toBe('é')
    setPlatform('Mozilla/5.0 (Macintosh) HorcaTest')
    expect(navigator.userAgent).toContain('HorcaTest')
    expect(createTerminalLinkTestDoubles().deps).toEqual({
      worktreeId: 'wt-1',
      worktreePath: '/tmp'
    })
  })

  it('reports no file link on a line that has no path', async () => {
    await expect(collectLinks('hello')).resolves.toEqual([])
    const missingPane = createFilePathLinkProvider(
      9,
      { managerRef: { current: { getPanes: () => [] } } } as never,
      document.createElement('div'),
      'open'
    )
    let missing: unknown = 'pending'
    missingPane.provideLinks(1, (links) => {
      missing = links
    })
    expect(missing).toBeUndefined()
    expect(
      containsBufferPoint(
        { range: { start: { x: 1, y: 2 }, end: { x: 4, y: 2 } } } as never,
        3,
        2
      )
    ).toBe(true)
    expect(
      containsBufferPoint(
        { range: { start: { x: 1, y: 2 }, end: { x: 4, y: 2 } } } as never,
        0,
        2
      )
    ).toBe(false)
  })

  it('primes the linkifier on a command click and stops after dispose', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh) Chrome/120'
    })
    const element = document.createElement('div')
    let moves = 0
    const linkifier = {
      _currentLink: undefined as unknown,
      _lastBufferCell: { x: 1 },
      _activeLine: 3,
      _handleMouseMove: () => {
        moves += 1
      }
    }
    const priming = installTerminalLinkifierClickPriming({
      element,
      _core: { linkifier }
    } as never)
    element.dispatchEvent(new MouseEvent('mousedown', { button: 0, metaKey: true, bubbles: true }))
    expect(moves).toBe(1)
    expect(linkifier._lastBufferCell).toBeUndefined()
    expect(linkifier._activeLine).toBe(-1)
    priming.dispose()
    element.dispatchEvent(new MouseEvent('mousedown', { button: 0, metaKey: true, bubbles: true }))
    expect(moves).toBe(1)
  })

  it('ignores an OSC link and a web link that are not a primary owned click', () => {
    const secondary = new MouseEvent('mouseup', { button: 2 })
    expect(handleOscLink('https://example.com', secondary, {
      worktreeId: 'wt-1',
      worktreePath: '/repo'
    })).toBe(false)
    expect(handleTerminalWebLinkClick('https://example.com', secondary, {
      terminal: null,
      worktreeId: 'wt-1',
      worktreePath: '/repo',
      startupCwd: '/repo'
    })).toBe(false)
    expect(findHttpLinkAtTerminalMouseEvent({} as never, secondary)).toBeNull()
    expect(openHttpLinkAtTerminalMouseEvent({} as never, secondary, {} as never)).toBe(false)
  })

  it('records columns for a buffer line and installs pane link hover text', () => {
    const translated = translateLineWithColumns(makeBufferLine('é') as never)
    expect(translated.text).toBe('é')
    expect(translated.columns).toEqual([0, 1])

    const tooltip = document.createElement('div')
    tooltip.style.display = 'none'
    const providers: unknown[] = []
    const terminal = {
      element: document.createElement('div'),
      options: {} as { linkHandler?: { hover: (event: unknown, text: string) => void; leave: () => void; activate: (event: unknown, text: string) => void } },
      hasSelection: () => false,
      clearSelection: () => undefined,
      registerLinkProvider: (provider: unknown) => {
        providers.push(provider)
        return { dispose: () => undefined }
      },
      onSelectionChange: () => ({ dispose: () => undefined })
    }
    const refs = {
      linkPointerGesturesRef: { current: new Map() },
      linkProviderDisposablesRef: { current: new Map() },
      terminalHandleLinkDisposablesRef: { current: new Map() },
      linkifierClickPrimingDisposablesRef: { current: new Map() },
      fileLinkClickFallbackDisposablesRef: { current: new Map() },
      httpLinkClickFallbackDisposablesRef: { current: new Map() },
      nativeCopyDisposablesRef: { current: new Map() },
      selectionDisposablesRef: { current: new Map() },
      selectionCaptureTimersRef: { current: new Map() },
      mouseHideDisposablesRef: { current: new Map() }
    }
    installTerminalPaneLinkHandling({
      pane: { id: 4, terminal, linkTooltip: tooltip, container: document.createElement('div') },
      managerRef: { current: { getPanes: () => [] } },
      settingsRef: { current: {} },
      refs,
      linkDeps: {
        worktreeId: 'wt-1',
        worktreePath: '/repo',
        startupCwd: '/repo',
        managerRef: { current: { getPanes: () => [] } },
        pathExistsCache: new Map()
      },
      fileOpenLinkHint: 'open',
      requestOpenLinksInAppPreference: () => undefined,
      getHttpLinkSourceOwnerForPane: () => ({ kind: 'local' }),
      getHttpLinkActionDestinations: () => undefined,
      getLinkActionContext: () => null,
      getPaneLinkCwd: () => '/repo',
      getUrlOpenLinkHint: () => 'hint',
      onShowSessionRestoredBanner: () => undefined,
      ptyStartup: null
    } as never)
    expect(providers.length).toBeGreaterThan(0)
    terminal.options.linkHandler?.hover(null, 'https://example.com/é')
    expect(tooltip.textContent).toContain('https://example.com/é')
    expect(tooltip.style.display).toBe('')
    terminal.options.linkHandler?.leave()
    expect(tooltip.style.display).toBe('none')
    terminal.options.linkHandler?.activate(new MouseEvent('click', { button: 2 }), 'https://example.com')
  })

  it('clears hover state after parsed output when no link is hovered', () => {
    vi.useFakeTimers()
    let onParsed: (() => void) | undefined
    const linkifier = {
      _currentLink: undefined,
      _lastBufferCell: { x: 2 },
      _activeLine: 1,
      _clearCurrentLink: () => undefined
    }
    const disposable = installTerminalLinkifierHoverResetOnWrite({
      onWriteParsed: (callback: () => void) => {
        onParsed = callback
        return { dispose: () => undefined }
      },
      element: document.createElement('div'),
      _core: { linkifier }
    } as never)
    onParsed?.()
    vi.advanceTimersByTime(150)
    expect(linkifier._lastBufferCell).toBeUndefined()
    expect(linkifier._activeLine).toBe(-1)
    disposable.dispose()
  })
})
