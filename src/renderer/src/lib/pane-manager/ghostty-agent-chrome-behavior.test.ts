// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { handleAgentCompletionInspectionResult } from '../../components/terminal-pane/agent-completion-inspection-result'
import {
  createAgentCompletionIdentityScope,
  getAgentCompletionIdentityStoreSizeForTest,
  resetAgentCompletionIdentityStoreForTest
} from '../../components/terminal-pane/agent-completion-identity-store'
import {
  NO_EVIDENCE_ACTIVITY_HOT_WINDOW_MS,
  POLL_TIER_INTERVAL_MS
} from '../../components/terminal-pane/agent-completion-poll-cadence'
import { nextCadenceInspectionDelayMs } from '../../components/terminal-pane/agent-completion-poll-interval'
import { resolvePaneAgentSessionId } from '../../components/terminal-pane/pane-agent-session-id'
import { canContinueAgentSessionInNewSession } from '../../components/terminal-pane/terminal-agent-session-continuation'
import { getForkAgentLaunchPlatform } from '../../components/terminal-pane/terminal-agent-session-fork-launch-platform'
import { sendTerminalQuickCommandToPane } from '../../components/terminal-pane/terminal-quick-command-dispatch'

describe('ghostty agent chrome behavior', () => {
  it('keeps an idle poll on its tier and jitters a retry', () => {
    expect(POLL_TIER_INTERVAL_MS.active).toBe(750)
    expect(POLL_TIER_INTERVAL_MS['no-evidence']).toBe(15_000)
    expect(NO_EVIDENCE_ACTIVITY_HOT_WINDOW_MS).toBe(10_000)
    expect(nextCadenceInspectionDelayMs({
      baseMs: 0,
      hasConsecutiveErrors: false,
      alignToSharedGrid: true,
      now: 0
    })).toBe(0)
    expect(nextCadenceInspectionDelayMs({
      baseMs: 1_000,
      hasConsecutiveErrors: true,
      alignToSharedGrid: true,
      now: 0,
      random: () => 0.5
    })).toBe(1_000)
    expect(nextCadenceInspectionDelayMs({
      baseMs: 1_000,
      hasConsecutiveErrors: false,
      alignToSharedGrid: true,
      now: 100
    })).toBe(900)
  })

  it('reads a live provider session and drops it when the shell is in front', () => {
    expect(resolvePaneAgentSessionId({
      agentStatusByPaneKey: {
        'pane-1': { providerSession: { id: 'sess-é' }, restoredUnconfirmed: false } as never
      },
      sleepingAgentSessionsByPaneKey: {},
      paneForegroundAgentByPaneKey: {}
    }, 'pane-1')).toBe('sess-é')
    expect(resolvePaneAgentSessionId({
      agentStatusByPaneKey: {
        'pane-1': { providerSession: { id: 'sess-é' } } as never
      },
      sleepingAgentSessionsByPaneKey: {},
      paneForegroundAgentByPaneKey: { 'pane-1': { shellForeground: true } as never }
    }, 'pane-1')).toBeNull()
    expect(resolvePaneAgentSessionId({
      agentStatusByPaneKey: {},
      sleepingAgentSessionsByPaneKey: {
        'pane-1': { providerSession: { id: 'sleep-1' } } as never
      },
      paneForegroundAgentByPaneKey: {}
    }, 'pane-1')).toBe('sleep-1')
  })

  it('launches a fork on Linux for WSL and SSH, and continues only a TUI agent', () => {
    expect(getForkAgentLaunchPlatform({
      repo: null,
      projectRuntime: { status: 'resolved', runtime: { kind: 'wsl' } } as never
    })).toBe('linux')
    expect(getForkAgentLaunchPlatform({ repo: { connectionId: 'ssh-1' } })).toBe('linux')
    expect(getForkAgentLaunchPlatform({ repo: null })).toBeUndefined()
    expect(canContinueAgentSessionInNewSession('codex')).toBe(true)
    expect(canContinueAgentSessionInNewSession('zsh')).toBe(false)
  })

  it('refuses an agent quick command and sends a shell command to the pty', () => {
    const sent: string[] = []
    expect(sendTerminalQuickCommandToPane({
      command: { id: 'agent', label: 'Agent', action: 'agent-prompt', agent: 'codex', prompt: 'hi' } as never,
      pane: { leafId: 'leaf-a', terminal: { focus: () => undefined } },
      tabId: 'tab-1',
      transport: { sendInput: (data) => { sent.push(data); return true } }
    })).toBe(false)
    expect(sendTerminalQuickCommandToPane({
      command: { id: 'echo', label: 'Echo', action: 'terminal-command', command: 'echo é', appendEnter: true } as never,
      pane: { leafId: 'leaf-a', terminal: { focus: () => undefined } },
      tabId: 'tab-1',
      transport: null
    })).toBe(false)
    expect(sendTerminalQuickCommandToPane({
      command: { id: 'echo', label: 'Echo', action: 'terminal-command', command: 'echo é', appendEnter: true } as never,
      pane: { leafId: 'leaf-a', terminal: { focus: () => undefined } },
      tabId: 'tab-1',
      transport: { sendInput: (data) => { sent.push(data); return true } }
    })).toBe(true)
    expect(sent.join('')).toContain('echo é')
  })

  it('remembers one completion identity and drops an unverifiable inspection', () => {
    resetAgentCompletionIdentityStoreForTest()
    const scope = createAgentCompletionIdentityScope('pane-1', 'hook')
    scope.setLast({ source: 'hook', identity: 'turn-1', agentIdentity: 'codex' })
    expect(scope.getLast()?.identity).toBe('turn-1')
    expect(scope.turnCompletedAtAlreadyHandled(9)).toBe(false)
    scope.rememberTurnCompletedAt(9)
    expect(scope.turnCompletedAtAlreadyHandled(9)).toBe(true)
    const state = { pendingProcessExitAgent: 'codex', consecutiveInspectionErrors: 0 }
    let scheduled = 0
    expect(handleAgentCompletionInspectionResult({
      result: { childProcessEvidence: 'unverifiable' } as never,
      requestStartedAtMonotonic: 1,
      options: { getPtyId: () => 'pty-1', isRemotePtyId: () => false } as never,
      state: state as never,
      identityScope: scope,
      clearAgentRunEvidence: () => undefined,
      hasPendingHookDone: () => false,
      hasPendingCodexAttention: () => false,
      scheduleNextPoll: () => {
        scheduled += 1
      },
      handleRecognizedProcess: () => undefined,
      dispatchCompletion: () => false,
      remoteInspection: {
        authorityGeneration: null,
        observationEpoch: 0,
        bindingKey: null,
        knownAuthorityGenerations: new Set()
      }
    })).toBe(false)
    expect(scheduled).toBe(1)
    expect(state.consecutiveInspectionErrors).toBe(1)
    expect(state.pendingProcessExitAgent).toBeNull()
    scope.dispose(false)
    resetAgentCompletionIdentityStoreForTest()
    expect(getAgentCompletionIdentityStoreSizeForTest()).toBe(0)
  })
})
