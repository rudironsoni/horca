import { isTerminalLeafId } from '../../../../shared/stable-pane-id'
import type { TerminalLayoutSnapshot } from '../../../../shared/terminal-tab-types'

const TERMINAL_LAYOUT_MAX_LEAVES = 64
const TERMINAL_LAYOUT_MAX_DEPTH = 32

export function isTerminalLayoutSnapshot(value: unknown): value is TerminalLayoutSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const layout = value as Record<string, unknown>
  const leafIds = new Set<string>()
  const visit = (node: unknown, depth: number): boolean => {
    if (depth > TERMINAL_LAYOUT_MAX_DEPTH || typeof node !== 'object' || node === null) {
      return false
    }
    const candidate = node as Record<string, unknown>
    if (candidate.type === 'leaf') {
      if (
        typeof candidate.leafId !== 'string' ||
        !isTerminalLeafId(candidate.leafId) ||
        leafIds.has(candidate.leafId) ||
        leafIds.size >= TERMINAL_LAYOUT_MAX_LEAVES
      ) {
        return false
      }
      leafIds.add(candidate.leafId)
      return true
    }
    return (
      candidate.type === 'split' &&
      (candidate.direction === 'horizontal' || candidate.direction === 'vertical') &&
      (candidate.ratio === undefined ||
        (typeof candidate.ratio === 'number' &&
          Number.isFinite(candidate.ratio) &&
          candidate.ratio >= 0 &&
          candidate.ratio <= 1)) &&
      visit(candidate.first, depth + 1) &&
      visit(candidate.second, depth + 1)
    )
  }
  if (layout.root !== null && !visit(layout.root, 1)) {
    return false
  }
  const validSelectedLeaf = (leafId: unknown): boolean =>
    leafId === null || (typeof leafId === 'string' && leafIds.has(leafId))
  if (!validSelectedLeaf(layout.activeLeafId) || !validSelectedLeaf(layout.expandedLeafId)) {
    return false
  }
  const validLeafMap = (map: unknown, requireNonemptyValue: boolean): boolean => {
    if (map === undefined) {
      return true
    }
    return (
      typeof map === 'object' &&
      map !== null &&
      !Array.isArray(map) &&
      Object.entries(map).every(
        ([leafId, entry]) =>
          leafIds.has(leafId) &&
          typeof entry === 'string' &&
          (!requireNonemptyValue || entry.length > 0)
      )
    )
  }
  return (
    validLeafMap(layout.ptyIdsByLeafId, true) &&
    validLeafMap(layout.buffersByLeafId, false) &&
    validLeafMap(layout.scrollbackRefsByLeafId, true) &&
    validLeafMap(layout.titlesByLeafId, false)
  )
}
