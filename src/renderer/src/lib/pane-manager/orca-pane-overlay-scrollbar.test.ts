// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mountOrcaPaneOverlayScrollbar } from './orca-pane-overlay-scrollbar'

describe('orca pane overlay scrollbar', () => {
  it('hides when the viewport covers the buffer and shows a thumb when it does not', () => {
    const host = document.createElement('div')
    Object.defineProperty(host, 'clientHeight', { value: 100 })
    document.body.appendChild(host)
    let source = { total: 24, offset: 0, len: 24 }
    const onDelta = vi.fn()
    const bar = mountOrcaPaneOverlayScrollbar(host, () => source, onDelta)
    bar.sync()
    const track = host.querySelector('.orca-terminal-scrollbar')
    expect(track).toBeInstanceOf(HTMLElement)
    if (!(track instanceof HTMLElement)) {
      throw new Error('missing overlay scrollbar')
    }
    expect(track.style.display).toBe('none')
    source = { total: 80, offset: 10, len: 24 }
    bar.sync()
    expect(track.style.display).toBe('')
    expect(host.querySelector('.orca-terminal-slider')).toBeInstanceOf(HTMLElement)
    bar.dispose()
    expect(host.querySelector('.orca-terminal-scrollbar')).toBeNull()
  })
})
