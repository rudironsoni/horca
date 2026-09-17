// @ts-nocheck — D0-R implementation fixture; uses xterm-shaped test doubles
import { requireXtermPaneState } from '../../lib/pane-manager/xterm-renderer/xterm-pane-state'
import { attachXtermPaneTestState } from '../../lib/pane-manager/xterm-renderer/xterm-pane-test-harness'
import { registerMockXtermPaneState } from '../../lib/pane-manager/fake-pane-terminal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import { buildAgentSessionContinuationPrompt } from '@/lib/agent-session-continuation'
import { prepareAgentSessionContinuationFromPane } from './terminal-agent-session-continuation'

const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const store = {
  agentStatusByPaneKey: {} as Record<
    string,
    {
      agentType?: string
      prompt?: string
      lastAssistantMessage?: string
      providerSession?: { transcriptPath?: string }
    }
  >,
  tabsByWorktree: {} as Record<string, { id: string; launchAgent?: string | null }[]>
}

vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string) => fallback
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

function makePane(capturedText: string): ManagedPane {
  return attachXtermPaneTestState({
    leafId: LEAF_ID,
    terminal: { focus: vi.fn() },
    serializeAddon: { serialize: vi.fn(() => capturedText) }
  } as unknown as ManagedPane)
}

describe('buildAgentSessionContinuationPrompt', () => {
  it('supports focused and full modes from a saved transcript', () => {
    const source = {
      capturedText: 'unused fallback',
      sourceAgent: 'claude' as const,
      transcriptPath: '/home/u/.claude/projects/repo/session.jsonl',
      lastPrompt: 'finish the auth refactor'
    }

    const focused = buildAgentSessionContinuationPrompt(source, 'focused')
    const full = buildAgentSessionContinuationPrompt(source, 'full')

    expect(focused).toContain('Continue work from the prior Orca session')
    expect(focused).toContain('The prior provider session is read-only context')
    expect(focused).not.toContain('Start a fresh, independent agent session')
    expect(focused).toContain('If the prior task appears complete, say so and wait')
    expect(focused).toContain('Read only the transcript sections needed')
    expect(full).toContain('Read the complete original session transcript')
    expect(full).toContain('/home/u/.claude/projects/repo/session.jsonl')
    expect(full).not.toContain('unused fallback')
  })

  it('falls back to bounded terminal context only in focused mode', () => {
    const source = {
      capturedText: 'User: update settings\nAssistant: editing the form',
      sourceAgent: null
    }

    expect(buildAgentSessionContinuationPrompt(source, 'focused')).toContain(
      'bounded recent terminal capture'
    )
    expect(buildAgentSessionContinuationPrompt(source, 'full')).toBeNull()
  })
})

describe('prepareAgentSessionContinuationFromPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    store.agentStatusByPaneKey = {
      [`tab-1:${LEAF_ID}`]: {
        agentType: 'claude',
        prompt: 'finish the auth refactor',
        lastAssistantMessage: 'The tests still need updating.',
        providerSession: { transcriptPath: '/home/u/.claude/session.jsonl' }
      }
    }
    store.tabsByWorktree = { 'wt-1': [{ id: 'tab-1', launchAgent: 'claude' }] }
  })

  it('prepares a generic request without serializing when a transcript exists', () => {
    const pane = makePane('unused scrollback')
    const request = prepareAgentSessionContinuationFromPane({
      pane,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: 'group-1',
      workspacePath: '/repo/worktree',
      initialCwd: '/repo/worktree/packages/app'
    })

    expect(requireXtermPaneState(pane.terminal).serializeAddon.serialize).not.toHaveBeenCalled()
    expect(request).toMatchObject({
      worktreeId: 'wt-1',
      groupId: 'group-1',
      workspacePath: '/repo/worktree',
      initialCwd: '/repo/worktree/packages/app',
      source: {
        sourceAgent: 'claude',
        transcriptPath: '/home/u/.claude/session.jsonl'
      }
    })
  })

  it('falls back to terminal capture when the provider transcript path is blank', () => {
    store.agentStatusByPaneKey[`tab-1:${LEAF_ID}`]!.providerSession = { transcriptPath: '   ' }
    const pane = makePane('latest terminal context')

    const request = prepareAgentSessionContinuationFromPane({
      pane,
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      groupId: null,
      workspacePath: '/repo/worktree',
      initialCwd: '/repo/worktree'
    })

    expect(requireXtermPaneState(pane.terminal).serializeAddon.serialize).toHaveBeenCalledWith({ scrollback: 800 })
    expect(request?.source).toMatchObject({
      capturedText: 'latest terminal context',
      transcriptPath: null
    })
  })
})
