import type { HorcaGhosttySurfaceApi } from '../../../../shared/horca/ghostty-surface-api'

export type OrcaPaneNativeGhostty = {
  attached: boolean
  write(data: string): void
  resize(cols: number, rows: number): void
  dispose(): void
}

type NativeSurfaceApi = HorcaGhosttySurfaceApi

function nativeSurfaceApi(): NativeSurfaceApi | null {
  if (typeof window === 'undefined') {
    return null
  }
  const api = window.api as { horcaGhosttySurface?: NativeSurfaceApi } | undefined
  return api?.horcaGhosttySurface ?? null
}

export function isRendererNativeGhosttyGpuAvailable(): boolean {
  try {
    return nativeSurfaceApi()?.isAvailable() === true
  } catch {
    return false
  }
}

function noopNativeGhostty(): OrcaPaneNativeGhostty {
  return {
    attached: false,
    write() {},
    resize() {},
    dispose() {}
  }
}

export function attachOrcaPaneNativeGhostty(
  _canvas: HTMLCanvasElement,
  _host: HTMLElement
): OrcaPaneNativeGhostty {
  return noopNativeGhostty()
}
