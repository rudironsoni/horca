export const HORCA_GHOSTTY_SURFACE_CHANNELS = {
  isAvailable: 'horca:ghostty-surface:is-available',
  attach: 'horca:ghostty-surface:attach',
  destroy: 'horca:ghostty-surface:destroy',
  setBounds: 'horca:ghostty-surface:set-bounds',
  setOcclusion: 'horca:ghostty-surface:set-occlusion',
  setVisible: 'horca:ghostty-surface:set-visible',
  write: 'horca:ghostty-surface:write',
  resize: 'horca:ghostty-surface:resize'
} as const

export type HorcaGhosttySurfaceBounds = {
  x: number
  y: number
  width: number
  height: number
  dpr: number
}

export type HorcaGhosttySurfaceApi = {
  isAvailable(): boolean
  attach(bounds: HorcaGhosttySurfaceBounds): Promise<number | null>
  destroy(surface: number): Promise<void>
  setBounds(surface: number, bounds: HorcaGhosttySurfaceBounds): Promise<void>
  setOcclusion(surface: number, occluded: boolean): Promise<void>
  setVisible(surface: number, visible: boolean): Promise<void>
  write(surface: number, data: string): Promise<void>
  resize(surface: number, cols: number, rows: number): Promise<void>
}
