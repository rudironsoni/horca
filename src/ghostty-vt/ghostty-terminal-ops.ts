import { readGridLine as readGridLineAt, type GridLine } from './ghostty-grid-introspection'
import { encodeBrowserKey } from './ghostty-key-encode'
import { encodeBrowserMouse } from './ghostty-mouse-encode'
import {
  readScrollbar as readScrollbarAt,
  scrollViewport as scrollViewportAt
} from './ghostty-scroll'
import { searchNext, searchPrevious } from './ghostty-search'
import { clearSelectionOnTerminal } from './ghostty-selection'
import type { GhosttyTerminal } from './ghostty-terminal'
import { ghosttyVt } from './ghostty-vt-access'

export function encodeKey(engine: GhosttyTerminal, event: KeyboardEvent): string {
  if (engine.isDisposed) {
    return ''
  }
  const { host, term } = ghosttyVt(engine)
  return encodeBrowserKey(host, term, event)
}

export function encodeMouse(
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
  if (engine.isDisposed) {
    return ''
  }
  const { host, term } = ghosttyVt(engine)
  return encodeBrowserMouse(host, term, event, surface)
}

export function findNext(engine: GhosttyTerminal, query: string): boolean {
  const { host, term } = ghosttyVt(engine)
  return searchNext(host, term, query)
}

export function findPrevious(engine: GhosttyTerminal, query: string): boolean {
  const { host, term } = ghosttyVt(engine)
  return searchPrevious(host, term, query)
}

export function clearSelection(engine: GhosttyTerminal): void {
  const { host, term } = ghosttyVt(engine)
  clearSelectionOnTerminal(host, term)
}

export function readScrollbar(engine: GhosttyTerminal): ReturnType<typeof readScrollbarAt> {
  const { host, term } = ghosttyVt(engine)
  return readScrollbarAt(host, term)
}

export function scrollViewport(
  engine: GhosttyTerminal,
  tag: 'TOP' | 'BOTTOM' | 'DELTA' | 'ROW',
  value = 0
): void {
  const { host, term } = ghosttyVt(engine)
  scrollViewportAt(host, term, tag, value)
}

export function readGridLine(engine: GhosttyTerminal, row: number): GridLine | undefined {
  const { host, term } = ghosttyVt(engine)
  return readGridLineAt(host, term, engine.cols, row)
}
