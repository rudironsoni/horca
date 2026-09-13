type CanvasRoot = {
  classList?: { contains: (name: string) => boolean }
  querySelector?: (selector: string) => unknown
}

export function queryOrcaTerminalCanvas(root: CanvasRoot | null | undefined): HTMLElement | null {
  if (!root) {
    return null
  }
  if (root.classList?.contains('orca-terminal-canvas')) {
    return root as HTMLElement
  }
  if (typeof root.querySelector !== 'function') {
    return null
  }
  return (root.querySelector('.orca-terminal-canvas') as HTMLElement | null) ?? null
}

export function resolveOrcaTerminalScreen(root: CanvasRoot | null | undefined): HTMLElement | null {
  return queryOrcaTerminalCanvas(root) ?? (root as HTMLElement | null) ?? null
}
