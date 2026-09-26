// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAgentCompletionCoordinator } from '../../components/terminal-pane/agent-completion-coordinator'
import { createAgentCompletionHookObserver } from '../../components/terminal-pane/agent-completion-hook-observer'
import { createAgentCompletionNotificationController } from '../../components/terminal-pane/agent-completion-notification-controller'
import { createPendingTitleController } from '../../components/terminal-pane/agent-completion-pending-title'
import { createAgentCompletionPollScheduler } from '../../components/terminal-pane/agent-completion-poll-scheduler'
import { createAgentCompletionProcessMonitor } from '../../components/terminal-pane/agent-completion-process-monitor'
import { createAgentCompletionTitleObserver } from '../../components/terminal-pane/agent-completion-title-observer'
import { prepareAgentSessionForkFromPane } from '../../components/terminal-pane/terminal-agent-session-fork'
import {
  continueAgentSessionFromMenuPane,
  forkAgentSessionFromMenuPane
} from '../../components/terminal-pane/terminal-pane-menu-agent-session-actions'

const LEAF = '11111111-1111-4111-8111-111111111111'

afterEach(() => {
  vi.useRealTimers()
})

function coordinatorOptions(isLive = true) {
  return {
    paneKey: `tab-1:${LEAF}`,
    getPtyId: () => 'pty-1',
    getSettings: () => null,
    inspectProcess: async () => ({}),
    dispatchCompletion: () => undefined,
    isLive: () => isLive
  }
}

describe('ghostty agent chrome factories', () => {
  it('holds a pending title until inspection and drops it on demand', () => {
    let inspections = 0
    let eligible = ''
    const pending = createPendingTitleController({
      hasAgentEvidence: () => true,
      onEligible: (title) => {
        eligible = title
      },
      onExpired: () => undefined,
      requestInspection: () => {
        inspections += 1
      },
      schedulePoll: () => undefined
    })
    pending.hold('Codex done')
    expect(inspections).toBe(1)
    expect(pending.get()?.title).toBe('Codex done')
    const id = pending.get()?.id ?? 0
    pending.finishInspection(id + 1, true, true)
    expect(eligible).toBe('')
    pending.finishInspection(id, true, true)
    expect(eligible).toBe('Codex done')
    pending.drop()
    expect(pending.get()).toBeNull()
  })

  it('does not poll a remote pty and does not arm a timer while disposed', () => {
    const state = {
      disposed: true,
      pollTrackingStarted: true,
      pollTimer: null as ReturnType<typeof setTimeout> | null,
      pollTimerTier: null,
      lastForegroundAgent: null,
      hasAgentRunEvidence: true,
      consecutiveInspectionErrors: 0,
      lastPaneActivityAt: null
    }
    const scheduler = createAgentCompletionPollScheduler({
      options: {
        ...coordinatorOptions(),
        isRemotePtyId: () => true
      } as never,
      state: state as never,
      pendingTitle: { get: () => null } as never,
      requestInspection: () => undefined
    })
    expect(scheduler.shouldRunCadenceInspection()).toBe(false)
    scheduler.scheduleNextPoll()
    expect(state.pollTimer).toBeNull()
  })

  it('records title activity and names the agent in the title', () => {
    let activity = 0
    let last: string | null = null
    const held: string[] = []
    const observer = createAgentCompletionTitleObserver({
      getLastStatus: () => last as never,
      setLastStatus: (status) => {
        last = status
      },
      hasAgentEvidence: () => false,
      establishAgentEvidence: () => undefined,
      recordPaneActivity: () => {
        activity += 1
      },
      recordTitleWorking: () => true,
      holdTitleCompletionPending: (title) => {
        held.push(title)
      },
      hasPendingTitle: () => false,
      dropPendingTitle: () => undefined,
      markTitleCompletionNotified: () => undefined,
      dispatchTitleCompletion: () => undefined
    })
    expect(observer.titleCompletionAgentIdentity('Claude Code')).toBe('claude')
    observer.observeTitle('plain shell')
    expect(activity).toBe(1)
  })

  it('suppresses a waiting hook before it establishes agent evidence', () => {
    let evidence = 0
    let cleared = 0
    const observer = createAgentCompletionHookObserver({
      options: { shouldSuppressHookCompletion: () => true } as never,
      state: {
        workingStatusObserved: false,
        requiresFreshWorking: false,
        currentTurn: 0,
        lastCompletionIdentity: null,
        lastAttentionToken: null,
        lastCompletionSource: null,
        lastCompletedTurn: null,
        lastCompletionAt: 0,
        pendingHookDoneTimer: null
      },
      establishAgentEvidence: () => {
        evidence += 1
      },
      recordPaneActivity: () => undefined,
      clearPendingHookDone: () => {
        cleared += 1
      },
      clearPendingCodexAttention: () => undefined,
      dispatchAttention: () => undefined,
      dispatchCompletion: () => false,
      scheduleHookDoneCompletion: () => undefined,
      doneShouldUseQuietWindow: () => false,
      hookCompletionIdentity: () => null,
      hookCompletionAgentIdentity: () => null,
      completionIdentityFor: () => '',
      openStampedTail: () => false,
      rememberHandledTurnCompletedAt: () => undefined,
      turnCompletedAtAlreadyHandled: () => false,
      consumePendingStampedTailForAgent: () => false,
      consumeStampedTailForCurrentCoordinator: () => undefined,
      clearOriginStampedTail: () => undefined,
      recordWorkingBoundary: () => undefined,
      dropPendingTitle: () => undefined
    })
    observer.observeHookStatus({ state: 'waiting', agentType: 'codex' } as never)
    expect(cleared).toBe(1)
    expect(evidence).toBe(0)
  })

  it('builds a completion identity and refuses a completion while the pane is not live', () => {
    const state = {
      currentTurn: 1,
      workingStatusObserved: true,
      requiresFreshWorking: false,
      lastCompletionToken: null,
      lastCompletionAt: 0,
      lastCompletedTurn: null,
      lastCompletionSource: null,
      lastCompletionIdentity: null,
      lastAttentionToken: null,
      pendingHookDoneTimer: null,
      pendingHookDoneTitle: null,
      pendingHookDonePayload: null,
      pendingCodexAttentionTimer: null
    }
    const controller = createAgentCompletionNotificationController({
      options: coordinatorOptions(false) as never,
      state,
      processState: {
        processSession: 2,
        lastForegroundAgent: null,
        hasAgentRunEvidence: true
      },
      identityScope: {} as never
    })
    expect(controller.completionIdentityFor('done', 'codex', 9.8)).toBe('done:codex:9')
    expect(controller.doneShouldUseQuietWindow({ state: 'done', agentType: 'codex' } as never)).toBe(true)
    expect(controller.dispatchCompletion('title', 'Codex done')).toBe(false)
    ;(state as { pendingHookDoneTimer: ReturnType<typeof setTimeout> | null }).pendingHookDoneTimer =
      setTimeout(() => undefined, 1_000)
    controller.clearPendingHookDone()
    expect(controller.hasPendingHookDone()).toBe(false)
  })

  it('starts process tracking without arming a poll when the pty id is missing', () => {
    const state = {
      disposed: false,
      pollTrackingStarted: false,
      pollTimer: null,
      pollTimerTier: null,
      lastForegroundAgent: null,
      hasAgentRunEvidence: false,
      consecutiveInspectionErrors: 0,
      lastPaneActivityAt: null,
      inspectionGeneration: 0
    }
    const monitor = createAgentCompletionProcessMonitor({
      options: { ...coordinatorOptions(), getPtyId: () => null } as never,
      state: state as never,
      identityScope: {} as never,
      pendingTitle: { get: () => null, finishInspection: () => undefined } as never,
      establishAgentEvidence: () => undefined,
      clearAgentRunEvidence: () => undefined,
      hasPendingHookDone: () => false,
      hasPendingCodexAttention: () => false,
      dispatchCompletion: () => false
    })
    monitor.start()
    expect(state.pollTrackingStarted).toBe(true)
    expect(state.pollTimer).toBeNull()
  })

  it('records output activity on the coordinator and disposes cleanly', () => {
    const coordinator = createAgentCompletionCoordinator(coordinatorOptions() as never)
    coordinator.observeOutputActivity()
    coordinator.dispose()
    expect(coordinator.hasPendingHookDoneCompletion()).toBe(false)
  })

  it('refuses a fork when the pane has no scrollback and ignores a missing menu pane', async () => {
    let focused = 0
    const pane = {
      id: 4,
      leafId: LEAF,
      terminal: {
        serialize: () => '',
        focus: () => {
          focused += 1
        }
      }
    }
    expect(prepareAgentSessionForkFromPane({
      pane: pane as never,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: null
    })).toBeNull()
    expect(focused).toBe(1)
    const forks: unknown[] = []
    await forkAgentSessionFromMenuPane({
      paneCwdRef: { current: new Map() },
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: null,
      fallbackCwd: '/repo',
      onAgentSessionForkReady: (fork) => {
        forks.push(fork)
      },
      onAgentSessionContinuationReady: () => undefined
    }, null)
    expect(forks).toEqual([])
    continueAgentSessionFromMenuPane({
      paneCwdRef: { current: new Map() },
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: null,
      fallbackCwd: '/repo',
      onAgentSessionForkReady: () => undefined,
      onAgentSessionContinuationReady: () => undefined
    }, null)
  })
})
