import { activeRendererPtys, visibleRendererPtys } from '../../../ipc/pty/delivery/visibility-state'
import {
  isHiddenRendererPty,
  shouldDropHiddenRendererPtyData
} from '../../../ipc/pty-hidden-delivery-gate'
import { abortHerdrExclusiveAttaches, readExclusiveHerdrPaneBytes } from './herdr-pty-attach'
import type { HerdrPtyBinding } from './herdr-pty-types'

export const HERDR_PANE_SCROLLBACK_DRAIN_MS = 250
const HERDR_PANE_SCROLLBACK_DRAIN_CHUNK_CHARS = 512 * 1024
const HERDR_PANE_SCROLLBACK_DRAIN_BUDGET_CHARS = 512 * 1024

type HerdrPaneScrollbackDrain = {
  binding: HerdrPtyBinding
  emptyTicks: number
  exclusiveChars: number
  emitData: (payload: { id: string; data: string; sequenceChars: number }) => void
}

const drains: HerdrPaneScrollbackDrain[] = []
let drainIndex = 0
let drainTimer: ReturnType<typeof setTimeout> | undefined
let drainBusy = false
let drainPause = 0

export function pauseHerdrPaneScrollbackDrain(): void {
  drainPause += 1
  abortHerdrExclusiveAttaches()
}

export function resumeHerdrPaneScrollbackDrain(): void {
  drainPause = Math.max(0, drainPause - 1)
  scheduleHerdrPaneScrollbackDrain()
}

export function startHerdrPaneScrollbackDrain(
  binding: HerdrPtyBinding,
  emitData: (payload: { id: string; data: string; sequenceChars: number }) => void
): void {
  if (!binding.transport?.sdk) {
    return
  }
  const drain: HerdrPaneScrollbackDrain = {
    binding,
    emptyTicks: 0,
    exclusiveChars: 0,
    emitData
  }
  drains.push(drain)
  binding.unsubscribe.push(() => {
    const index = drains.indexOf(drain)
    if (index !== -1) {
      drains.splice(index, 1)
    }
    if (drains.length === 0 && drainTimer !== undefined) {
      clearTimeout(drainTimer)
      drainTimer = undefined
    }
  })
  scheduleHerdrPaneScrollbackDrain()
}

function herdrPaneOwnsTypingObserve(binding: HerdrPtyBinding): boolean {
  const typing = visibleRendererPtys.has(binding.id) && activeRendererPtys.has(binding.id)
  if (typing) {
    return true
  }
  return drains.some(
    (candidate) =>
      candidate.binding.paneId === binding.paneId &&
      visibleRendererPtys.has(candidate.binding.id) &&
      activeRendererPtys.has(candidate.binding.id)
  )
}

function scheduleHerdrPaneScrollbackDrain(): void {
  if (drainTimer !== undefined || drainBusy || drainPause > 0 || drains.length === 0) {
    return
  }
  drainTimer = setTimeout(() => {
    drainTimer = undefined
    void tickHerdrPaneScrollbackDrain()
  }, HERDR_PANE_SCROLLBACK_DRAIN_MS)
}

async function tickHerdrPaneScrollbackDrain(): Promise<void> {
  if (drainBusy || drainPause > 0 || drains.length === 0) {
    return
  }
  drainBusy = true
  const drain = drains[drainIndex % drains.length]
  drainIndex += 1
  try {
    if (herdrPaneOwnsTypingObserve(drain.binding)) {
      return
    }
    const hiddenDrop = shouldDropHiddenRendererPtyData(drain.binding.id, null)
    if (!hiddenDrop && isHiddenRendererPty(drain.binding.id)) {
      return
    }
    if (!hiddenDrop && drain.exclusiveChars >= HERDR_PANE_SCROLLBACK_DRAIN_BUDGET_CHARS) {
      return
    }
    const unread = await readExclusiveHerdrPaneBytes(
      drain.binding,
      HERDR_PANE_SCROLLBACK_DRAIN_CHUNK_CHARS
    )
    if (unread.length > 0 && !drain.binding.detached) {
      drain.emptyTicks = 0
      drain.exclusiveChars += unread.length
      drain.binding.sequenceChars += unread.length
      drain.emitData({
        id: drain.binding.id,
        data: unread,
        sequenceChars: drain.binding.sequenceChars
      })
    } else if (!hiddenDrop) {
      drain.emptyTicks += 1
      if (drain.emptyTicks >= 2) {
        const index = drains.indexOf(drain)
        if (index !== -1) {
          drains.splice(index, 1)
        }
      }
    }
  } catch {
    // Loss of contact is unverifiable, not pane death.
  } finally {
    drainBusy = false
    scheduleHerdrPaneScrollbackDrain()
  }
}
