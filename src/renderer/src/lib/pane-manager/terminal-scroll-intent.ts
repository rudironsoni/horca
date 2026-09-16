import {
  addTerminalFollowOutputWaiter,
  notifyTerminalFollowOutputWaiters
} from './terminal-follow-output-waiters'
import { isTerminalScrollIntentRebuildInFlight } from './terminal-scroll-intent-rebuild'
import {
  readKeyedTerminalScrollIntent,
  readKeyedTerminalScrollIntentBinding,
  writeKeyedTerminalScrollIntent,
  writeKeyedTerminalScrollIntentBinding,
  type TerminalScrollIntent,
  type TerminalScrollIntentKey,
  type TerminalScrollIntentKind
} from './terminal-scroll-intent-key-store'
import {
  isTerminalViewportAtBottom,
  readTerminalScrollBufferSnapshot,
  type TerminalScrollBufferType
} from './terminal-scroll-buffer-snapshot'

export type TerminalScrollIntentTarget = {
  isAlternateScreen?: boolean
  viewportY?: number
  baseY?: number
  buffer?: { active?: { viewportY?: number; baseY?: number; type?: string } }
  scrollToBottom?: () => void
  scrollToLine?: (line: number) => void
}

export type TerminalStructuralScrollIntentSnapshot = {
  kind: TerminalScrollIntentKind
  bufferType: TerminalScrollBufferType
  viewportY: number
  baseY: number
  revision: number
}

export type TerminalScrollIntentEnforceOptions = {
  restoreBy?: 'viewportLine' | 'bottomOffset'
}

const terminalScrollIntentByTerminal = new WeakMap<
  TerminalScrollIntentTarget,
  TerminalScrollIntent
>()
const terminalScrollIntentKeyByTerminal = new WeakMap<
  TerminalScrollIntentTarget,
  TerminalScrollIntentKey
>()
const terminalScrollIntentKeyBindingByTerminal = new WeakMap<TerminalScrollIntentTarget, number>()

let nextTerminalScrollIntentRevision = 1
let nextTerminalScrollIntentKeyBinding = 1

/** Runs `listener` once the terminal's intent next becomes follow-output; returns a canceller. Fires immediately when already following. */
export function onTerminalScrollIntentFollowOutput(
  terminal: TerminalScrollIntentTarget,
  listener: () => void
): () => void {
  if (getTerminalScrollIntentKind(terminal) === 'followOutput') {
    listener()
    return () => {}
  }
  return addTerminalFollowOutputWaiter(terminal, listener)
}

export function writeIntent(
  terminal: TerminalScrollIntentTarget,
  kind: TerminalScrollIntentKind
): TerminalScrollIntent | null {
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) {
    return null
  }
  return writeIntentSnapshot(terminal, kind, snapshot)
}

export function writeIntentSnapshot(
  terminal: TerminalScrollIntentTarget,
  kind: TerminalScrollIntentKind,
  snapshot: { bufferType: TerminalScrollBufferType; viewportY: number; baseY: number }
): TerminalScrollIntent {
  const intent = { kind, ...snapshot, revision: nextTerminalScrollIntentRevision }
  nextTerminalScrollIntentRevision += 1
  terminalScrollIntentByTerminal.set(terminal, intent)
  const key = terminalScrollIntentKeyByTerminal.get(terminal)
  if (key) {
    writeKeyedTerminalScrollIntent(key, intent)
  }
  if (kind === 'followOutput') {
    notifyTerminalFollowOutputWaiters(terminal)
  }
  return intent
}

export function readStoredIntent(
  terminal: TerminalScrollIntentTarget
): TerminalScrollIntent | undefined {
  const terminalIntent = terminalScrollIntentByTerminal.get(terminal)
  if (terminalIntent) {
    return terminalIntent
  }
  const key = terminalScrollIntentKeyByTerminal.get(terminal)
  return key ? readKeyedTerminalScrollIntent(key) : undefined
}

export function bindTerminalScrollIntentKey(
  terminal: TerminalScrollIntentTarget,
  key: TerminalScrollIntentKey | undefined
): TerminalScrollIntent | undefined {
  if (!key) {
    return terminalScrollIntentByTerminal.get(terminal)
  }
  terminalScrollIntentKeyByTerminal.set(terminal, key)
  const binding = nextTerminalScrollIntentKeyBinding
  nextTerminalScrollIntentKeyBinding += 1
  terminalScrollIntentKeyBindingByTerminal.set(terminal, binding)
  writeKeyedTerminalScrollIntentBinding(key, binding)
  const existing = readKeyedTerminalScrollIntent(key)
  if (existing) {
    terminalScrollIntentByTerminal.set(terminal, existing)
  }
  return existing
}

export function isTerminalScrollIntentKeyBindingCurrent(
  terminal: TerminalScrollIntentTarget
): boolean {
  const key = terminalScrollIntentKeyByTerminal.get(terminal)
  if (!key) {
    return true
  }
  return (
    terminalScrollIntentKeyBindingByTerminal.get(terminal) ===
    readKeyedTerminalScrollIntentBinding(key)
  )
}

export function markTerminalFollowOutput(terminal: TerminalScrollIntentTarget): void {
  writeIntent(terminal, 'followOutput')
}

export function markTerminalPinnedViewport(terminal: TerminalScrollIntentTarget): void {
  writeIntent(terminal, 'pinnedViewport')
}

export function syncTerminalScrollIntentFromViewport(
  terminal: TerminalScrollIntentTarget,
  options: { allowBufferShrink?: boolean; preservePinnedAtBottom?: boolean } = {}
): void {
  if (isTerminalScrollIntentRebuildInFlight(terminal)) {
    return
  }
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) {
    return
  }
  const existing = readStoredIntent(terminal)
  // scrollback. That transient state must not erase a durable pinned viewport.
  if (
    !options.allowBufferShrink &&
    existing?.kind === 'pinnedViewport' &&
    snapshot.baseY < existing.baseY
  ) {
    terminalScrollIntentByTerminal.set(terminal, existing)
    return
  }
  if (
    options.preservePinnedAtBottom &&
    existing?.kind === 'pinnedViewport' &&
    isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
  ) {
    return
  }
  const kind = isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
    ? 'followOutput'
    : 'pinnedViewport'
  // no intent change. Avoid manufacturing revisions that can cancel a valid
  // structural restore or amplify terminal-output bursts.
  if (
    existing?.kind === kind &&
    existing.bufferType === snapshot.bufferType &&
    (kind === 'followOutput' || existing.viewportY === snapshot.viewportY)
  ) {
    if (kind === 'pinnedViewport' && existing.baseY !== snapshot.baseY) {
      // Refresh geometry without creating a user-intent revision so a later
      // keyed remount restores the same content, not the stale bottom offset.
      Object.assign(existing, snapshot)
    }
    return
  }
  writeIntent(terminal, kind)
}

export function getTerminalScrollIntentKind(
  terminal: TerminalScrollIntentTarget
): TerminalScrollIntentKind {
  const existing = readStoredIntent(terminal)
  if (existing) {
    return existing.kind
  }
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) {
    return 'followOutput'
  }
  return isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
    ? 'followOutput'
    : 'pinnedViewport'
}

export function captureTerminalStructuralScrollIntent(
  terminal: TerminalScrollIntentTarget
): TerminalStructuralScrollIntentSnapshot | null {
  if (isTerminalScrollIntentRebuildInFlight(terminal)) {
    return null
  }
  const snapshot = readTerminalScrollBufferSnapshot(terminal)
  if (!snapshot) {
    return null
  }
  const existing = readStoredIntent(terminal)
  let kind =
    existing?.kind ??
    (isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
      ? 'followOutput'
      : 'pinnedViewport')
  // phantom pin (the user's scroll never detached the viewport). Restoring it
  // after a structural operation would freeze the terminal at a stale line.
  // Only trust the at-bottom reading when the scrollback is at least as long
  // as the pin's — a shorter one is a cleared buffer awaiting replay.
  if (
    kind === 'pinnedViewport' &&
    isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY) &&
    (!existing || snapshot.baseY >= existing.baseY)
  ) {
    kind = 'followOutput'
  }
  // pre-remount coordinates or a bottom-offset restore silently loses the pin.
  const capturedCoordinates =
    existing?.kind === 'pinnedViewport' && snapshot.baseY < existing.baseY ? existing : snapshot
  return {
    ...capturedCoordinates,
    kind,
    revision: existing?.revision ?? 0
  }
}

export {
  enforceTerminalCurrentScrollIntent,
  isTerminalStructuralScrollIntentCurrent,
  restoreTerminalStructuralScrollIntent
} from './terminal-scroll-intent-restore'
