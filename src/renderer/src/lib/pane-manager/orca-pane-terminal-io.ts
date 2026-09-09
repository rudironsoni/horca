import type { OrcaLinkProvider } from '../../../../shared/orca-terminal-surface'
import { bindOrcaPaneLinkProviders } from './orca-pane-links'
import {
  applyPointerSelection,
  disposeSelectionGesture
} from '../../../../ghostty-vt/ghostty-selection-gesture'
import {
  clearSelection,
  encodeKey,
  encodeMouse,
  findNext,
  findPrevious,
  readScrollbar
} from '../../../../ghostty-vt/ghostty-terminal-ops'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'

export function pasteIntoGhostty(engine: GhosttyTerminal, text: string): string {
  return engine.encodePaste(text)
}

export function selectAllOnGhostty(engine: GhosttyTerminal): void {
  engine.selectAll()
}

export function clearSelectionOnGhostty(engine: GhosttyTerminal): void {
  clearSelection(engine)
}

export function encodeGhosttyKey(engine: GhosttyTerminal, event: KeyboardEvent): string {
  return encodeKey(engine, event)
}

export function encodeGhosttyMouse(
  engine: GhosttyTerminal,
  event: {
    type: string
    button: number
    clientX: number
    clientY: number
    shiftKey: boolean
    ctrlKey: boolean
    altKey: boolean
    metaKey: boolean
  },
  surface: {
    left: number
    top: number
    cellWidth: number
    cellHeight: number
    cols: number
    rows: number
  }
): string {
  return encodeMouse(engine, event, surface)
}

export function findGhosttyNext(engine: GhosttyTerminal, query: string): boolean {
  return findNext(engine, query)
}

export function findGhosttyPrevious(engine: GhosttyTerminal, query: string): boolean {
  return findPrevious(engine, query)
}

export function hitTestGhosttyHyperlink(
  engine: GhosttyTerminal,
  element: HTMLCanvasElement,
  cellWidth: number,
  cellHeight: number,
  clientX: number,
  clientY: number
): string | null {
  const rect = element.getBoundingClientRect()
  const col = Math.floor((clientX - rect.left) / cellWidth)
  const row = Math.floor((clientY - rect.top) / cellHeight)
  if (col < 0 || row < 0 || col >= engine.cols || row >= engine.rows) {
    return null
  }
  const screenY = readScrollbar(engine).offset + row
  const links = engine.collectHyperlinkRanges()
  const hit = links.find(
    (link) => link.row === screenY && col >= link.startCol && col < link.endCol
  )
  return hit?.uri ?? null
}

export function bindGhosttyKeyboardInput(pane: {
  element: HTMLElement
  encodeKey: (event: KeyboardEvent) => string
  input: (data: string) => void
  customKeyHandler: () => ((event: KeyboardEvent) => boolean) | null
}): () => void {
  const onKey = (event: KeyboardEvent): void => {
    const handler = pane.customKeyHandler()
    if (handler && handler(event) === false) {
      return
    }
    const seq = pane.encodeKey(event)
    if (!seq) {
      return
    }
    event.preventDefault()
    pane.input(seq)
  }
  const surface = pane.element.parentElement ?? pane.element
  surface.addEventListener('keydown', onKey)
  return () => {
    surface.removeEventListener('keydown', onKey)
  }
}

export function notifySelectionListeners(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    listener()
  }
}

export function bindOrcaPaneSession(
  pane: {
    element: HTMLCanvasElement
    textarea: HTMLTextAreaElement
    encodeKey: (event: KeyboardEvent) => string
    encodeMouse: (event: MouseEvent) => string
    input: (data: string) => void
    refresh: () => void
    setPreedit: (text: string) => void
    cellWidth: number
    cellHeight: number
    cols: number
    rows: number
    baseY: number
    linkProviders: Set<OrcaLinkProvider>
  },
  policy: {
    customKeyHandler: () => ((event: KeyboardEvent) => boolean) | null
    onSelectionChange: () => void
  },
  engine: GhosttyTerminal
): () => void {
  const unbindPointer = bindGhosttyPointerInput(pane, policy.onSelectionChange, engine)
  const unbindKeys = bindGhosttyKeyboardInput({
    element: pane.textarea,
    encodeKey: (event) => pane.encodeKey(event),
    input: (data) => pane.input(data),
    customKeyHandler: policy.customKeyHandler
  })
  const unbindLinks = bindOrcaPaneLinkProviders(pane)
  return () => {
    unbindPointer()
    unbindKeys()
    unbindLinks()
  }
}

export function bindGhosttyPointerInput(
  pane: {
    element: HTMLCanvasElement
    textarea?: HTMLTextAreaElement
    encodeMouse: (event: MouseEvent) => string
    input: (data: string) => void
    refresh: () => void
    setPreedit: (text: string) => void
    cellWidth: number
    cellHeight: number
    cols: number
    rows: number
  },
  onSelectionChange: (() => void) | undefined,
  engine: GhosttyTerminal
): () => void {
  const send = (event: MouseEvent): void => {
    pane.textarea?.focus()
    if (!engine.mouseTracking) {
      const before = engine.readSelection()
      const rect = pane.element.getBoundingClientRect()
      applyPointerSelection(engine, event, {
        left: rect.left,
        top: rect.top,
        cellWidth: pane.cellWidth,
        cellHeight: pane.cellHeight,
        cols: pane.cols,
        rows: pane.rows
      })
      pane.refresh()
      if (engine.readSelection() !== before) {
        onSelectionChange?.()
      }
      return
    }
    const seq = pane.encodeMouse(event)
    if (seq) {
      pane.input(seq)
    }
  }
  const onComposition = (event: CompositionEvent): void => {
    pane.setPreedit(event.type === 'compositionend' ? '' : event.data)
  }
  pane.element.addEventListener('pointerdown', send)
  pane.element.addEventListener('pointerup', send)
  pane.element.addEventListener('pointermove', send)
  const host: HTMLElement = pane.textarea ?? pane.element
  host.addEventListener('compositionstart', onComposition)
  host.addEventListener('compositionupdate', onComposition)
  host.addEventListener('compositionend', onComposition)
  return () => {
    pane.element.removeEventListener('pointerdown', send)
    pane.element.removeEventListener('pointerup', send)
    pane.element.removeEventListener('pointermove', send)
    host.removeEventListener('compositionstart', onComposition)
    host.removeEventListener('compositionupdate', onComposition)
    host.removeEventListener('compositionend', onComposition)
    disposeSelectionGesture(engine)
  }
}
