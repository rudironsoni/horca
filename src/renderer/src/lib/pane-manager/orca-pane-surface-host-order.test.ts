// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

const appearance = {
  fontSize: 14,
  fontFamily: 'monospace',
  lineHeight: 1.2
}

describe('Ghostty compositor surface does not require WASM host', () => {
  it('creates a data-ghostty canvas without priming libghostty-vt', async () => {
    vi.resetModules()
    const { tryGetGhosttyVtHost } = await import('../../../../ghostty-vt/host-singleton')
    const { createOrcaPaneSurface } = await import('./orca-pane-surface')
    expect(tryGetGhosttyVtHost()).toBeNull()
    const surface = createOrcaPaneSurface(appearance)
    expect(surface.canvas.className).toBe('orca-terminal-canvas')
    expect(surface.canvas.getAttribute('data-ghostty')).toMatch(/^pane-\d+$/)
    expect(surface.canvas.getContext).toBeTypeOf('function')
  })
})
