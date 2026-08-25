import type { Project } from '../../../../shared/project-types'
import {
  claimOrcaPaneBinding,
  collectLeafIds,
  ORCA_BINDING_TOKEN,
  ORCA_METADATA_SOURCE,
  orcaPaneBinding,
  paneBindingMapKey
} from './herdr-binding-metadata'
import { findHerdrWorkspaceForWorktree, type HerdrProjectHostGraph } from './ensure-herdr-workspace'
import type { HerdrHostTransport, HerdrSessionSnapshot } from './herdr-runtime-contract'
import { unwrapHerdrResponse } from './herdr-runtime-contract'

export async function materializeHerdrLeafPane(args: {
  transport: HerdrHostTransport
  sessionName: string
  project: Project
  leafId: string
  cwd: string
  worktree: { id: string; path: string; displayName?: string }
  graph: HerdrProjectHostGraph | undefined
  paneIdsBySessionAndBinding: Map<string, string>
  snapshot: () => Promise<HerdrSessionSnapshot>
}): Promise<string | null> {
  const snapshot = await args.snapshot()
  const worktree =
    args.graph?.worktrees.find((candidate) => candidate.id === args.worktree.id) ?? args.worktree
  const workspace = findHerdrWorkspaceForWorktree(snapshot, args.project.id, worktree)
  const claimedPaneIds = new Set(args.paneIdsBySessionAndBinding.values())
  const workspacePanes = snapshot.panes.filter(
    (pane) => workspace && pane.workspace_id === workspace.workspace_id
  )
  // Why: the Orca session is the only authority on which panes exist. A bare
  // pane is reusable, and a pane whose orca_binding names a leaf the session
  // no longer models is a stale leftover of a previous run. Reclaiming it
  // must never mint a new herdr tab.
  const desiredBindings = desiredLeafBindings(args.project.id, args.graph)
  const selfBinding = orcaPaneBinding(args.project.id, args.leafId)
  const alreadyMine = workspacePanes.find(
    (pane) => pane.tokens?.[ORCA_BINDING_TOKEN] === selfBinding
  )
  if (alreadyMine) {
    args.paneIdsBySessionAndBinding.set(
      paneBindingMapKey(args.sessionName, selfBinding),
      alreadyMine.pane_id
    )
    return alreadyMine.pane_id
  }
  const reusable =
    workspacePanes.find(
      (pane) => !claimedPaneIds.has(pane.pane_id) && !pane.tokens?.[ORCA_BINDING_TOKEN]
    ) ??
    workspacePanes.find((pane) => {
      const token = pane.tokens?.[ORCA_BINDING_TOKEN]
      return token !== undefined && !desiredBindings.has(token)
    })
  if (reusable) {
    return claimMaterializedPane(args, reusable, snapshot)
  }
  return null
}

function desiredLeafBindings(
  projectId: string,
  graph: HerdrProjectHostGraph | undefined
): Set<string> {
  const bindings = new Set<string>()
  if (!graph) {
    return bindings
  }
  for (const worktree of graph.worktrees) {
    for (const tab of graph.tabsByWorktreeId[worktree.id] ?? []) {
      const root = graph.layoutsByTabId[tab.id]?.root
      if (!root) {
        continue
      }
      for (const leafId of collectLeafIds(root)) {
        bindings.add(orcaPaneBinding(projectId, leafId))
      }
    }
  }
  return bindings
}

async function claimMaterializedPane(
  args: {
    transport: HerdrHostTransport
    sessionName: string
    project: Project
    leafId: string
    paneIdsBySessionAndBinding: Map<string, string>
  },
  pane: HerdrSessionSnapshot['panes'][number],
  snapshot: HerdrSessionSnapshot
): Promise<string | null> {
  const binding = orcaPaneBinding(args.project.id, args.leafId)
  const staleToken = pane.tokens?.[ORCA_BINDING_TOKEN]
  if (staleToken !== undefined && staleToken !== binding) {
    await unwrapHerdrResponse(
      await args.transport.request(args.sessionName, 'pane.report_metadata', {
        pane_id: pane.pane_id,
        source: ORCA_METADATA_SOURCE,
        tokens: { [ORCA_BINDING_TOKEN]: null }
      })
    )
    delete pane.tokens?.[ORCA_BINDING_TOKEN]
  }
  await claimOrcaPaneBinding(
    args.transport,
    args.sessionName,
    args.project.id,
    args.leafId,
    pane,
    snapshot
  )
  if (pane.tokens?.[ORCA_BINDING_TOKEN] !== binding) {
    return null
  }
  args.paneIdsBySessionAndBinding.set(paneBindingMapKey(args.sessionName, binding), pane.pane_id)
  return pane.pane_id
}
