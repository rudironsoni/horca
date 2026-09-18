import { describe, expect, it } from 'vitest'
import { primeGhosttyVtHostForTests } from '../../../../ghostty-vt/prime-host-for-tests'
import { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'

primeGhosttyVtHostForTests()
import { readScrollbar, scrollViewport } from '../../../../ghostty-vt/ghostty-terminal-ops'
import { createOrcaPaneBuffer } from './orca-pane-buffer'

describe('createOrcaPaneBuffer', () => {
  it('reports scrollbar offset as viewportY instead of the origin', () => {
    const engine = new GhosttyTerminal(getGhosttyVtHostOrThrow(), { cols: 20, rows: 4 })
    engine.writePtyOutput(`${'pad\n'.repeat(20)}bottom`)
    scrollViewport(engine, 'TOP')
    const bar = readScrollbar(engine)
    expect(bar.total).toBeGreaterThan(bar.len)
    const origin = Math.max(0, bar.total - bar.len)
    expect(bar.offset).not.toBe(origin)
    const buffer = createOrcaPaneBuffer(
      engine,
      () => origin,
      () => bar.offset
    )
    expect(buffer.active.viewportY).toBe(bar.offset)
    expect(buffer.active.baseY).toBe(origin)
    engine.dispose()
  })
})
