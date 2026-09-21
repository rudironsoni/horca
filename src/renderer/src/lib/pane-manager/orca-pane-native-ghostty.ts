import type {
  HorcaGhosttySurfaceApi,
  HorcaGhosttySurfaceBounds
} from '../../../../shared/horca/ghostty-surface-api'

const NATIVE_GHOSTTY_OCCLUDER = '[data-native-ghostty-occluder]'

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

function readBounds(host: HTMLElement): HorcaGhosttySurfaceBounds {
  const rect = host.getBoundingClientRect()
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
  return {
    x: rect.left,
    y: rect.top,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    dpr
  }
}

function hostIsShown(host: HTMLElement): boolean {
  const rect = host.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) {
    return false
  }
  if (typeof getComputedStyle !== 'function') {
    return true
  }
  const style = getComputedStyle(host)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

function paneIsOccluded(host: HTMLElement): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const pane = host.getBoundingClientRect()
  for (const el of document.querySelectorAll(NATIVE_GHOSTTY_OCCLUDER)) {
    if (!(el instanceof HTMLElement)) {
      continue
    }
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      continue
    }
    const rect = el.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) {
      continue
    }
    const disjoint =
      rect.right < pane.left ||
      rect.left > pane.right ||
      rect.bottom < pane.top ||
      rect.top > pane.bottom
    if (!disjoint) {
      return true
    }
  }
  return false
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
