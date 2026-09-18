// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import {
  attachOrcaPaneNativeGhostty,
  isRendererNativeGhosttyGpuAvailable
} from './orca-pane-native-ghostty'
import type { HorcaGhosttySurfaceApi } from '../../../../shared/horca/ghostty-surface-api'
import { primeGhosttyVtHostForTests } from '../../../../ghostty-vt/prime-host-for-tests'
primeGhosttyVtHostForTests()

function installSurfaceApi(api: HorcaGhosttySurfaceApi): () => void {
  const previous = Object.getOwnPropertyDescriptor(window, 'api')
  Object.defineProperty(window, 'api', {
    configurable: true,
    writable: true,
    value: { horcaGhosttySurface: api }
  })
  return () => {
    if (previous) {
      Object.defineProperty(window, 'api', previous)
      return
    }
    Object.defineProperty(window, 'api', {
      configurable: true,
      writable: true,
      value: undefined
    })
  }
}

describe('orca pane native Ghostty GPU', () => {
  it('is unavailable without a preload bridge so Linux stays on in-process GPU', () => {
    expect(isRendererNativeGhosttyGpuAvailable()).toBe(false)
    const canvas = document.createElement('canvas')
    const host = document.createElement('div')
    const native = attachOrcaPaneNativeGhostty(canvas, host)
    expect(native.attached).toBe(false)
    expect(canvas.style.display).not.toBe('none')
  })

  it('forwards writes without hiding the in-process canvas when the preload reports GPU', async () => {
    const writes: string[] = []
    const api = {
      isAvailable: () => true,
      attach: vi.fn(async () => 7),
      destroy: vi.fn(async () => undefined),
      setBounds: vi.fn(async () => undefined),
      setOcclusion: vi.fn(async () => undefined),
      setVisible: vi.fn(async () => undefined),
      write: vi.fn(async (_id: number, data: string) => {
        writes.push(data)
      }),
      resize: vi.fn(async () => undefined)
    }
    const restore = installSurfaceApi(api)
    const canvas = document.createElement('canvas')
    const host = document.createElement('div')
    document.body.appendChild(host)
    const native = attachOrcaPaneNativeGhostty(canvas, host)
    expect(native.attached).toBe(true)
    expect(canvas.style.display).not.toBe('none')
    native.write('hello')
    await api.attach.mock.results[0]?.value
    await Promise.resolve()
    expect(writes).toEqual(['hello'])
    native.dispose()
    expect(api.destroy).toHaveBeenCalledWith(7)
    expect(canvas.style.display).not.toBe('none')
    restore()
  })
})
