import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { findNext, findPrevious, scrollViewport } from '../../../../ghostty-vt/ghostty-terminal-ops'

export function scrollOrcaPane(
  engine: GhosttyTerminal,
  refresh: () => void,
  tag: 'TOP' | 'BOTTOM' | 'ROW' | 'DELTA',
  value = 0
): void {
  scrollViewport(engine, tag, value)
  refresh()
}

export function findOrcaPane(
  engine: GhosttyTerminal,
  refresh: () => void,
  query: string,
  direction: 'next' | 'previous'
): boolean {
  const hit = direction === 'next' ? findNext(engine, query) : findPrevious(engine, query)
  if (hit) {
    refresh()
  }
  return hit
}
