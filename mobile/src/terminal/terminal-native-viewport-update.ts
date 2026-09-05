import type { RpcClient } from '../transport/rpc-client'

type TerminalViewport = { cols: number; rows: number }
type ViewportCapability = 'unknown' | 'supported' | 'unsupported'

// Why: match the legacy WebView MIN_FIT_COLS/rows floor. A 0×0 layout pass must not
// shrink the PTY; the screenshot wrap at ~35 cols was a half-width surface.
export const MIN_TERMINAL_FIT_COLS = 20
export const MIN_TERMINAL_FIT_ROWS = 8

export function isUsableTerminalViewport(viewport: TerminalViewport): boolean {
  return viewport.cols >= MIN_TERMINAL_FIT_COLS && viewport.rows >= MIN_TERMINAL_FIT_ROWS
}

export class TerminalNativeViewportUpdate {
  private readonly capabilities = new WeakMap<RpcClient, ViewportCapability>()

  async request(
    client: RpcClient,
    terminal: string,
    clientId: string,
    viewport: TerminalViewport
  ): Promise<boolean> {
    if (this.capabilities.get(client) === 'unsupported') {
      return false
    }

    try {
      const response = await client.sendRequest('terminal.updateViewport', {
        terminal,
        client: { id: clientId, type: 'mobile' as const },
        viewport
      })
      if (!response.ok) {
        if (response.error.code === 'method_not_found') {
          this.capabilities.set(client, 'unsupported')
        }
        return false
      }
      this.capabilities.set(client, 'supported')
      return (
        typeof response.result === 'object' &&
        response.result != null &&
        (response.result as { updated?: unknown }).updated === true
      )
    } catch {
      return false
    }
  }
}
