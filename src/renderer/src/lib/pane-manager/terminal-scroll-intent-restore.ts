import { isTerminalScrollIntentRebuildInFlight } from './terminal-scroll-intent-rebuild'
import {
  captureTerminalStructuralScrollIntent,
  readStoredIntent,
  writeIntent,
  writeIntentSnapshot,
  type TerminalScrollIntentEnforceOptions,
  type TerminalScrollIntentTarget,
  type TerminalStructuralScrollIntentSnapshot
} from './terminal-scroll-intent'
import {
  clampTerminalViewportY,
  isTerminalViewportAtBottom,
  readTerminalScrollBufferSnapshot,
  safeTerminalScrollCall
} from './terminal-scroll-buffer-snapshot'

export function isTerminalStructuralScrollIntentCurrent(
  terminal: TerminalScrollIntentTarget,
  snapshot: TerminalStructuralScrollIntentSnapshot | null
): boolean {
  if (!snapshot) {
    return false
  }
  return (readStoredIntent(terminal)?.revision ?? 0) === snapshot.revision
}

export function restoreTerminalStructuralScrollIntent(
  terminal: TerminalScrollIntentTarget,
  snapshot: TerminalStructuralScrollIntentSnapshot | null,
  options: TerminalScrollIntentEnforceOptions = {}
): void {
  if (
    !snapshot ||
    !isTerminalStructuralScrollIntentCurrent(terminal, snapshot) ||
    isTerminalScrollIntentRebuildInFlight(terminal)
  ) {
    return
  }
  const current = readTerminalScrollBufferSnapshot(terminal)
  if (!current || current.bufferType !== snapshot.bufferType) {
    return
  }
  if (snapshot.kind === 'followOutput') {
    if (safeTerminalScrollCall(() => terminal.scrollToBottom?.())) {
      writeIntent(terminal, 'followOutput')
    }
    return
  }
  const requestedY =
    options.restoreBy === 'bottomOffset'
      ? current.baseY - Math.max(0, snapshot.baseY - snapshot.viewportY)
      : snapshot.viewportY
  const targetY = clampTerminalViewportY(requestedY, current.baseY)
  if (current.viewportY !== targetY) {
    if (!safeTerminalScrollCall(() => terminal.scrollToLine?.(targetY))) {
      writeIntentSnapshot(terminal, 'pinnedViewport', {
        bufferType: current.bufferType,
        viewportY: targetY,
        baseY: current.baseY
      })
      return
    }
  }
  const existing = readStoredIntent(terminal)
  if (existing?.kind === 'pinnedViewport' && current.baseY < existing.baseY) {
    return
  }
  writeIntent(terminal, 'pinnedViewport')
}

export function enforceTerminalCurrentScrollIntent(terminal: TerminalScrollIntentTarget): void {
  if (isTerminalScrollIntentRebuildInFlight(terminal)) {
    return
  }
  const existing = readStoredIntent(terminal)
  if (!existing) {
    restoreTerminalStructuralScrollIntent(terminal, captureTerminalStructuralScrollIntent(terminal))
    return
  }
  const snapshot = {
    kind: existing.kind,
    bufferType: existing.bufferType,
    viewportY: existing.viewportY,
    baseY: existing.baseY,
    revision: existing.revision
  }
  if (
    snapshot.kind === 'pinnedViewport' &&
    isTerminalViewportAtBottom(snapshot.viewportY, snapshot.baseY)
  ) {
    snapshot.kind = 'followOutput'
  }
  const current = readTerminalScrollBufferSnapshot(terminal)
  const restoreBy =
    snapshot.kind === 'pinnedViewport' && current && current.baseY < snapshot.baseY
      ? 'bottomOffset'
      : 'viewportLine'
  restoreTerminalStructuralScrollIntent(terminal, snapshot, { restoreBy })
}
