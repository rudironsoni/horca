import { tryGetProviderForPty } from '../provider/registry'
import {
  deliveredHiddenRendererResizeOutputPtys,
  pendingHiddenRendererResizeOutputPtys,
  ptySizes,
  visibleRendererPtys
} from '../delivery/visibility-state'
import type { PtyIpcSession } from '../session'

export function applyRendererPtyResize(
  session: PtyIpcSession,
  args: { id: string; cols: number; rows: number }
): void {
  const { runtime } = session
  if (runtime?.isResizeSuppressed()) {
    return
  }
  const mobileOwnsResize = runtime?.getDriver(args.id).kind === 'mobile'
  const remoteDesktopOwnsResize = runtime?.isRemoteDesktopResizeDriven?.(args.id) === true
  if (mobileOwnsResize || remoteDesktopOwnsResize) {
    if (remoteDesktopOwnsResize) {
      runtime?.recordRemoteDesktopHostReclaimTarget(args.id, args.cols, args.rows)
    }
    return
  }
  const provider = tryGetProviderForPty(args.id)
  if (!provider) {
    return
  }
  const markedHiddenResizeOutput = session.rendererPtyIsKnownHidden(args.id)
  const currentSize = ptySizes.get(args.id)
  // Why: unique hidden splits measure tiny cells; shrinking starves observe frames.
  if (
    markedHiddenResizeOutput &&
    currentSize &&
    args.cols * args.rows < currentSize.cols * currentSize.rows
  ) {
    return
  }
  if (markedHiddenResizeOutput) {
    pendingHiddenRendererResizeOutputPtys.add(args.id)
    deliveredHiddenRendererResizeOutputPtys.delete(args.id)
  } else if (visibleRendererPtys.has(args.id)) {
    session.clearDeliveredHiddenRendererResizeOutput(args.id)
  }
  try {
    provider.resize(args.id, args.cols, args.rows)
  } catch {
    if (markedHiddenResizeOutput) {
      pendingHiddenRendererResizeOutputPtys.delete(args.id)
    }
    return
  }
  ptySizes.set(args.id, { cols: args.cols, rows: args.rows })
  runtime?.onExternalPtyResize(args.id, args.cols, args.rows)
}
