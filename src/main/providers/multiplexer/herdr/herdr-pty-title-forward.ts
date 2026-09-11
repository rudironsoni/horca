import type { HerdrEvent } from '@herdr/sdk'
import { Option } from 'effect'
import type { PtyDataEvent } from '../../types'
import { fromOption } from './herdr-sdk-values'
import type { HerdrPtyBinding } from './herdr-pty-types'
import type { HerdrPane } from './herdr-runtime-contract'

export type HerdrPaneTerminalTitleListener = (
  sessionName: string,
  paneId: string,
  title: string
) => void

function readTitleValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (Option.isOption(value)) {
    const title = fromOption(value as Option.Option<string>)
    return title && title.length > 0 ? title : undefined
  }
  return undefined
}

function readPaneId(pane: { id?: unknown; pane_id?: unknown }): string | undefined {
  if (typeof pane.id === 'string' && pane.id.length > 0) {
    return pane.id
  }
  if (typeof pane.pane_id === 'string' && pane.pane_id.length > 0) {
    return pane.pane_id
  }
  return undefined
}

export function readHerdrPaneUpdatedTitle(
  event: HerdrEvent
): { paneId: string; title: string } | null {
  const kind = event.type.includes('.') ? event.type : event.type.replaceAll('_', '.')
  if (kind !== 'pane.updated') {
    return null
  }
  const record = event as HerdrEvent & {
    pane?: { id?: unknown; pane_id?: unknown; terminalTitle?: unknown; terminal_title?: unknown }
    paneId?: unknown
    pane_id?: unknown
    terminalTitle?: unknown
    terminal_title?: unknown
  }
  const pane = record.pane
  const paneId =
    (pane ? readPaneId(pane) : undefined) ??
    (typeof record.paneId === 'string' ? record.paneId : undefined) ??
    (typeof record.pane_id === 'string' ? record.pane_id : undefined)
  const title =
    (pane
      ? (readTitleValue(pane.terminalTitle) ?? readTitleValue(pane.terminal_title))
      : undefined) ??
    readTitleValue(record.terminalTitle) ??
    readTitleValue(record.terminal_title)
  if (!paneId || !title) {
    return null
  }
  return { paneId, title }
}

export function readHerdrSnapshotPaneTitles(
  panes: readonly HerdrPane[]
): { paneId: string; title: string }[] {
  const titles: { paneId: string; title: string }[] = []
  for (const pane of panes) {
    const title = readTitleValue(pane.terminalTitle) ?? readTitleValue(pane.terminalTitleStripped)
    if (title) {
      titles.push({ paneId: pane.id, title })
    }
  }
  return titles
}

export function emitHerdrPaneOscTitle(args: {
  bindings: Map<string, HerdrPtyBinding>
  sessionName: string
  paneId: string
  title: string
  lastTitles: Map<string, string>
  emitData: (payload: PtyDataEvent) => void
}): void {
  const samePane = [...args.bindings.values()].filter(
    (binding) => !binding.detached && binding.paneId === args.paneId
  )
  const binding =
    samePane.find((candidate) => candidate.sessionName === args.sessionName) ?? samePane[0]
  if (!binding) {
    return
  }
  if (args.lastTitles.get(binding.id) === args.title) {
    return
  }
  args.lastTitles.set(binding.id, args.title)
  // Why: observe/control frames are rendered ANSI. OSC 0 and BEL never
  // appear in those bytes. Reconstruct the dropped side-effect burst so
  // Orca's existing title tracker and unread path still run.
  const data = `\x07\x1b]0;${args.title}\x07`
  args.emitData({ id: binding.id, data, syntheticSideEffects: true })
}

export function createHerdrPaneTitleListener(
  bindings: Map<string, HerdrPtyBinding>,
  emitData: (payload: PtyDataEvent) => void
): HerdrPaneTerminalTitleListener {
  const lastTitles = new Map<string, string>()
  return (sessionName, paneId, title) =>
    emitHerdrPaneOscTitle({
      bindings,
      sessionName,
      paneId,
      title,
      lastTitles,
      emitData
    })
}

const TITLE_PROBE_MS = 2_000
const TITLE_PROBE_ATTEMPTS = 5
const titleProbeArmed = new WeakSet<HerdrPtyBinding>()
const titleProbes = new WeakMap<HerdrPtyBinding, ReturnType<typeof setTimeout>>()
const probedTitles = new Map<string, string>()

export function stopHerdrPaneTitleProbe(binding: HerdrPtyBinding): void {
  titleProbeArmed.delete(binding)
  const pending = titleProbes.get(binding)
  if (pending) {
    clearTimeout(pending)
  }
  titleProbes.delete(binding)
}

export function scheduleHerdrPaneTitleProbe(
  binding: HerdrPtyBinding,
  emitData: (payload: PtyDataEvent) => void
): void {
  if (titleProbeArmed.has(binding)) {
    return
  }
  titleProbeArmed.add(binding)
  let remaining = TITLE_PROBE_ATTEMPTS
  const tick = (): void => {
    titleProbes.delete(binding)
    if (!titleProbeArmed.has(binding) || binding.detached || !binding.transport?.sdk) {
      titleProbeArmed.delete(binding)
      return
    }
    remaining -= 1
    void binding.transport.sdk
      .run(binding.sessionName, (herdr) => herdr.panes.get(herdr.ids.pane(binding.paneId)))
      .then((pane) => {
        const title =
          readTitleValue(pane.terminalTitle) ?? readTitleValue(pane.terminalTitleStripped)
        if (!title) {
          return
        }
        emitHerdrPaneOscTitle({
          bindings: new Map([[binding.id, binding]]),
          sessionName: binding.sessionName,
          paneId: binding.paneId,
          title,
          lastTitles: probedTitles,
          emitData
        })
      })
      .catch(() => undefined)
      .finally(() => {
        if (!titleProbeArmed.has(binding) || binding.detached || remaining <= 0) {
          titleProbeArmed.delete(binding)
          return
        }
        const timer = setTimeout(tick, TITLE_PROBE_MS)
        timer.unref?.()
        titleProbes.set(binding, timer)
      })
  }
  const timer = setTimeout(tick, TITLE_PROBE_MS)
  timer.unref?.()
  titleProbes.set(binding, timer)
}
