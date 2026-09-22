import { describe, expect, it } from 'vitest'
import { isAgentProcessInspectionCostly } from '../../components/terminal-pane/agent-process-inspection-cost'
import {
  isAgentTaskCompleteOsNotificationEnabledFromState
} from '../../components/terminal-pane/agent-task-complete-policy'
import {
  isHardWrappedPathFragment,
  isIncompleteHardWrappedPathStart
} from '../../components/terminal-pane/hard-wrapped-terminal-path-fragments'
import { paneIsCoveredByNativeChat } from '../../components/terminal-pane/native-chat-covered-pane'
import { clampUtf8Tail } from '../../components/terminal-pane/pty-eager-buffer-clamp'
import {
  createHeadQueue,
  shiftHeadQueue
} from '../../components/terminal-pane/pty-input-write-head-queue'
import { getTerminalInternalFileDropRejectionMessage } from '../../components/terminal-pane/terminal-drop-internal-rejection-message'
import { captureTerminalDropTarget } from '../../components/terminal-pane/terminal-drop-target'
import { joinRuntimeTerminalDropDir } from '../../components/terminal-pane/terminal-drop-worktree-path'
import { collectLeafIds, pruneLeaves } from '../../components/terminal-pane/terminal-pane-layout-tree'
import { createCaptureId } from '../../components/terminal-pane/terminal-render-desync-evidence-persistence'
import { createTerminalTabActivationOrder } from '../../components/terminal-pane/terminal-tab-activation-order'
import { createUnresolvedOwnerPtyTransport } from '../../components/terminal-pane/unresolved-owner-pty-transport'

describe('ghostty pane chrome modules', () => {
  it('keeps costly process inspection off the local macOS cadence', () => {
    expect(isAgentProcessInspectionCostly('Macintosh', 'pty-local')).toBe(false)
    expect(isAgentProcessInspectionCostly('Windows NT', 'pty-local')).toBe(true)
  })

  it('turns completion notifications off when the setting is off', () => {
    expect(
      isAgentTaskCompleteOsNotificationEnabledFromState({
        settings: {
          notifications: { enabled: true, agentTaskComplete: false },
          experimentalTerminalAttention: false
        }
      })
    ).toBe(false)
  })

  it('joins a hard-wrapped path and rejects a sentence', () => {
    expect(isHardWrappedPathFragment('src/main/index.ts')).toBe(true)
    expect(isHardWrappedPathFragment('not a path')).toBe(false)
    expect(isIncompleteHardWrappedPathStart('/')).toBe(true)
  })

  it('covers only the pane that contains the native chat shell', () => {
    expect(paneIsCoveredByNativeChat({ container: { querySelector: () => null } })).toBe(false)
    expect(
      paneIsCoveredByNativeChat({
        container: {
          querySelector: (selector) => (selector.includes('native-chat-pane-shell') ? {} : null)
        }
      })
    ).toBe(true)
  })

  it('keeps a trailing é inside the byte cap', () => {
    expect(clampUtf8Tail('aé', 2)).toEqual({ data: 'é', bytes: 2 })
    expect(clampUtf8Tail('aé', 1)).toEqual({ data: '', bytes: 0 })
  })

  it('shifts the first queued PTY write', () => {
    const queue = createHeadQueue()
    const first = { text: 'a', reply: null }
    const second = { text: 'b', reply: null }
    queue.items.push(first as never, second as never)
    expect(shiftHeadQueue(queue)).toBe(first)
    expect(shiftHeadQueue(queue)).toBe(second)
    expect(queue.head).toBe(0)
  })

  it('names an oversized internal drop', () => {
    expect(getTerminalInternalFileDropRejectionMessage('too-many-paths')).toContain('too many paths')
  })

  it('captures the drop target pty and stores drops under the worktree', () => {
    const transport = {
      getPtyId: () => 'pty-9',
      isConnected: () => true
    }
    expect(
      captureTerminalDropTarget({ id: 4, leafId: 'leaf-4' }, transport as never)
    ).toMatchObject({ paneId: 4, leafId: 'leaf-4', ptyId: 'pty-9' })
    expect(joinRuntimeTerminalDropDir('/repo')).toBe('/repo/.orca/drops')
  })

  it('collects split leaves and drops a pruned leaf', () => {
    const tree = {
      type: 'split' as const,
      first: { type: 'leaf' as const, leafId: 'a' },
      second: { type: 'leaf' as const, leafId: 'b' }
    }
    expect(collectLeafIds(tree).sort()).toEqual(['a', 'b'])
    const pruned = pruneLeaves(tree, new Map([['b', 'a']]), new Set())
    expect(pruned && 'leafId' in pruned ? pruned.leafId : null).toBe('a')
  })

  it('orders tabs by activation and drops a closed tab', () => {
    const order = createTerminalTabActivationOrder()
    order.recordActiveTabId('tab-a')
    order.recordActiveTabId('tab-b')
    expect(order.getActivationSeq('tab-a')).toBe(0)
    expect(order.getActivationSeq('tab-b')).toBe(1)
    order.retainTabIds(new Set(['tab-b']))
    expect(order.getActivationSeq('tab-a')).toBeUndefined()
  })

  it('builds a capture id and an unconnected owner transport', () => {
    expect(createCaptureId('pane/1')).toContain('pane-1')
    const errors: string[] = []
    const transport = createUnresolvedOwnerPtyTransport('owner missing')
    expect(transport.isConnected()).toBe(false)
    expect(transport.getPtyId()).toBeNull()
    transport.connect({ callbacks: { onError: (message) => errors.push(message) } } as never)
    expect(errors).toEqual(['owner missing'])
  })
})
