import { createRequire } from 'node:module'

export type GhosttySurfaceBounds = {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

export type GhosttySurfaceAddon = {
  isAvailable: () => boolean
  create: (nativeWindowHandle: Buffer, bounds: GhosttySurfaceBounds) => number
  destroy: (surface: number) => void
  setBounds: (surface: number, bounds: GhosttySurfaceBounds) => void
  setOcclusion: (surface: number, occluded: boolean) => void
  setVisible: (surface: number, visible: boolean) => void
  write: (surface: number, data: string) => void
  resize: (surface: number, cols: number, rows: number) => void
}

const requireFromMain = createRequire(__filename)

function isGhosttySurfaceAddon(value: unknown): value is GhosttySurfaceAddon {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  return (
    'isAvailable' in value &&
    typeof value.isAvailable === 'function' &&
    'create' in value &&
    typeof value.create === 'function' &&
    'destroy' in value &&
    typeof value.destroy === 'function' &&
    'setBounds' in value &&
    typeof value.setBounds === 'function' &&
    'setOcclusion' in value &&
    typeof value.setOcclusion === 'function' &&
    'setVisible' in value &&
    typeof value.setVisible === 'function' &&
    'write' in value &&
    typeof value.write === 'function' &&
    'resize' in value &&
    typeof value.resize === 'function'
  )
}

export function loadGhosttySurfaceAddon(): GhosttySurfaceAddon | null {
  try {
    const loaded: unknown = requireFromMain('@orca/ghostty-surface')
    return isGhosttySurfaceAddon(loaded) ? loaded : null
  } catch {
    return null
  }
}

export function isNativeGhosttyGpuAvailable(
  addon: GhosttySurfaceAddon | null = loadGhosttySurfaceAddon()
): boolean {
  try {
    return addon?.isAvailable() === true
  } catch {
    return false
  }
}
