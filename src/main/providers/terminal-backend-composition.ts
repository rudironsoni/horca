import type { Store } from '../persistence'
import type { SshConnection } from '../ssh/ssh-connection'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import {
  createLocalHerdrPtyProvider,
  createSshHerdrPtyProvider
} from './multiplexer/herdr/herdr-provider-factory'
import type { IPtyProvider } from './types'

export type TerminalBackendPtyProvider = IPtyProvider & {
  dispose: () => void
  replaceFallback: (fallback: IPtyProvider) => void
}

/** Sole production import of the Herdr provider factory. */
export function createLocalBackendPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store
): TerminalBackendPtyProvider {
  return createLocalHerdrPtyProvider(fallback, store)
}

export function createSshBackendPtyProvider(
  fallback: IPtyProvider | undefined,
  store: Store,
  connection: SshConnection,
  targetId: string,
  hostPlatform?: RemoteHostPlatform
): IPtyProvider {
  return createSshHerdrPtyProvider(fallback, store, connection, targetId, hostPlatform)
}
