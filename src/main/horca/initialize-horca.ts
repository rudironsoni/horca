import type { Store } from '../persistence'
import { getDaemonProvider } from '../daemon/daemon-init'
import { tryGetProviderForPty } from '../ipc/pty/provider/registry'
import {
  createHorcaTerminalSettingsSource,
  horcaTerminalSettingsPath
} from './terminal-backend/horca-terminal-settings'
import { registerHorcaGhosttySurfaceIpc } from './ghostty-surface-ipc'
import { registerHorcaGhosttyPassthruPaneIpc } from './ghostty-passthru-pane-ipc'
import { registerHorcaTerminalSettingsIpc } from './terminal-backend/horca-terminal-settings-ipc'
import {
  clearHorcaPtyHandleRegistry,
  lookupHorcaPtyHandle,
  setHorcaPtyProviderLookup
} from './horca-pty-handle-registry'

export type HorcaRegistration = {
  dispose(): void
}

export function initializeHorca(store: Store): HorcaRegistration {
  console.log('[horca] register ghostty passthru ipc')
  const settings = createHorcaTerminalSettingsSource(store, horcaTerminalSettingsPath())
  const unregisterSettingsIpc = registerHorcaTerminalSettingsIpc(settings)
  const unregisterGhosttySurfaceIpc = registerHorcaGhosttySurfaceIpc()
  setHorcaPtyProviderLookup((sessionId) => {
    return tryGetProviderForPty(sessionId) ?? getDaemonProvider() ?? null
  })
  const unregisterPassthruIpc = registerHorcaGhosttyPassthruPaneIpc(lookupHorcaPtyHandle)
  return {
    dispose: () => {
      unregisterPassthruIpc()
      unregisterGhosttySurfaceIpc()
      unregisterSettingsIpc()
      setHorcaPtyProviderLookup(null)
      clearHorcaPtyHandleRegistry()
    }
  }
}
