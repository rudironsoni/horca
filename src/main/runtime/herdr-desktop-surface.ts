export type HerdrDesktopWindowHandle = {
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

export type HerdrDesktopSurface = {
  getFocusedWindow(): HerdrDesktopWindowHandle | null
  getAllWindows(): HerdrDesktopWindowHandle[]
}

const inertHerdrDesktopSurface: HerdrDesktopSurface = {
  getFocusedWindow: () => null,
  getAllWindows: () => []
}

let current: HerdrDesktopSurface = inertHerdrDesktopSurface

export function setHerdrDesktopSurface(surface: HerdrDesktopSurface | null): void {
  current = surface ?? inertHerdrDesktopSurface
}

export function getHerdrDesktopSurface(): HerdrDesktopSurface {
  return current
}
