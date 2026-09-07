import type { ManagedPane, ManagedPaneInternal } from './pane-manager-types'

export function toPublicPane(pane: ManagedPaneInternal): ManagedPane {
  return {
    id: pane.id,
    leafId: pane.leafId,
    stablePaneId: pane.stablePaneId,
    terminal: pane.terminal,
    container: pane.container,
    linkTooltip: pane.linkTooltip,
    fitController: pane.fitController,
    searchController: pane.searchController,
    serializeController: pane.serializeController
  }
}

export function collectPublicPanes(
  panes: Map<number, ManagedPaneInternal>,
  limit: number
): ManagedPane[] {
  const collected: ManagedPane[] = []
  for (const pane of panes.values()) {
    if (collected.length >= limit) {
      break
    }
    collected.push(toPublicPane(pane))
  }
  return collected
}
