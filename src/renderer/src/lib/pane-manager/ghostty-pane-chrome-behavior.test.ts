// @vitest-environment happy-dom
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
import { acquirePtyDeliveryInterest } from '../../components/terminal-pane/pty-delivery-interest'
import { deliverPtyExitToHandlers } from '../../components/terminal-pane/pty-exit-delivery'
import { isCoalesciblePtyInput } from '../../components/terminal-pane/pty-input-write-queue-contract'
import { shouldApplyHostSleepPhase } from '../../components/terminal-pane/pty-shutdown-host-generation'
import { isPaneReplaying } from '../../components/terminal-pane/replay-guard'
import { resolveNativeTerminalDropPane } from '../../components/terminal-pane/terminal-drop-pane-resolution'
import { isRendererHiddenPtyDeliveryGateEnabled } from '../../components/terminal-pane/terminal-hidden-delivery-gate'
import { maybePushMode2031Flip } from '../../components/terminal-pane/terminal-mode-2031-replies'
import { resolveTerminalOptionShortcutAction } from '../../components/terminal-pane/terminal-option-shortcut-policy'
import { buildFontFamily, serializePaneTree } from '../../components/terminal-pane/layout-serialization'
import {
  getTerminalPathExistsCacheKey,
  readTerminalPathExistsCache,
  writeTerminalPathExistsCache
} from '../../components/terminal-pane/terminal-path-exists-cache'
import { buildTerminalTabColdParkCandidates } from '../../components/terminal-pane/terminal-tab-park-candidates'
import { parseCssColor } from '../../components/terminal-pane/terminal-view-attributes-publisher'
import { haveSameTerminalTabIds } from '../../components/terminal-pane/use-terminal-park-verdict-pin'
import { resolveTerminalTabStripDropTarget } from '../../components/terminal-pane/terminal-tab-strip-drop-target'
import { GhosttyPaneTerminal } from './ghostty-renderer/ghostty-pane-terminal'
import { readSentinelWeightProbe } from '../../components/terminal-pane/terminal-render-desync-weight-probe'

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

  it('holds PTY delivery interest until the last release', () => {
    const calls: Array<[string, boolean]> = []
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { pty: { setPtyDeliveryInterest: (id: string, on: boolean) => calls.push([id, on]) } }
    })
    const releaseA = acquirePtyDeliveryInterest('pty-hold')
    const releaseB = acquirePtyDeliveryInterest('pty-hold')
    releaseA()
    expect(calls).toEqual([['pty-hold', true]])
    releaseB()
    expect(calls).toEqual([
      ['pty-hold', true],
      ['pty-hold', false]
    ])
  })

  it('delivers a PTY exit to the primary and the sidecar', () => {
    const seen: string[] = []
    deliverPtyExitToHandlers({
      ptyId: 'pty-exit',
      code: 0,
      primary: () => seen.push('primary'),
      sidecars: [() => seen.push('sidecar')]
    })
    expect(seen).toEqual(['primary', 'sidecar'])
  })

  it('refuses to coalesce a query reply', () => {
    expect(
      isCoalesciblePtyInput({
        sequence: 1,
        id: 'pty-1',
        text: 'a',
        replyOnly: true,
        resolveAccepted: undefined,
        tooLarge: false
      })
    ).toBe(false)
  })

  it('drops an older host sleep generation', () => {
    expect(shouldApplyHostSleepPhase('pty-sleep', 2, 'started')).toBe(true)
    expect(shouldApplyHostSleepPhase('pty-sleep', 1, 'committed')).toBe(false)
  })

  it('tracks a pane replay and a native drop pane', () => {
    expect(isPaneReplaying({ current: new Map([[3, 1]]) }, 3)).toBe(true)
    const pane = { id: 3, leafId: '11111111-1111-4111-8111-111111111111', container: document.createElement('div') }
    const manager = {
      getPanes: () => [pane],
      getActivePane: () => null
    }
    expect(resolveNativeTerminalDropPane(manager as never, pane.leafId)).toBe(pane)
  })

  it('sends a mode 2031 reply only when the theme changes', () => {
    const sent: string[] = []
    const transport = {
      isConnected: () => true,
      sendInputImmediate: (data: string) => {
        sent.push(data)
        return true
      }
    }
    const enabled = new Map([[1, true]])
    const last = new Map()
    expect(maybePushMode2031Flip(1, 'dark', transport, enabled, last)).toBe(true)
    expect(sent).toEqual(['\x1b[?997;1n'])
    expect(maybePushMode2031Flip(1, 'dark', transport, enabled, last)).toBe(false)
  })

  it('leaves Option keys to Ghostty when this is not a Mac', () => {
    expect(
      resolveTerminalOptionShortcutAction(
        { key: 'q', altKey: true, metaKey: false, ctrlKey: false, shiftKey: false },
        {
          isMac: false,
          macOptionAsAlt: 'true',
          optionKeyLocations: 1,
          getKittyKeyboardFlags: () => 0
        }
      )
    ).toBeNull()
  })

  it('serializes a Ghostty pane leaf and quotes the preview font once', () => {
    const leafId = '11111111-1111-4111-8111-111111111111'
    const pane = document.createElement('div')
    pane.className = 'pane'
    pane.dataset.leafId = leafId
    expect(serializePaneTree(pane)).toEqual({ type: 'leaf', leafId })
    const family = buildFontFamily('Menlo')
    expect(family.startsWith('"Menlo"')).toBe(true)
    expect(family.split('Menlo').length).toBe(2)
  })

  it('scopes a remote path probe and parses a theme color', () => {
    const key = getTerminalPathExistsCacheKey({
      absolutePath: '/repo',
      isRemoteRuntimePath: true,
      runtimeEnvironmentId: 'runtime-1'
    })
    expect(key).toBe('runtime-1\0/repo')
    const cache = new Map<string, boolean>()
    writeTerminalPathExistsCache(cache, key, true)
    expect(readTerminalPathExistsCache(cache, key)).toBe(true)
    expect(parseCssColor('#fff')).toEqual({ rgb: [255, 255, 255], alpha: 255 })
    expect(haveSameTerminalTabIds(new Set(['a']), new Set(['a']))).toBe(true)
  })

  it('marks a hidden tab as a cold-park candidate', () => {
    const order = createTerminalTabActivationOrder()
    const hiddenSince = new Map<string, number>()
    const [candidate] = buildTerminalTabColdParkCandidates({
      terminalTabs: [{ id: 'tab-h', ptyId: 'pty-h', pendingActivationSpawn: false } as never],
      assignments: new Map(),
      isWorktreeActive: false,
      activeTerminalTabId: null,
      portalTabIds: new Set(),
      shouldMeasureHiddenWorktree: false,
      hiddenSinceByTabId: hiddenSince,
      activationOrder: order,
      nowMs: 50
    })
    expect(candidate.isVisible).toBe(false)
    expect(candidate.hiddenSinceMs).toBe(50)
  })

  it('ignores a tab-strip drop when the worktree has no groups', () => {
    expect(
      resolveTerminalTabStripDropTarget({
        clientX: 1,
        clientY: 1,
        groupsByWorktree: {},
        worktreeId: 'wt'
      })
    ).toBeNull()
  })

  it('turns the hidden delivery gate off when the setting is off', () => {
    expect(isRendererHiddenPtyDeliveryGateEnabled({ terminalHiddenDeliveryGate: false })).toBe(false)
  })

  it('mounts the settings preview on one Ghostty canvas', () => {
    HTMLCanvasElement.prototype.getContext = (() => ({
      measureText: () => ({ width: 8 })
    })) as never
    const root = document.createElement('div')
    document.body.appendChild(root)
    const terminal = new GhosttyPaneTerminal({
      measureRoot: root,
      appearance: {
        fontFamily: buildFontFamily('Menlo'),
        fontSize: 13,
        lineHeight: 1.2
      }
    })
    root.appendChild(terminal.element)
    terminal.resize(80, 24)
    terminal.write('preview\n')
    expect(terminal.element.getAttribute('data-ghostty')).toMatch(/^pane-/)
    expect(root.querySelectorAll('canvas')).toHaveLength(1)
    expect(terminal.cols).toBe(80)
    expect(terminal.rows).toBe(24)
    terminal.dispose()
    expect(terminal.isDisposed).toBe(true)
  })

  it('reads font weight from the pane and not an xterm atlas', () => {
    const probe = readSentinelWeightProbe(
      { options: { fontWeight: '400', fontWeightBold: '700' } },
      null,
      2,
      2
    )
    expect(probe.optionsFontWeight).toBe('400')
    expect(probe.optionsFontWeightBold).toBe('700')
    expect(probe.atlasConfigFontWeight).toBeNull()
    expect(probe.boldTextCells).toBe(0)
  })
})
