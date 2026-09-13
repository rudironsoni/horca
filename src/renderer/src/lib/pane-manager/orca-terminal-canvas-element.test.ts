import { describe, expect, it, vi } from 'vitest'
import { queryOrcaTerminalCanvas, resolveOrcaTerminalScreen } from './orca-terminal-canvas-element'

describe('queryOrcaTerminalCanvas', () => {
  it('returns the element itself when it is the canvas', () => {
    const canvas = { classList: { contains: (name: string) => name === 'orca-terminal-canvas' } }
    const querySelector = vi.fn()
    const element = { ...canvas, querySelector }
    expect(queryOrcaTerminalCanvas(element)).toBe(element)
    expect(querySelector).not.toHaveBeenCalled()
  })

  it('falls back to querySelector for a wrapper that is not the canvas', () => {
    const screen = { id: 'screen' }
    const querySelector = vi.fn(() => screen)
    const wrapper = { classList: { contains: () => false }, querySelector }
    expect(queryOrcaTerminalCanvas(wrapper)).toBe(screen)
    expect(querySelector).toHaveBeenCalledWith('.orca-terminal-canvas')
  })

  it('still calls querySelector when classList is missing so fakes keep working', () => {
    const screen = { id: 'screen' }
    const querySelector = vi.fn(() => screen)
    expect(queryOrcaTerminalCanvas({ querySelector })).toBe(screen)
    expect(querySelector).toHaveBeenCalledWith('.orca-terminal-canvas')
  })

  it('resolveOrcaTerminalScreen falls back to the root when no canvas is found', () => {
    const root = { classList: { contains: () => false }, querySelector: () => null }
    expect(resolveOrcaTerminalScreen(root)).toBe(root)
  })
})
