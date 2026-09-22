// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../shared/stable-pane-id'
import { createAgentCompletionLifecycle } from '../../components/terminal-pane/agent-completion-lifecycle'
import {
  applyTerminalPaneCloseRequest,
  suppressIntentionalPaneCloseExit
} from '../../components/terminal-pane/terminal-pane-lifecycle-close'
import { warnTerminalLifecycleAnomaly } from '../../components/terminal-pane/terminal-lifecycle-diagnostics'
import { isVisibleForegroundPaneKey } from '../../components/terminal-pane/terminal-notification-pane-visibility'
import {
  createQueuedStartupConsumer,
  extractUncHost,
  getPreviousVisibleForTerminalPane,
  isTerminalPaneVisibilityResume,
  paneOwnsQueuedStartup,
  replayLayoutWithOneShotParkIntent,
  resolvePaneSeedCwd,
  resolveTerminalHomePathFromEnv,
  shouldDetachPaneTransportOnUnmount,
  splitPaneWithOneShotStartup
} from '../../components/terminal-pane/terminal-pane-lifecycle-primitives'
import { attachDomRendererFocusClassSync } from './pane-dom-focus-class-sync'
import { isManagedPaneDisplayNone } from './pane-display-visibility'
import { readFitClientSize } from './pane-fit-client-size'
import {
  clearPaneFitContinuationRetry,
  armPaneFitContinuationRetry
} from './pane-fit-continuation-retry'
import {
  flushPendingSafeFitContinuations,
  hasPendingSafeFitContinuations,
  registerPendingSafeFitContinuation
} from './pane-fit-continuation-registry'
import {
  deferFitContinuation,
  flushDeferredFitContinuations
} from './pane-fit-deferred-continuations'
import { canMeasurePaneForFit } from './pane-fit-measurability'
import { PaneReparentFrameTracker } from './pane-reparent-frame-tracker'
import {
  containsDrainableCursorRestore,
  removeTransientCursorShowSequences
} from './pane-terminal-cursor-sequencing'
import {
  createQueueEntry,
  isEntryDrainable
} from './pane-terminal-foreground-queue-state'
import { queueCapExceeded } from './pane-terminal-output-queue-backlog'
import {
  configureTerminalOutputBacklogCap,
  getTerminalOutputMaxQueueChars
} from './pane-terminal-output-queue-registry'
import { addTerminalFollowOutputWaiter, notifyTerminalFollowOutputWaiters } from './terminal-follow-output-waiters'
import {
  beginTerminalScrollIntentBufferRebuild,
  endTerminalScrollIntentBufferRebuild,
  isTerminalScrollIntentRebuildInFlight
} from './terminal-scroll-intent-rebuild'
import {
  readKeyedTerminalScrollIntent,
  releaseTerminalScrollIntentKey,
  writeKeyedTerminalScrollIntent
} from './terminal-scroll-intent-key-store'

const LEAF = '11111111-1111-4111-8111-111111111111'

function box(width: number, height: number, cols: number, rows: number) {
  const container = document.createElement('div')
  container.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }) as DOMRect
  return {
    container,
    terminal: { proposeDimensions: () => ({ cols, rows }) }
  }
}

describe('ghostty pane lifecycle helpers', () => {
  afterEach(() => {
    vi.useRealTimers()
    releaseTerminalScrollIntentKey(LEAF)
  })

  it('keeps a split cwd and spends a queued startup once', () => {
    expect(extractUncHost('\\\\files\\share')).toBe('files')
    expect(resolvePaneSeedCwd('/split', '/repo')).toBe('/split')
    expect(resolvePaneSeedCwd(undefined, '/repo')).toBe('/repo')
    expect(resolveTerminalHomePathFromEnv({ HOME: ' /Users/rudi ' })).toBe('/Users/rudi')
    expect(resolveTerminalHomePathFromEnv({ HOMEDRIVE: 'C:', HOMEPATH: '\\Users\\rudi' })).toBe(
      'C:\\Users\\rudi'
    )
    const startup = { command: 'echo hi' }
    expect(paneOwnsQueuedStartup(startup, startup)).toBe(true)
    expect(paneOwnsQueuedStartup({ command: 'other' }, startup)).toBe(false)
    let spent = 0
    const consume = createQueuedStartupConsumer(startup, startup, () => {
      spent += 1
    }, () => true)
    consume?.()
    consume?.()
    expect(spent).toBe(1)
    const deps = { startup: null as { command: string } | null }
    const pane = splitPaneWithOneShotStartup(deps, startup, () => {
      expect(deps.startup).toEqual(startup)
      return 'pane'
    })
    expect(pane).toBe('pane')
    expect(deps.startup).toBeNull()
    const park = { mountFollowsTerminalPark: true }
    replayLayoutWithOneShotParkIntent(park, () => 'restored')
    expect(park.mountFollowsTerminalPark).toBe(false)
    expect(shouldDetachPaneTransportOnUnmount({
      tabStillExists: false,
      tabId: 'tab-1',
      ptyId: 'pty-1',
      worktreeTabs: []
    })).toBe(true)
    expect(shouldDetachPaneTransportOnUnmount({
      tabStillExists: true,
      tabId: 'tab-1',
      ptyId: null,
      worktreeTabs: []
    })).toBe(false)
    expect(isTerminalPaneVisibilityResume({ previousIsVisible: false, isVisible: true })).toBe(true)
    expect(isTerminalPaneVisibilityResume({ previousIsVisible: true, isVisible: true })).toBe(false)
    expect(getPreviousVisibleForTerminalPane({
      previous: { tabId: 'tab-1', cwd: '/repo', isVisible: false },
      tabId: 'tab-1',
      cwd: '/repo'
    })).toBe(false)
    expect(getPreviousVisibleForTerminalPane({
      previous: { tabId: 'tab-1', cwd: '/repo', isVisible: false },
      tabId: 'tab-2',
      cwd: '/repo'
    })).toBeNull()
  })

  it('strips a transient cursor show that is followed by a hide', () => {
    expect(removeTransientCursorShowSequences('A\x1b[?25h\x1b[?25lB')).toBe('A\x1b[?25lB')
    expect(containsDrainableCursorRestore('\x1b[?25l\x1b[1G\x1b[?25h')).toBe(true)
    expect(containsDrainableCursorRestore('plain')).toBe(false)
  })

  it('holds a foreground queue entry until the hold clears', () => {
    const entry = createQueueEntry({} as never, { foreground: true })
    entry.foregroundHold = true
    expect(isEntryDrainable(entry)).toBe(false)
    entry.foregroundHold = false
    expect(isEntryDrainable(entry)).toBe(true)
    configureTerminalOutputBacklogCap(50_000)
    expect(getTerminalOutputMaxQueueChars()).toBe(6_000_000)
    entry.queuedChars = getTerminalOutputMaxQueueChars() + 1
    expect(queueCapExceeded(entry)).toBe(true)
  })

  it('stores a keyed scroll intent until the leaf is released', () => {
    writeKeyedTerminalScrollIntent(LEAF, {
      kind: 'pinnedViewport',
      bufferType: 'normal',
      viewportY: 4,
      baseY: 9,
      revision: 1
    })
    expect(readKeyedTerminalScrollIntent(LEAF)?.viewportY).toBe(4)
    releaseTerminalScrollIntentKey(LEAF)
    expect(readKeyedTerminalScrollIntent(LEAF)).toBeUndefined()
  })

  it('refuses to fit a Ghostty pane whose box is below the floor', () => {
    expect(canMeasurePaneForFit(box(10, 10, 2, 2) as never)).toBe(false)
    expect(canMeasurePaneForFit(box(800, 400, 80, 24) as never)).toBe(true)
    const measured = box(80.4, 24.6, 80, 24)
    expect(readFitClientSize(measured as never)).toEqual({ width: 80, height: 25 })
    const hidden = document.createElement('div')
    hidden.style.display = 'none'
    const child = document.createElement('div')
    hidden.appendChild(child)
    document.body.appendChild(hidden)
    expect(isManagedPaneDisplayNone({ container: child } as never)).toBe(true)
  })

  it('runs a pending fit continuation once the pane is flushed', () => {
    const pane = { terminal: {} }
    let ran = 0
    registerPendingSafeFitContinuation(pane as never, 'grid', {
      continuation: () => {
        ran += 1
      },
      shouldContinue: () => true,
      resolve: () => undefined,
      deferIfHidden: false
    })
    expect(hasPendingSafeFitContinuations(pane as never)).toBe(true)
    flushPendingSafeFitContinuations(pane as never)
    expect(ran).toBe(1)
    expect(hasPendingSafeFitContinuations(pane as never)).toBe(false)
    let deferred = 0
    deferFitContinuation(pane as never, 'grid', {
      continuation: () => {
        deferred += 1
      },
      shouldContinue: () => true
    })
    flushDeferredFitContinuations(pane as never)
    expect(deferred).toBe(1)
  })

  it('cancels a fit retry before it fires', () => {
    vi.useFakeTimers()
    const pane = { id: 1 }
    let retries = 0
    armPaneFitContinuationRetry(pane as never, {
      retry: () => {
        retries += 1
        return false
      },
      onExhausted: () => undefined
    })
    clearPaneFitContinuationRetry(pane as never)
    vi.runAllTimers()
    expect(retries).toBe(0)
  })

  it('syncs the DOM focus class onto the row element', () => {
    const root = document.createElement('div')
    root.className = 'focus'
    const rows = document.createElement('div')
    rows.className = 'xterm-rows'
    root.appendChild(rows)
    const stop = attachDomRendererFocusClassSync(root)
    expect(rows.classList.contains('xterm-focus')).toBe(true)
    root.classList.remove('focus')
    root.dispatchEvent(new FocusEvent('focusout'))
    expect(rows.classList.contains('xterm-focus')).toBe(false)
    stop()
  })

  it('drops a reparent frame after the pane manager is destroyed', async () => {
    const tracker = new PaneReparentFrameTracker(() => true)
    let calls = 0
    tracker.request(() => {
      calls += 1
    })
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    expect(calls).toBe(0)
    tracker.cancelPending()
  })

  it('releases follow-output waiters once', () => {
    const terminal = {}
    let ran = 0
    const cancel = addTerminalFollowOutputWaiter(terminal as never, () => {
      ran += 1
    })
    notifyTerminalFollowOutputWaiters(terminal as never)
    notifyTerminalFollowOutputWaiters(terminal as never)
    expect(ran).toBe(1)
    cancel()
  })

  it('tracks a scroll-intent rebuild until it ends', () => {
    const terminal = {}
    beginTerminalScrollIntentBufferRebuild(terminal as never)
    expect(isTerminalScrollIntentRebuildInFlight(terminal as never)).toBe(true)
    endTerminalScrollIntentBufferRebuild(terminal as never)
    expect(isTerminalScrollIntentRebuildInFlight(terminal as never)).toBe(false)
  })

  it('resets agent completion state once', () => {
    const state = {
      workingStatusObserved: true,
      lastCompletionToken: 'done',
      lastCompletionAt: 1,
      lastCompletedTurn: 2,
      lastCompletionSource: 'hook' as const,
      lastCompletionIdentity: {},
      lastAttentionToken: 'look',
      requiresFreshWorking: false,
      pendingHookDoneTimer: null
    }
    let cleared = 0
    const lifecycle = createAgentCompletionLifecycle({
      state,
      processState: { disposed: false, lastForegroundAgent: 'claude', hasAgentRunEvidence: true },
      identityScope: { dispose: () => undefined } as never,
      clearPendingHookDone: () => undefined,
      clearPendingCodexAttention: () => undefined,
      dropPendingTitle: () => undefined,
      clearWorkingBoundary: () => undefined,
      incrementGeneration: () => undefined,
      clearPollTimer: () => undefined,
      isLive: () => false,
      clearEvidence: () => {
        cleared += 1
      },
      clearTitleStatus: () => undefined
    })
    lifecycle.resetCompletionState()
    expect(cleared).toBe(1)
    expect(state.lastCompletionToken).toBeNull()
    expect(state.workingStatusObserved).toBe(false)
  })

  it('warns once for the same lifecycle anomaly', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    warnTerminalLifecycleAnomaly('pty-exit', { tabId: 'tab-1', ptyId: 'pty-1' })
    warnTerminalLifecycleAnomaly('pty-exit', { tabId: 'tab-1', ptyId: 'pty-1' })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('closes one pane when a split remains and the tab when it is the last pane', () => {
    let closed = 0
    let closedTab = 0
    const manager = {
      closePane: () => {
        closed += 1
      },
      detachPaneForExternalMove: () => false,
      retirePanePreservingPty: () => false,
      getNumericIdForLeaf: () => 2,
      getPanes: () => [{}, {}]
    }
    expect(applyTerminalPaneCloseRequest({
      detail: { tabId: 'tab-1', paneRuntimeId: 2 },
      manager,
      closeTab: () => {
        closedTab += 1
      },
      closeTabPreservingPty: () => undefined
    })).toBe('pane')
    expect(closed).toBe(1)
    expect(closedTab).toBe(0)
    manager.getPanes = () => [{}]
    expect(applyTerminalPaneCloseRequest({
      detail: { tabId: 'tab-1', paneRuntimeId: 2 },
      manager,
      closeTab: () => {
        closedTab += 1
      },
      closeTabPreservingPty: () => undefined
    })).toBe('tab')
    expect(closedTab).toBe(1)
    const suppressed: string[] = []
    expect(suppressIntentionalPaneCloseExit({ getPtyId: () => 'pty-1' }, (ptyId) => {
      suppressed.push(ptyId)
    })).toBe('pty-1')
    expect(suppressed).toEqual(['pty-1'])
  })

  it('treats the active leaf as the foreground notification pane', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    const paneKey = makePaneKey('tab-1', LEAF)
    expect(isVisibleForegroundPaneKey({
      activeWorktreeId: 'wt-1',
      activeTabId: 'tab-1',
      terminalLayoutsByTabId: { 'tab-1': { activeLeafId: LEAF } as never }
    }, 'wt-1', paneKey)).toBe(true)
    expect(isVisibleForegroundPaneKey({
      activeWorktreeId: 'wt-2',
      activeTabId: 'tab-1',
      terminalLayoutsByTabId: { 'tab-1': { activeLeafId: LEAF } as never }
    }, 'wt-1', paneKey)).toBe(false)
  })
})
