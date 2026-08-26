import type { IPtyProvider, PtyDataEvent } from '../../types'
import {
  bytesFromTerminalLogicalKey,
  type TerminalLogicalInput
} from '../../../../shared/terminal-logical-key'

export function isOrcaFallbackId(
  bindings: { has(id: string): boolean },
  id: string,
  fallback: IPtyProvider | undefined
): fallback is IPtyProvider {
  return !bindings.has(id) && !id.startsWith('herdr:') && fallback != null
}

export function writeFallbackLogical(
  fallback: IPtyProvider | undefined,
  id: string,
  input: TerminalLogicalInput
): boolean {
  if (!fallback) {
    return false
  }
  if (fallback.writeLogical) {
    return fallback.writeLogical(id, input) !== false
  }
  const data = input.kind === 'bytes' ? input.data : bytesFromTerminalLogicalKey(input.name)
  if (data == null) {
    return false
  }
  fallback.write(id, data)
  return true
}

export function subscribeOrcaFallback(
  fallback: IPtyProvider,
  emitData: (payload: PtyDataEvent) => void,
  emitExit: (payload: { id: string; code: number; incarnationId?: string }) => void,
  emitReplay: (payload: { id: string; data: string }) => void
): () => void {
  const offData = fallback.onData((payload) => emitData(payload))
  const offExit = fallback.onExit((payload) => emitExit(payload))
  const offReplay = fallback.onReplay?.((payload) => emitReplay(payload))
  return () => {
    offData()
    offExit()
    offReplay?.()
  }
}
