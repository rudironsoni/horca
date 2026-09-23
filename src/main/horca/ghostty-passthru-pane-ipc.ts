import { ipcMain, type WebContents } from 'electron'
import type { SubprocessHandle } from '../daemon/session-subprocess-handle'
import { HORCA_GHOSTTY_PASSTHRU_CHANNELS } from '../../shared/horca/ghostty-passthru-api'
import { createHorcaGhosttyPassthruEngine, type HorcaGhosttyPassthruEngine } from './ghostty-passthru-engine'

export { HORCA_GHOSTTY_PASSTHRU_CHANNELS }

const engines = new Map<string, HorcaGhosttyPassthruEngine>()

function paneKey(webContentsId: number, slot: string): string {
  return `${webContentsId}\u0000${slot}`
}

export type HorcaGhosttyPassthruHandleLookup = (sessionId: string) => SubprocessHandle | null

export function registerHorcaGhosttyPassthruPaneIpc(
  lookup: HorcaGhosttyPassthruHandleLookup
): () => void {
  ipcMain.handle(
    HORCA_GHOSTTY_PASSTHRU_CHANNELS.attach,
    (event, payload: { sessionId: string; slot: string }) => {
      const handle = lookup(payload.sessionId)
      if (!handle) {
        return false
      }
      const key = paneKey(event.sender.id, payload.slot)
      engines.get(key)?.destroy()
      const engine = createHorcaGhosttyPassthruEngine(handle)
      engine.attach(event.sender, payload.slot)
      engines.set(key, engine)
      return true
    }
  )
  ipcMain.handle(HORCA_GHOSTTY_PASSTHRU_CHANNELS.detach, (event, slot: string) => {
    const key = paneKey(event.sender.id, slot)
    engines.get(key)?.destroy()
    engines.delete(key)
  })
  const readSelection = (event: { sender: { id: number }; returnValue: string }, slot: string): void => {
    event.returnValue = engines.get(paneKey(event.sender.id, slot))?.readSelection() ?? ''
  }
  ipcMain.on(HORCA_GHOSTTY_PASSTHRU_CHANNELS.readSelection, readSelection)
  const clearScreen = (event: { sender: { id: number } }, slot: string): void => {
    engines.get(paneKey(event.sender.id, slot))?.clearScreen()
  }
  ipcMain.on(HORCA_GHOSTTY_PASSTHRU_CHANNELS.clearScreen, clearScreen)
  const scroll = (event: { sender: { id: number } }, slot: string, dy: number): void => {
    engines.get(paneKey(event.sender.id, slot))?.scrollBy(dy)
  }
  ipcMain.on(HORCA_GHOSTTY_PASSTHRU_CHANNELS.scroll, scroll)
  const onDestroyed = (contents: WebContents): void => {
    const prefix = `${contents.id}\u0000`
    for (const key of [...engines.keys()]) {
      if (key.startsWith(prefix)) {
        engines.get(key)?.destroy()
        engines.delete(key)
      }
    }
  }
  void onDestroyed
  return () => {
    ipcMain.removeHandler(HORCA_GHOSTTY_PASSTHRU_CHANNELS.attach)
    ipcMain.removeHandler(HORCA_GHOSTTY_PASSTHRU_CHANNELS.detach)
    ipcMain.removeListener(HORCA_GHOSTTY_PASSTHRU_CHANNELS.readSelection, readSelection)
    ipcMain.removeListener(HORCA_GHOSTTY_PASSTHRU_CHANNELS.clearScreen, clearScreen)
    ipcMain.removeListener(HORCA_GHOSTTY_PASSTHRU_CHANNELS.scroll, scroll)
    for (const engine of engines.values()) {
      engine.destroy()
    }
    engines.clear()
  }
}
