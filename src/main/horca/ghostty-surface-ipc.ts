import { BrowserWindow, ipcMain } from 'electron'
import {
  HORCA_GHOSTTY_SURFACE_CHANNELS,
  type HorcaGhosttySurfaceBounds
} from '../../shared/horca/ghostty-surface-api'
import {
  isNativeGhosttyGpuAvailable,
  loadGhosttySurfaceAddon,
  type GhosttySurfaceAddon
} from './ghostty-surface-host'

function windowHandle(event: Electron.IpcMainInvokeEvent): Buffer | null {
  const contents = event.sender
  const window = BrowserWindow.fromWebContents(contents)
  if (!window || window.isDestroyed()) {
    return null
  }
  return window.getNativeWindowHandle()
}

export function registerHorcaGhosttySurfaceIpc(
  addon: GhosttySurfaceAddon | null = loadGhosttySurfaceAddon()
): () => void {
  const channels = HORCA_GHOSTTY_SURFACE_CHANNELS
  ipcMain.on(channels.isAvailable, (event) => {
    event.returnValue = isNativeGhosttyGpuAvailable(addon)
  })
  ipcMain.handle(channels.attach, (event, bounds: HorcaGhosttySurfaceBounds) => {
    const handle = windowHandle(event)
    if (!addon || !handle || !isNativeGhosttyGpuAvailable(addon)) {
      return null
    }
    return addon.create(handle, bounds)
  })
  ipcMain.handle(channels.destroy, (_event, surface: number) => {
    addon?.destroy(surface)
  })
  ipcMain.handle(
    channels.setBounds,
    (_event, surface: number, bounds: HorcaGhosttySurfaceBounds) => {
      addon?.setBounds(surface, bounds)
    }
  )
  ipcMain.handle(channels.setOcclusion, (_event, surface: number, occluded: boolean) => {
    addon?.setOcclusion(surface, occluded)
  })
  ipcMain.handle(channels.setVisible, (_event, surface: number, visible: boolean) => {
    addon?.setVisible(surface, visible)
  })
  ipcMain.handle(channels.write, (_event, surface: number, data: string) => {
    addon?.write(surface, data)
  })
  ipcMain.handle(channels.resize, (_event, surface: number, cols: number, rows: number) => {
    addon?.resize(surface, cols, rows)
  })
  return () => {
    ipcMain.removeAllListeners(channels.isAvailable)
    ipcMain.removeHandler(channels.attach)
    ipcMain.removeHandler(channels.destroy)
    ipcMain.removeHandler(channels.setBounds)
    ipcMain.removeHandler(channels.setOcclusion)
    ipcMain.removeHandler(channels.setVisible)
    ipcMain.removeHandler(channels.write)
    ipcMain.removeHandler(channels.resize)
  }
}
