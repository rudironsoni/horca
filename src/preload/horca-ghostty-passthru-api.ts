import type { IpcRenderer } from 'electron'
import {
  HORCA_GHOSTTY_PASSTHRU_CHANNELS,
  type HorcaGhosttyPassthruApi
} from '../shared/horca/ghostty-passthru-api'

export function createHorcaGhosttyPassthruApi(
  ipc: Pick<IpcRenderer, 'invoke' | 'sendSync' | 'send'>
): HorcaGhosttyPassthruApi {
  const channels = HORCA_GHOSTTY_PASSTHRU_CHANNELS
  return {
    attach: (payload) => ipc.invoke(channels.attach, payload),
    detach: (slot) => ipc.invoke(channels.detach, slot),
    readSelection: (slot) => String(ipc.sendSync(channels.readSelection, slot) ?? ''),
    pasteText: (slot, text) => ipc.send('electron-ghostty:text', { slot, text })
  }
}

export function loadElectronGhosttyPreload(): void {
  const resourcesPath = process.resourcesPath
  if (resourcesPath) {
    try {
      require(`${resourcesPath}/horca-ghostty/preload.js`)
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : ''
      if (code !== 'MODULE_NOT_FOUND') {
        throw error
      }
    }
  }
  require('../../native/horca-ghostty/adopted/electron-ghostty/preload.js')
}
