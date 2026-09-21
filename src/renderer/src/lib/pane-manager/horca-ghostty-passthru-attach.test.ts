// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  attachHorcaGhosttyPassthruPane,
  detachHorcaGhosttyPassthruPane
} from './horca-ghostty-passthru-attach'

describe('horca ghostty passthru pane attach', () => {
  it('invokes preload attach with sessionId and compositor slot', async () => {
    const attach = vi.fn(async () => true)
    const detach = vi.fn(async () => undefined)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { horcaGhosttyPassthru: { attach, detach } }
    })
    attachHorcaGhosttyPassthruPane('pty-1', 'pane-3')
    await Promise.resolve()
    expect(attach).toHaveBeenCalledWith({ sessionId: 'pty-1', slot: 'pane-3' })
    detachHorcaGhosttyPassthruPane('pane-3')
    await Promise.resolve()
    expect(detach).toHaveBeenCalledWith('pane-3')
  })
})
