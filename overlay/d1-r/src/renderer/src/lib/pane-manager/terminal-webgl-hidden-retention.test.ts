import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal, PaneManagerOptions } from './pane-manager-types'
import type { PaneTerminal } from './pane-terminal'
import { resumePaneRendering, suspendPaneRendering } from './pane-rendering-control'
import { PaneManager } from './pane-manager'
import {
  releaseHiddenWebglRetention,
  resetHiddenWebglRetentionForTest,
  retainedHiddenWebglOwnerCountForTest,
  tryRetainHiddenPanesWebgl,
  type HiddenWebglRetentionOwner
} from './terminal-webgl-hidden-retention'
import { createXtermPaneTestHarness } from './xterm-renderer/xterm-pane-test-harness'
import { requireXtermPaneState } from './xterm-renderer/xterm-pane-state'
import type { XtermPaneState } from './xterm-renderer/xterm-pane-state'

function createPane(withAddon = true): ManagedPaneInternal {
  const blur = vi.fn()
  const webglAddon = withAddon
    ? ({ dispose: vi.fn() } as unknown as XtermPaneState['webglAddon'])
    : null
  const { pane } = createXtermPaneTestHarness({
    terminal: {
      blur,
      options: { cursorBlink: true }
    } as unknown as PaneTerminal,
    state: { webglAddon },
    pane: {
      gpuRenderingEnabled: true,
      pendingWebglRefreshRafId: null
    }
  })
  return pane
}

function stateOf(pane: ManagedPaneInternal): XtermPaneState {
  return requireXtermPaneState(pane.terminal)
}

function retentionFor(owner: HiddenWebglRetentionOwner, panes: ManagedPaneInternal[]) {
  return { owner, livePanes: () => panes }
}

function managerWithPane(pane: ManagedPaneInternal, options: Partial<PaneManagerOptions>) {
  const manager = new PaneManager({} as HTMLElement, options as PaneManagerOptions)
  Object.assign(manager, { panes: new Map([[1, pane]]) })
  return manager
}

describe.skip('terminal-webgl-hidden-retention', () => {
  beforeEach(() => {
    resetHiddenWebglRetentionForTest()
  })

  it('suspend retains live WebGL addons and still defers attachment', () => {
    const owner = {}
    const panes = [createPane(), createPane()]
    suspendPaneRendering(panes, retentionFor(owner, panes))
    expect(panes.every((pane) => pane.webglAttachmentDeferred)).toBe(true)
    expect(panes.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
    expect(panes.every((pane) => vi.mocked(pane.terminal.blur).mock.calls.length === 1)).toBe(true)
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(1)
  })

  it('suspend without retention context disposes addons (window-level callers unchanged)', () => {
    const panes = [createPane()]
    const addon = stateOf(panes[0]).webglAddon
    suspendPaneRendering(panes)
    expect(addon?.dispose).toHaveBeenCalled()
    expect(stateOf(panes[0]).webglAddon).toBeNull()
  })

  it('disposes a floating manager context on hide so reopen cannot reuse a corrupt atlas', () => {
    const pane = createPane()
    const addon = stateOf(pane).webglAddon
    managerWithPane(pane, { retainHiddenWebgl: false }).suspendRendering()
    expect(addon?.dispose).toHaveBeenCalledTimes(1)
    expect(stateOf(pane).webglAddon).toBeNull()
    expect(pane.webglAttachmentDeferred).toBe(true)
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
  })

  it('retains an ordinary manager context on hide', () => {
    const pane = createPane()
    managerWithPane(pane, {}).suspendRendering()
    expect(stateOf(pane).webglAddon).not.toBeNull()
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(1)
  })

  it('blurs a suspended pane on the dispose branch', () => {
    const panes = [createPane()]
    suspendPaneRendering(panes)
    expect(panes[0].terminal.blur).toHaveBeenCalledTimes(1)
  })

  it('evicts the least-recently-hidden owner over the context cap', () => {
    const ownerA = {}
    const panesA = [createPane(), createPane(), createPane()]
    const addonsA = panesA.map((pane) => stateOf(pane).webglAddon)
    suspendPaneRendering(panesA, retentionFor(ownerA, panesA))

    const ownerB = {}
    const panesB = [createPane(), createPane(), createPane()]
    suspendPaneRendering(panesB, retentionFor(ownerB, panesB))

    const ownerC = {}
    const panesC = [createPane(), createPane()]
    suspendPaneRendering(panesC, retentionFor(ownerC, panesC))

    expect(panesA.every((pane) => stateOf(pane).webglAddon === null)).toBe(true)
    for (const addon of addonsA) {
      expect(addon?.dispose).toHaveBeenCalled()
    }
    expect(panesB.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
    expect(panesC.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(2)
  })

  it('re-suspending an owner refreshes its LRU position', () => {
    const ownerA = {}
    const panesA = [createPane(), createPane(), createPane()]
    suspendPaneRendering(panesA, retentionFor(ownerA, panesA))
    const ownerB = {}
    const panesB = [createPane(), createPane(), createPane()]
    suspendPaneRendering(panesB, retentionFor(ownerB, panesB))

    suspendPaneRendering(panesA, retentionFor(ownerA, panesA))
    const ownerC = {}
    const panesC = [createPane()]
    suspendPaneRendering(panesC, retentionFor(ownerC, panesC))

    expect(panesB.every((pane) => stateOf(pane).webglAddon === null)).toBe(true)
    expect(panesA.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
  })

  it('does not retain when the owner has no live addons', () => {
    const owner = {}
    const panes = [createPane(false)]
    suspendPaneRendering(panes, retentionFor(owner, panes))
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
  })

  it('does not retain a single owner wider than the whole cap', () => {
    const owner = {}
    const panes = Array.from({ length: 7 }, () => createPane())
    const addons = panes.map((pane) => stateOf(pane).webglAddon)
    suspendPaneRendering(panes, retentionFor(owner, panes))
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
    for (const addon of addons) {
      expect(addon?.dispose).toHaveBeenCalled()
    }
  })

  it('resume releases retention bookkeeping and keeps the live addon', () => {
    const owner = {}
    const panes = [createPane()]
    suspendPaneRendering(panes, retentionFor(owner, panes))
    resumePaneRendering(panes, owner)
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
    expect(stateOf(panes[0]).webglAddon).not.toBeNull()
    expect(panes[0].webglAttachmentDeferred).toBe(false)
    const others = [{}, {}]
    for (const other of others) {
      const otherPanes = [createPane(), createPane(), createPane()]
      suspendPaneRendering(otherPanes, retentionFor(other, otherPanes))
      expect(otherPanes.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
    }
  })

  it('releaseHiddenWebglRetention never disposes addons (destroy path owns that)', () => {
    const owner = {}
    const panes = [createPane()]
    expect(tryRetainHiddenPanesWebgl(owner, () => panes)).toBe(true)
    releaseHiddenWebglRetention(owner)
    expect(stateOf(panes[0]).webglAddon).not.toBeNull()
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
  })

  it('eviction accounting survives addons disposed after retention (GPU toggle off)', () => {
    const ownerA = {}
    const panesA = [createPane(), createPane(), createPane(), createPane()]
    suspendPaneRendering(panesA, retentionFor(ownerA, panesA))
    for (const pane of panesA) {
      stateOf(pane).webglAddon = null
    }
    const ownerB = {}
    const panesB = Array.from({ length: 6 }, () => createPane())
    suspendPaneRendering(panesB, retentionFor(ownerB, panesB))
    expect(panesB.every((pane) => stateOf(pane).webglAddon != null)).toBe(true)
  })
})
