import type { SubprocessHandle } from '../daemon/session-subprocess-handle'
import type { IPtyProvider } from '../providers/types'
import type { PtyDataEvent } from '../providers/pty-provider-events'

export type HorcaPtyExactWriter = {
  write(id: string, data: string): boolean | void
  writeExact?(id: string, data: Buffer): boolean | void
  resize(id: string, cols: number, rows: number): void
  onData(callback: (payload: PtyDataEvent) => void): () => void
  onExit?(
    callback: (payload: { id: string; code: number }) => void
  ): () => void
}

const registered = new Map<string, SubprocessHandle>()
const adapters = new Map<string, SubprocessHandle>()
let resolveProvider: ((sessionId: string) => HorcaPtyExactWriter | null) | null = null

export function setHorcaPtyProviderLookup(
  lookup: ((sessionId: string) => HorcaPtyExactWriter | null) | null
): void {
  resolveProvider = lookup
}

export function registerHorcaPtyHandle(sessionId: string, handle: SubprocessHandle): void {
  registered.set(sessionId, handle)
}

export function unregisterHorcaPtyHandle(sessionId: string): void {
  registered.delete(sessionId)
  adapters.delete(sessionId)
}

export function createHorcaPtyHandleAdapter(
  sessionId: string,
  provider: HorcaPtyExactWriter
): SubprocessHandle {
  const dataListeners = new Set<(data: string) => void>()
  const exitListeners = new Set<(code: number) => void>()
  const unsubData = provider.onData((payload) => {
    if (payload.id !== sessionId) {
      return
    }
    for (const listener of dataListeners) {
      listener(payload.data)
    }
  })
  const unsubExit = provider.onExit?.((payload) => {
    if (payload.id !== sessionId) {
      return
    }
    for (const listener of exitListeners) {
      listener(payload.code)
    }
  })
  return {
    pid: 0,
    getForegroundProcess: () => null,
    write: (data: string | Buffer) => {
      if (Buffer.isBuffer(data)) {
        if (typeof provider.writeExact !== 'function') {
          throw new Error(`Horca PTY "${sessionId}" has no Buffer writeExact path`)
        }
        provider.writeExact(sessionId, data)
        return
      }
      provider.write(sessionId, data)
    },
    resize: (cols, rows) => {
      provider.resize(sessionId, cols, rows)
    },
    kill: () => undefined,
    forceKill: () => undefined,
    terminateOwnedTree: () => ({ kind: 'unavailable' as const }),
    signal: () => undefined,
    onData: (cb) => {
      dataListeners.add(cb)
    },
    onExit: (cb) => {
      exitListeners.add(cb)
    },
    dispose: () => {
      dataListeners.clear()
      exitListeners.clear()
      unsubData()
      unsubExit?.()
    }
  }
}

export function lookupHorcaPtyHandle(sessionId: string): SubprocessHandle | null {
  const live = registered.get(sessionId)
  if (live) {
    return live
  }
  const existing = adapters.get(sessionId)
  if (existing) {
    return existing
  }
  const provider = resolveProvider?.(sessionId) ?? null
  if (!provider) {
    return null
  }
  const adapter = createHorcaPtyHandleAdapter(sessionId, provider)
  adapters.set(sessionId, adapter)
  return adapter
}

export function clearHorcaPtyHandleRegistry(): void {
  registered.clear()
  for (const adapter of adapters.values()) {
    adapter.dispose()
  }
  adapters.clear()
}
