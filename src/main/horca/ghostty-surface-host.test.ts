import { describe, expect, it, vi } from 'vitest'
import { isNativeGhosttyGpuAvailable, type GhosttySurfaceAddon } from './ghostty-surface-host'

describe('isNativeGhosttyGpuAvailable', () => {
  it('is false when the addon is missing or refuses libghostty', () => {
    expect(isNativeGhosttyGpuAvailable(null)).toBe(false)
    const addon: GhosttySurfaceAddon = {
      isAvailable: () => false,
      create: vi.fn(),
      destroy: vi.fn(),
      setBounds: vi.fn(),
      setOcclusion: vi.fn(),
      setVisible: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    }
    expect(isNativeGhosttyGpuAvailable(addon)).toBe(false)
  })

  it('is true only when the addon reports a live libghostty GPU host', () => {
    const addon: GhosttySurfaceAddon = {
      isAvailable: () => true,
      create: vi.fn(() => 1),
      destroy: vi.fn(),
      setBounds: vi.fn(),
      setOcclusion: vi.fn(),
      setVisible: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    }
    expect(isNativeGhosttyGpuAvailable(addon)).toBe(true)
  })

  it('treats a throwing addon as unavailable so Linux stays on in-process GPU', () => {
    const addon: GhosttySurfaceAddon = {
      isAvailable: () => {
        throw new Error('missing .node')
      },
      create: vi.fn(),
      destroy: vi.fn(),
      setBounds: vi.fn(),
      setOcclusion: vi.fn(),
      setVisible: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    }
    expect(isNativeGhosttyGpuAvailable(addon)).toBe(false)
  })
})
