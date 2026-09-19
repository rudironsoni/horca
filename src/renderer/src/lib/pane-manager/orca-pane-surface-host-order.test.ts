import { describe, expect, it, vi } from 'vitest'

const appearance = {
  fontSize: 14,
  fontFamily: 'monospace',
  lineHeight: 1.2
}

describe('Ghostty host happens-before first terminal construction', () => {
  it('refuses to construct a pane surface while the WASM host is null', async () => {
    vi.resetModules()
    const el = () => ({
      className: '',
      tabIndex: 0,
      style: {},
      setAttribute() {}
    })
    vi.stubGlobal('document', { createElement: () => el() })
    const { tryGetGhosttyVtHost } = await import('../../../../ghostty-vt/host-singleton')
    const { createOrcaPaneSurface } = await import('./orca-pane-surface')
    expect(tryGetGhosttyVtHost()).toBeNull()
    expect(() => createOrcaPaneSurface(appearance)).toThrow(
      'libghostty-vt WASM host is not primed'
    )
  })
})
