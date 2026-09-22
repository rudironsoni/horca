// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { isSupersededAgentCompletionSnapshot } from '../../components/terminal-pane/agent-completion-snapshot-staleness'
import { SessionRestoredBannerPortals } from '../../components/terminal-pane/SessionRestoredBannerPortals'
import { restoreTerminalPaneLayout } from '../../components/terminal-pane/terminal-pane-layout-restore'
import {
  buildMainModelSnapshotReplayWrites,
  hasPositiveTerminalDimensions,
  resolvePositiveTerminalDimensions,
  shouldSkipAltFrameForWidthMismatch
} from '../../components/terminal-pane/terminal-snapshot-replay-paint'
import { createReattachPayloadHandlers } from '../../components/terminal-pane/pty-connection/apply-reattach-payload'
import { bindBuildColdRestoreAgentResumeStartup } from '../../components/terminal-pane/pty-connection/cold-restore-resume-startup'
import {
  hasCursorAgentReattachPayloadScreenSignal,
  terminalHasFocusReportingEnabled,
  terminalOwnsDomFocus
} from '../../components/terminal-pane/pty-connection/cursor-agent-reattach-screen'
import { bindDeferredColdRestoreAndSnapshot } from '../../components/terminal-pane/pty-connection/deferred-cold-restore-and-snapshot'
import { runDeferredSessionReattachChoice } from '../../components/terminal-pane/pty-connection/deferred-session-reattach-choice'
import { startDeferredSessionReattach } from '../../components/terminal-pane/pty-connection/deferred-session-reattach-connect'
import { bindAbandonHiddenOutputRestore } from '../../components/terminal-pane/pty-connection/hidden-output-restore-abandon'
import { bindHiddenOutputRestoreChunk } from '../../components/terminal-pane/pty-connection/hidden-output-restore-chunk'
import { bindHiddenOutputRestoreDrain } from '../../components/terminal-pane/pty-connection/hidden-output-restore-drain'
import {
  HIDDEN_OUTPUT_RESTORE_PENDING_CHARS,
  HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING
} from '../../components/terminal-pane/pty-connection/hidden-output-restore-limits'
import { bindHiddenOutputRestoreRequest } from '../../components/terminal-pane/pty-connection/hidden-output-restore-request'
import { bindHiddenOutputRestoreSnapshot } from '../../components/terminal-pane/pty-connection/hidden-output-restore-snapshot'
import { bindSerializeHiddenOutputSnapshot } from '../../components/terminal-pane/pty-connection/hidden-output-snapshot-serialize'
import { bindHiddenRestoreStateAndSshProbe } from '../../components/terminal-pane/pty-connection/hidden-restore-state-and-ssh-probe'
import {
  isRemoteRuntimePtyId,
  isSessionOwnedByWorktree
} from '../../components/terminal-pane/pty-connection/paired-parked-terminal-restore'
import { bindReattachLiveDataDeferral } from '../../components/terminal-pane/pty-connection/reattach-live-data-deferral'
import { bindHandleReattachResult } from '../../components/terminal-pane/pty-connection/reattach-result-handler'
import { bindPrepaintParkedSshSnapshot } from '../../components/terminal-pane/pty-connection/ssh-snapshot-prepaint'
import { buildFrameRestoreSnapshotFields } from '../../../../main/daemon/terminal-frame-restore-sequences'
import {
  clearPaneWebglContextLossForRetry,
  rebuildAttachedWebgl
} from './pane-webgl-reattach'
import {
  clampTerminalViewportY,
  isTerminalViewportAtBottom,
  readTerminalScrollBufferSnapshot,
  safeTerminalScrollCall
} from './terminal-scroll-buffer-snapshot'
import {
  SNAPSHOT_REPLAY_PREAMBLE_ALT,
  SNAPSHOT_REPLAY_PREAMBLE_NORMAL
} from '../../../../shared/terminal-restore-parity-fixture'

describe('ghostty restore behavior', () => {
  it('keeps a positive grid and skips a wider alt frame', () => {
    expect(hasPositiveTerminalDimensions(80, 24)).toBe(true)
    expect(hasPositiveTerminalDimensions(Number.POSITIVE_INFINITY, 24)).toBe(false)
    expect(resolvePositiveTerminalDimensions(0, 24)).toBeNull()
    expect(resolvePositiveTerminalDimensions(80, 24)).toEqual({ cols: 80, rows: 24 })
    expect(shouldSkipAltFrameForWidthMismatch(120, 80)).toBe(true)
    expect(shouldSkipAltFrameForWidthMismatch(80, 120)).toBe(false)
    const writes = buildMainModelSnapshotReplayWrites(
      { data: 'HELLO', alternateScreen: false },
      { paneOnAlternateScreen: false }
    )
    expect(writes[0]?.startsWith('\x18')).toBe(true)
    expect(writes.join('')).toContain('HELLO')
  })

  it('drops a completion snapshot when a newer agent turn started', () => {
    expect(isSupersededAgentCompletionSnapshot(undefined, undefined)).toBe(false)
    expect(
      isSupersededAgentCompletionSnapshot(
        { state: 'working', stateStartedAt: 20 },
        { state: 'done', stateStartedAt: 10 }
      )
    ).toBe(true)
    expect(
      isSupersededAgentCompletionSnapshot(
        { state: 'done', stateStartedAt: 10 },
        { state: 'working', stateStartedAt: 10, turnCompletedAt: 10 }
      )
    ).toBe(false)
  })

  it('owns a session id only for its worktree and a remote pty prefix', () => {
    expect(isRemoteRuntimePtyId('remote:pane-1')).toBe(true)
    expect(isRemoteRuntimePtyId('pty-1')).toBe(false)
    expect(isSessionOwnedByWorktree('wt-1@@abc', 'wt-1')).toBe(true)
    expect(isSessionOwnedByWorktree('wt-2@@abc', 'wt-1')).toBe(false)
    expect(isSessionOwnedByWorktree('plain-session', 'wt-1')).toBe(true)
  })

  it('reads an alternate scroll snapshot and rejects a dimensions scroll error', () => {
    expect(
      readTerminalScrollBufferSnapshot({
        buffer: { active: { type: 'alternate', viewportY: 3, baseY: 9 } }
      })
    ).toEqual({ bufferType: 'alternate', viewportY: 3, baseY: 9 })
    expect(readTerminalScrollBufferSnapshot({})).toBeNull()
    expect(isTerminalViewportAtBottom(9, 9)).toBe(true)
    expect(isTerminalViewportAtBottom(2, 9)).toBe(false)
    expect(clampTerminalViewportY(-4, 9)).toBe(0)
    expect(clampTerminalViewportY(12, 9)).toBe(9)
    expect(
      safeTerminalScrollCall(() => {
        throw new TypeError('dimensions missing')
      })
    ).toBe(false)
    expect(safeTerminalScrollCall(() => undefined)).toBe(true)
  })

  it('detects a cursor-agent screen, focus reporting, and the textarea owner', () => {
    expect(hasCursorAgentReattachPayloadScreenSignal('old\nCursor Agent\n→  ')).toBe(true)
    expect(hasCursorAgentReattachPayloadScreenSignal('Cursor Agent\nprompt')).toBe(false)
    expect(terminalHasFocusReportingEnabled({ modes: { sendFocusMode: true } })).toBe(true)
    expect(terminalHasFocusReportingEnabled({})).toBe(false)
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    textarea.focus()
    expect(terminalOwnsDomFocus({ textarea })).toBe(true)
    expect(terminalOwnsDomFocus({})).toBe(false)
  })

  it('emits alt-screen frame sequences and an empty object off the alt screen', () => {
    const terminal = {
      cols: 80,
      rows: 24,
      modes: {
        bracketedPasteMode: true,
        applicationCursorKeysMode: false,
        applicationKeypadMode: false,
        insertMode: false,
        reverseWraparoundMode: false,
        sendFocusMode: false,
        wraparoundMode: true,
        showCursor: true
      },
      buffer: { active: { cursorX: 1, cursorY: 2 }, normal: { length: 0 } }
    }
    const off = buildFrameRestoreSnapshotFields(
      { serialize: () => 'PEN' },
      terminal,
      {
        alternateScreen: false,
        bracketedPaste: true,
        mouseTracking: false,
        applicationCursor: false
      }
    )
    expect(off).toEqual({})
    const on = buildFrameRestoreSnapshotFields(
      { serialize: () => 'PEN' },
      terminal,
      {
        alternateScreen: true,
        bracketedPaste: true,
        mouseTracking: true,
        mouseTrackingMode: 'vt200',
        applicationCursor: false
      }
    )
    expect(on.frameRestoreAnsi).toContain('\x1b[?1049h')
    expect(on.frameRestoreAnsi).toContain('\x1b[?2004h')
    expect(on.frameRestoreAnsi).toContain('\x1b[?1000h')
    expect(on.frameRestoreAnsi).toContain('PEN')
  })

  it('caps hidden restore pending bytes and names the skip warning', () => {
    expect(HIDDEN_OUTPUT_RESTORE_PENDING_CHARS).toBe(512 * 1024)
    expect(HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING).toContain('skipped hidden terminal output')
  })

  it('queues a live chunk and slices bytes that arrive after the snapshot seq', () => {
    const session = {
      transport: { getPtyId: () => 'pty-1' },
      canUseHiddenOutputSnapshot: () => true,
      hiddenOutputRestorePtyId: null as string | null,
      hiddenOutputRestoreNeeded: false,
      hiddenOutputRestorePendingOverflow: false,
      hiddenOutputRestorePendingChars: 0,
      hiddenOutputRestorePendingChunks: [] as Array<{ data: string; seq?: number; rawLength?: number }>,
      armHiddenOutputRestoreForegroundDeadline: () => undefined,
      clearHiddenOutputRestoreState: () => undefined,
      salvageRendererQueriesFromDiscardedRestoreData: () => undefined
    }
    bindHiddenOutputRestoreChunk(session as never)
    session.queueLiveChunkDuringRestore('', { seq: 1 })
    expect(session.hiddenOutputRestorePendingChunks).toEqual([])
    session.queueLiveChunkDuringRestore('é', { seq: 10, rawLength: 2 })
    expect(session.hiddenOutputRestoreNeeded).toBe(true)
    expect(session.hiddenOutputRestorePendingChars).toBe('é'.length)
    expect(session.hiddenOutputRestorePendingChunks).toEqual([
      { data: 'é', seq: 10, rawLength: 2 }
    ])
    expect(
      session.getChunkDataAfterSnapshot({ data: 'abcd', seq: 10, rawLength: 4 }, 8)
    ).toBe('cd')
  })

  it('abandons restore only for the pty that owns the pending bytes', () => {
    let reset = 0
    const session = {
      transport: { getPtyId: () => 'pty-1' },
      hiddenOutputRestorePtyId: 'pty-2',
      resetHiddenOutputRestoreIfPtyChanged: () => {
        reset += 1
      }
    }
    bindAbandonHiddenOutputRestore(session as never)
    session.abandonHiddenOutputRestoreAndDrainPendingForeground('pty-1')
    expect(reset).toBe(1)
  })

  it('clears queued live chunks when restore is dropped', () => {
    const session = {
      pane: { terminal: {} },
      hiddenOutputRestorePendingChunks: [{ data: 'x' }],
      hiddenOutputRestorePendingChars: 1,
      hiddenOutputRestorePendingOverflow: true,
      hiddenOutputRestoreFreshSnapshotNeeded: true,
      hiddenOutputRestoreRetryDeferred: true,
      hiddenOutputRestoreScheduled: true,
      hiddenOutputRestoreDeferredRetryTimer: null,
      hiddenOutputRestoreForegroundDeadlineTimer: null,
      hiddenOutputRestoreDeferredRetryAttempts: 2,
      clearHiddenOutputRestoreDeferredRetryTimer: () => undefined,
      clearHiddenOutputRestoreForegroundDeadlineTimer: () => undefined
    }
    bindHiddenOutputRestoreDrain(session as never)
    session.clearPendingLiveChunksDuringRestore()
    expect(session.hiddenOutputRestorePendingChunks).toEqual([])
    expect(session.hiddenOutputRestorePendingChars).toBe(0)
    expect(session.hiddenOutputRestorePendingOverflow).toBe(false)
    expect(session.hiddenOutputRestoreDeferredRetryAttempts).toBe(0)
  })

  it('grounds a skipped hidden restore before any warning when the pane is hidden', () => {
    const writes: string[] = []
    const session = {
      deps: { isVisibleRef: { current: false } },
      pane: { terminal: {} },
      writePtyOutputToXterm: (data: string) => {
        writes.push(data)
      }
    }
    bindHiddenOutputRestoreSnapshot(session as never)
    session.writeRestoreUnavailableWarning()
    expect(writes).toEqual(['\x18\x1b[0m'])
  })

  it('declares a hidden spawn only while the delivery gate is active and the pane is hidden', () => {
    const session = {
      hiddenDeliveryGateActive: true,
      runtimeEnvironmentId: null,
      disposed: false,
      deps: { isVisibleRef: { current: false } },
      hiddenOutputRestoreFloodSuppressedUntil: 0,
      hiddenOutputRestoreInFlight: null,
      hiddenOutputRestoreFloodRepaintTimer: null
    }
    bindSerializeHiddenOutputSnapshot(session as never)
    expect(session.shouldDeclareHiddenAtSpawn()).toBe(true)
    session.disposed = true
    expect(session.shouldDeclareHiddenAtSpawn()).toBe(false)
  })

  it('does not request a hidden restore when nothing is pending', () => {
    const session = {
      pane: { terminal: {} },
      deps: { tabId: 'tab-1', isVisibleRef: { current: true } },
      disposed: false,
      transport: { getPtyId: () => 'pty-1' },
      hiddenOutputRestoreNeeded: false,
      hiddenOutputRestorePendingChunks: [],
      hiddenOutputRestorePtyId: null,
      resetHiddenOutputRestoreIfPtyChanged: () => undefined
    }
    bindHiddenOutputRestoreRequest(session as never)
    expect(session.requestHiddenOutputRestoreIfNeeded()).toBe(false)
  })

  it('clears hidden restore state and refuses a blank snapshot baseline', () => {
    const session = {
      pane: { terminal: {} },
      deps: {
        isVisibleRef: { current: false },
        paneMode2031Ref: { current: new Map([[1, true]]) },
        paneLastThemeModeRef: { current: new Map() }
      },
      paneStartup: null,
      transport: { getPtyId: () => 'pty-1' },
      hiddenOutputRestoreGeneration: 3,
      hiddenOutputRestoreNeeded: true,
      hiddenOutputRestorePtyId: 'pty-1',
      hiddenOutputRestoreReplayingSnapshot: { seq: 1 },
      hiddenOutputRestoreRemoteAbandonCycles: 2,
      hiddenOutputRestoreRemoteOutcomeAttempts: 2,
      hiddenOutputRestoreLocalGateAttempts: 2,
      hiddenStartupRendererQueryPending: 'q',
      hiddenRendererStateDirty: true,
      hiddenOutputSnapshotScrollRestore: null,
      pendingHiddenSnapshotFit: null,
      cancelSnapshotScrollRestore: () => undefined,
      clearPendingLiveChunksDuringRestore: () => undefined
    }
    bindDeferredColdRestoreAndSnapshot(session as never)
    session.setRestoredSnapshotBaseline('pty-1', { seq: 4 }, false)
    expect(session.restoredSnapshotBaselineSeq).toBeNull()
    bindHiddenRestoreStateAndSshProbe(session as never)
    session.hiddenOutputRestoreGeneration = 3
    session.hiddenOutputRestoreNeeded = true
    session.hiddenOutputRestorePtyId = 'pty-1'
    session.clearHiddenOutputRestoreState()
    expect(session.hiddenOutputRestoreGeneration).toBe(4)
    expect(session.hiddenOutputRestoreNeeded).toBe(false)
    expect(session.hiddenOutputRestorePtyId).toBeNull()
  })

  it('marks a failed reattach deferral and drops the queue when delivery is refused', () => {
    const owner = { failed: false }
    const session = {
      reattachLiveDataDeferralDepth: 1,
      transportStreamGeneration: 3,
      deferredReattachLiveDataOwners: new Map([[3, owner]]),
      deferredReattachLiveData: null,
      disposed: false,
      transport: { getPtyId: () => 'pty-1' },
      pane: { terminal: {} }
    }
    bindReattachLiveDataDeferral(session as never)
    session.finishReattachLiveDataDeferral(false)
    expect(owner.failed).toBe(true)
    expect(session.reattachLiveDataDeferralDepth).toBe(0)
  })

  it('returns false from a disposed reattach result', async () => {
    const session = { disposed: true }
    bindHandleReattachResult(session as never)
    await expect(session.handleReattachResult({ id: 'pty-1' })).resolves.toBe(false)
  })

  it('skips reattach payload writes when the attempt is no longer current', async () => {
    const writes: string[] = []
    const handlers = createReattachPayloadHandlers(
      { writeReplayData: (data: string) => writes.push(data) } as never,
      { isCurrentReattachPayload: () => false } as never
    )
    await handlers.applyReattachPayload()
    expect(writes).toEqual([])
  })

  it('does not fetch an ssh snapshot when the pane is not following a park', () => {
    let fetched = 0
    const session = {
      mountFollowsTerminalPark: false,
      connectionId: 'ssh-1',
      getSshMainModelSnapshotProbe: () => {
        fetched += 1
        return async () => null
      }
    }
    bindPrepaintParkedSshSnapshot(session as never)
    session.prepaintParkedSshSnapshot('ssh-1')
    expect(fetched).toBe(0)
  })

  it('returns no cold-restore command while a startup command is still pending', () => {
    const session = { pendingStartupCommand: 'echo hi' }
    bindBuildColdRestoreAgentResumeStartup(session as never)
    expect(session.buildColdRestoreAgentResumeStartup()).toBeNull()
  })

  it('starts a remote reattach by prepainting and connecting that session id', () => {
    const painted: Array<string | null> = []
    const connected: string[] = []
    const session = {
      allowInitialIdleCacheSeed: false,
      pane: { id: 4 },
      runtimeEnvironmentId: null,
      cols: 80,
      rows: 24,
      disposed: false,
      deps: { paneTransportsRef: { current: new Map() } },
      directSshRetryAttempt: null,
      transportStreamGeneration: 1,
      transportConnectInFlightSince: null as number | null,
      prepaintParkedSshSnapshot: (ptyId: string | null) => {
        painted.push(ptyId)
      },
      buildColdRestoreAgentResumeStartup: () => null,
      shouldDeclareHiddenAtSpawn: () => false,
      captureTransportOutputCallbacks: () => ({ generation: 1, callbacks: {} }),
      beginReattachLiveDataDeferral: () => undefined,
      finishReattachLiveDataDeferral: () => undefined,
      armDirectSshPaneRetryTimeout: () => undefined,
      transport: {
        getPtyId: () => 'remote:pane-9',
        connect: (args: { sessionId?: string }) => {
          connected.push(args.sessionId ?? '')
          return new Promise(() => undefined)
        }
      }
    }
    session.deps.paneTransportsRef.current.set(4, session.transport)
    startDeferredSessionReattach(session as never, 'remote:pane-9')
    expect(session.allowInitialIdleCacheSeed).toBe(true)
    expect(painted).toEqual(['remote:pane-9'])
    expect(connected).toEqual(['remote:pane-9'])
  })

  it('fresh-spawns when the tab has no restored pty id', () => {
    let spawned = 0
    const session = {
      pane: { id: 8 },
      deps: {
        restoredLeafId: null,
        restoredPtyIdByLeafId: {},
        worktreeId: 'missing-wt',
        tabId: 'tab-missing',
        paneTransportsRef: { current: new Map() }
      },
      hadExistingPaneTransportAtConnect: false,
      mountFollowsTerminalPark: false,
      runtimeEnvironmentId: null,
      pendingSpawnKey: 'no-pending-spawn',
      getSleepingRecordForPane: () => null,
      startFreshSpawn: () => {
        spawned += 1
      },
      startFreshColdRestoreAgentResume: () => undefined
    }
    runDeferredSessionReattachChoice(session as never)
    expect(spawned).toBe(1)
    expect(session.allowInitialIdleCacheSeed).toBe(false)
  })

  it('restores a rootless layout title onto the created pane', () => {
    const titles: Record<number, string> = {}
    let active: number | null = null
    let expanded: number | null = 99
    const manager = {
      createInitialPane: (opts: { leafId?: string }) => ({
        id: 7,
        leafId: opts.leafId ?? 'leaf-a'
      }),
      getActivePane: () => ({ id: 7 }),
      getPanes: () => [{ id: 7 }],
      setActivePane: (id: number) => {
        active = id
      }
    }
    const restored = restoreTerminalPaneLayout({
      manager: manager as never,
      deps: {
        initialLayoutRef: {
          current: {
            root: null,
            activeLeafId: null,
            expandedLeafId: null,
            titlesByLeafId: { 'leaf-a': 'Shell' }
          }
        },
        tabId: 'tab-1',
        worktreeId: 'wt-1',
        isActive: true,
        managerRef: { current: manager },
        containerRef: { current: null },
        expandedStyleSnapshotRef: { current: null },
        replayingPanesRef: { current: new Set() },
        setPaneTitles: (update: (prev: Record<number, string>) => Record<number, string>) => {
          Object.assign(titles, update({}))
        },
        paneTitlesRef: { current: {} },
        setExpandedPane: (id: number | null) => {
          expanded = id
        }
      } as never,
      refs: { restoredViewportBlankingPanesRef: { current: new Set() } } as never,
      ptyDeps: { mountFollowsTerminalPark: true } as never,
      initialLayoutHadBuffers: false
    })
    expect(restored.get('leaf-a')).toBe(7)
    expect(titles[7]).toBe('Shell')
    expect(active).toBe(7)
    expect(expanded).toBeNull()
  })

  it('portals a restored banner only for a pane id that has a reason', () => {
    const shown = document.createElement('div')
    const hidden = document.createElement('div')
    document.body.append(shown, hidden)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const reasons = new Map([['pane-a', 'restored' as const]])
    act(() => {
      root.render(
        createElement(SessionRestoredBannerPortals, {
          panes: [
            { id: 'pane-a', container: shown },
            { id: 'pane-b', container: hidden }
          ],
          paneIds: reasons
        })
      )
    })
    expect(shown.textContent).toContain('--- session restored ---')
    expect(hidden.textContent).toBe('')
    act(() => {
      root.unmount()
    })
  })

  it('keeps webgl retry open until a context loss and defers a rebuild', () => {
    const open = { webglDisabledAfterContextLoss: false }
    expect(clearPaneWebglContextLossForRetry(open as never)).toBe(true)
    const deferred = {
      gpuRenderingEnabled: true,
      webglDisabledAfterContextLoss: false,
      webglAttachmentDeferred: true,
      webglRebuildDeferred: false
    }
    rebuildAttachedWebgl(deferred as never)
    expect(deferred.webglRebuildDeferred).toBe(true)
  })

  it('grounds the normal and alt snapshot preambles with the abort byte', () => {
    expect(SNAPSHOT_REPLAY_PREAMBLE_NORMAL.startsWith('\x18')).toBe(true)
    expect(SNAPSHOT_REPLAY_PREAMBLE_ALT.startsWith('\x18')).toBe(true)
    expect(SNAPSHOT_REPLAY_PREAMBLE_ALT).not.toBe(SNAPSHOT_REPLAY_PREAMBLE_NORMAL)
  })
})
