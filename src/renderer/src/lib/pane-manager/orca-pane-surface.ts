let nextGhosttySlot = 1

export type OrcaPaneCompositorAppearance = {
  fontSize?: number
  fontFamily?: string
  lineHeight?: number
}

function hideOrcaPaneHelperTextarea(textarea: HTMLTextAreaElement): void {
  textarea.className = 'orca-terminal-helper-textarea'
  textarea.tabIndex = 0
  textarea.setAttribute('aria-label', 'Terminal input')
  textarea.style.position = 'absolute'
  textarea.style.opacity = '0'
  textarea.style.caretColor = 'transparent'
  textarea.style.width = '0'
  textarea.style.height = '0'
  textarea.style.border = '0'
  textarea.style.padding = '0'
  textarea.style.margin = '0'
  textarea.style.resize = 'none'
  textarea.style.overflow = 'hidden'
  textarea.style.zIndex = '-5'
}

export function createOrcaPaneSurface(_appearance: OrcaPaneCompositorAppearance = {}): {
  canvas: HTMLCanvasElement
  textarea: HTMLTextAreaElement
  slot: string
  cellWidth: number
  cellHeight: number
  bindRefresh: (refresh: () => void) => void
} {
  const cells = { width: 8, height: 16 }
  const slot = `pane-${nextGhosttySlot++}`
  const canvas = document.createElement('canvas')
  canvas.className = 'orca-terminal-canvas'
  canvas.tabIndex = 0
  canvas.setAttribute('data-ghostty', slot)
  canvas.style.display = 'block'
  const textarea = document.createElement('textarea')
  hideOrcaPaneHelperTextarea(textarea)
  const refreshRef = { current: (): void => undefined }
  return {
    canvas,
    textarea,
    slot,
    cellWidth: cells.width,
    cellHeight: cells.height,
    bindRefresh: (next) => {
      refreshRef.current = next
    }
  }
}
