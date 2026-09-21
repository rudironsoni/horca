import { existsSync } from 'node:fs'
import { join } from 'node:path'
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
  const packaged = join(process.resourcesPath ?? '', 'horca-ghostty', 'preload.js')
  if (existsSync(packaged)) {
    require(packaged)
    return
  }
  require('../../native/horca-ghostty/adopted/electron-ghostty/preload.js')
}
