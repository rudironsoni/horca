import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { attachOrcaPaneNativeGhostty } from './orca-pane-native-ghostty'
import { mountOrcaPaneOverlayScrollbar } from './orca-pane-overlay-scrollbar'
import { readScrollbar } from '../../../../ghostty-vt/ghostty-terminal-ops'

export type OrcaPaneHostChrome = {
  write(data: string): void
  resize(cols: number, rows: number): void
  sync(): void
  dispose(): void
}

export function bindOrcaPaneHostChrome(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  engine: GhosttyTerminal,
  scrollLines: (delta: number) => void
): OrcaPaneHostChrome {
  const native = attachOrcaPaneNativeGhostty(canvas, host)
  const scrollbar = mountOrcaPaneOverlayScrollbar(host, () => readScrollbar(engine), scrollLines)
  return {
    write(data: string) {
      native.write(data)
    },
    resize(cols: number, rows: number) {
      native.resize(cols, rows)
    },
    sync() {
      scrollbar.sync()
    },
    dispose() {
      scrollbar.dispose()
      native.dispose()
    }
  }
}
