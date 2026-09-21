import type { IpcRenderer } from 'electron'
import {
  HORCA_GHOSTTY_PASSTHRU_CHANNELS,
  type HorcaGhosttyPassthruApi
} from '../shared/horca/ghostty-passthru-api'

export function createHorcaGhosttyPassthruApi(
  ipc: Pick<IpcRenderer, 'invoke'>
): HorcaGhosttyPassthruApi {
  const channels = HORCA_GHOSTTY_PASSTHRU_CHANNELS
  return {
    attach: (payload) => ipc.invoke(channels.attach, payload),
    detach: (slot) => ipc.invoke(channels.detach, slot)
  }
}

export function loadElectronGhosttyPreload(): void {
  require('../../native/horca-ghostty/adopted/electron-ghostty/preload.js')
}
