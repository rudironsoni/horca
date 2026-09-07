import { encodeBrowserKey } from '../../../../ghostty-vt/ghostty-key-encode'
import type { ILinkProvider } from '../../../../shared/orca-terminal-surface'
import { bindOrcaPaneLinkProviders } from './orca-pane-links'
import { encodeBrowserMouse } from '../../../../ghostty-vt/ghostty-mouse-encode'
import { searchNext, searchPrevious } from '../../../../ghostty-vt/ghostty-search'
import {
  applyPointerSelection,
  disposeSelectionGesture
} from '../../../../ghostty-vt/ghostty-selection-gesture'
import { clearSelectionOnTerminal } from '../../../../ghostty-vt/ghostty-selection'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'

export function pasteIntoGhostty(engine: GhosttyTerminal, text: string): string {
  return engine.encodePaste(text)
}

export function selectAllOnGhostty(engine: GhosttyTerminal): void {
  engine.selectAll()
}

export function clearSelectionOnGhostty(engine: GhosttyTerminal): void {
  const { host, term } = engine.hostHandle()
  clearSelectionOnTerminal(host, term)
}

export function encodeGhosttyKey(engine: GhosttyTerminal, event: KeyboardEvent): string {
  const { host, term } = engine.hostHandle()
  return encodeBrowserKey(host, term, event)
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
  const { host, term } = engine.hostHandle()
  return encodeBrowserMouse(host, term, event, surface)
}

export function findGhosttyNext(engine: GhosttyTerminal, query: string): boolean {
  const { host, term } = engine.hostHandle()
  return searchNext(host, term, query)
}

export function findGhosttyPrevious(engine: GhosttyTerminal, query: string): boolean {
  const { host, term } = engine.hostHandle()
  return searchPrevious(host, term, query)
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
  const links = engine.collectHyperlinkRanges()
  const hit = links.find((link) => link.row === row && col >= link.startCol && col < link.endCol)
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
  pane.element.addEventListener('keydown', onKey)
  pane.element.addEventListener('keyup', onKey)
  return () => {
    pane.element.removeEventListener('keydown', onKey)
    pane.element.removeEventListener('keyup', onKey)
  }
}

export function notifySelectionListeners(listeners: Set<() => void>): void {
  for (const listener of listeners) {
    listener()
  }
}

export function bindOrcaPaneSession(pane: {
  element: HTMLCanvasElement
  engine: GhosttyTerminal
  encodeKey: (event: KeyboardEvent) => string
  encodeMouse: (event: MouseEvent) => string
  input: (data: string) => void
  refresh: () => void
  setPreedit: (text: string) => void
  customKeyHandler: () => ((event: KeyboardEvent) => boolean) | null
  onSelectionChange: () => void
  cellWidth: number
  cellHeight: number
  cols: number
  rows: number
  baseY: number
  linkProviders: Set<ILinkProvider>
}): () => void {
  const unbindPointer = bindGhosttyPointerInput(pane)
  const unbindKeys = bindGhosttyKeyboardInput(pane)
  const unbindLinks = bindOrcaPaneLinkProviders(pane)
  return () => {
    unbindPointer()
    unbindKeys()
    unbindLinks()
  }
}

export function bindGhosttyPointerInput(pane: {
  element: HTMLCanvasElement
  engine: GhosttyTerminal
  encodeMouse: (event: MouseEvent) => string
  input: (data: string) => void
  refresh: () => void
  setPreedit: (text: string) => void
  onSelectionChange?: () => void
  cellWidth: number
  cellHeight: number
  cols: number
  rows: number
}): () => void {
  const send = (event: MouseEvent): void => {
    if (!pane.engine.mouseTracking) {
      const before = pane.engine.readSelection()
      const rect = pane.element.getBoundingClientRect()
      applyPointerSelection(pane.engine, event, {
        left: rect.left,
        top: rect.top,
        cellWidth: pane.cellWidth,
        cellHeight: pane.cellHeight,
        cols: pane.cols,
        rows: pane.rows
      })
      pane.refresh()
      if (pane.engine.readSelection() !== before) {
        pane.onSelectionChange?.()
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
  pane.element.addEventListener('compositionstart', onComposition)
  pane.element.addEventListener('compositionupdate', onComposition)
  pane.element.addEventListener('compositionend', onComposition)
  return () => {
    pane.element.removeEventListener('pointerdown', send)
    pane.element.removeEventListener('pointerup', send)
    pane.element.removeEventListener('pointermove', send)
    pane.element.removeEventListener('compositionstart', onComposition)
    pane.element.removeEventListener('compositionupdate', onComposition)
    pane.element.removeEventListener('compositionend', onComposition)
    disposeSelectionGesture(pane.engine)
  }
}
