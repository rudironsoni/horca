import type { IpcRenderer } from 'electron'
import {
  HORCA_GHOSTTY_SURFACE_CHANNELS,
  type HorcaGhosttySurfaceApi
} from '../shared/horca/ghostty-surface-api'

export function createHorcaGhosttySurfaceApi(
  ipc: Pick<IpcRenderer, 'invoke' | 'sendSync'>
): HorcaGhosttySurfaceApi {
  const channels = HORCA_GHOSTTY_SURFACE_CHANNELS
  return {
    isAvailable: () => ipc.sendSync(channels.isAvailable) === true,
    attach: (bounds) => ipc.invoke(channels.attach, bounds),
    destroy: (surface) => ipc.invoke(channels.destroy, surface),
    setBounds: (surface, bounds) => ipc.invoke(channels.setBounds, surface, bounds),
    setOcclusion: (surface, occluded) => ipc.invoke(channels.setOcclusion, surface, occluded),
    setVisible: (surface, visible) => ipc.invoke(channels.setVisible, surface, visible),
    write: (surface, data) => ipc.invoke(channels.write, surface, data),
    resize: (surface, cols, rows) => ipc.invoke(channels.resize, surface, cols, rows)
  }
}
