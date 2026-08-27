import { BrowserWindow, ipcMain, Notification } from 'electron'
import type {
  RuntimeDesktopSurface,
  RuntimeDesktopWindowHandle
} from '../runtime/runtime-desktop-surface'

function toWindowHandle(window: BrowserWindow): RuntimeDesktopWindowHandle {
  return {
    isDestroyed: () => window.isDestroyed(),
    send: (channel, payload) => {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }
}

/** The desktop implementation of the runtime's optional desktop facilities. */
export const electronRuntimeDesktopSurface: RuntimeDesktopSurface = {
  showNotification: ({ title, body }) => {
    if (!Notification.isSupported()) {
      return false
    }
    new Notification({ title, body }).show()
    return true
  },
  findWindowById: (id) => BrowserWindow.fromId(id),
  onIpc: (channel, listener) => {
    ipcMain.on(channel, listener as Parameters<typeof ipcMain.on>[1])
  },
  removeIpcListener: (channel, listener) => {
    ipcMain.removeListener(channel, listener as Parameters<typeof ipcMain.removeListener>[1])
  },
  getFocusedWindow: () => {
    const focused = BrowserWindow.getFocusedWindow()
    return focused ? toWindowHandle(focused) : null
  },
  getAllWindows: () => BrowserWindow.getAllWindows().map(toWindowHandle)
}
