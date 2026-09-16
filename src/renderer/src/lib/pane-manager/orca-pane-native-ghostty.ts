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
  const surface = window.api?.horcaGhosttySurface
  return surface ?? null
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
  canvas: HTMLCanvasElement,
  host: HTMLElement
): OrcaPaneNativeGhostty {
  const api = nativeSurfaceApi()
  if (!api || !isRendererNativeGhosttyGpuAvailable()) {
    return noopNativeGhostty()
  }
  canvas.style.display = 'block'
  let surfaceId: number | null = null
  const pending: string[] = []
  const sync = (): void => {
    if (surfaceId == null) {
      return
    }
    void api.setBounds(surfaceId, readBounds(host))
    void api.setVisible(surfaceId, hostIsShown(host))
    void api.setOcclusion(surfaceId, paneIsOccluded(host))
  }
  void api.attach(readBounds(host)).then((id) => {
    if (id == null) {
      pending.length = 0
      return
    }
    surfaceId = id
    for (const chunk of pending) {
      void api.write(id, chunk)
    }
    pending.length = 0
    sync()
  })
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null
  observer?.observe(host)
  const mutation = typeof MutationObserver === 'function' ? new MutationObserver(sync) : null
  mutation?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'class', 'hidden']
  })
  window.addEventListener('resize', sync)
  return {
    attached: true,
    write(data: string) {
      if (surfaceId == null) {
        pending.push(data)
        return
      }
      void api.write(surfaceId, data)
    },
    resize(cols: number, rows: number) {
      if (surfaceId == null) {
        return
      }
      void api.resize(surfaceId, cols, rows)
      sync()
    },
    dispose() {
      observer?.disconnect()
      mutation?.disconnect()
      window.removeEventListener('resize', sync)
      if (surfaceId != null) {
        void api.destroy(surfaceId)
      }
      surfaceId = null
    }
  }
}
