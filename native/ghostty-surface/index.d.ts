export type GhosttySurfaceBounds = {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

export type GhosttySurfaceHandle = number

export function isAvailable(): boolean
export function create(
  nativeWindowHandle: Buffer,
  bounds: GhosttySurfaceBounds
): GhosttySurfaceHandle
export function destroy(surface: GhosttySurfaceHandle): void
export function setBounds(surface: GhosttySurfaceHandle, bounds: GhosttySurfaceBounds): void
export function setOcclusion(surface: GhosttySurfaceHandle, occluded: boolean): void
export function setVisible(surface: GhosttySurfaceHandle, visible: boolean): void
export function write(surface: GhosttySurfaceHandle, data: string): void
export function resize(surface: GhosttySurfaceHandle, cols: number, rows: number): void
