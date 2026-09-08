import type { Page } from '@stablyai/playwright-test'
import { expect } from '@stablyai/playwright-test'
import { rmSync } from 'node:fs'
import { ensureTerminalVisible, getActiveWorktreeId, switchToWorktree } from './helpers/store'
import {
  resolveActiveTabId,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'
import { readActiveScreen } from './helpers/alt-screen-frame'

type HiddenPressurePane = { ptyId: string }

type HiddenPressureMainSnapshot = {
  hiddenDeliveryDroppedChars: number
  hiddenDeliveryGatedPtyCount: number
}

export async function waitForHiddenDeliveryGate<TMainPressure extends HiddenPressureMainSnapshot>(
  orcaPage: Page,
  deps: { readMainPtyPressureDebug: (page: Page) => Promise<TMainPressure | null> },
  hiddenPaneCount: number
): Promise<void> {
  await expect
    .poll(
      async () => (await deps.readMainPtyPressureDebug(orcaPage))?.hiddenDeliveryGatedPtyCount ?? 0,
      { timeout: 15_000, message: 'Hidden PTY delivery gate did not cover background panes' }
    )
    .toBeGreaterThanOrEqual(hiddenPaneCount)
}

export async function waitForMainHiddenDeliveryDrops<
  TMainPressure extends HiddenPressureMainSnapshot
>(
  orcaPage: Page,
  deps: { readMainPtyPressureDebug: (page: Page) => Promise<TMainPressure | null> },
  pressureOutputChars: number
): Promise<void> {
  await expect
    .poll(
      async () => (await deps.readMainPtyPressureDebug(orcaPage))?.hiddenDeliveryDroppedChars ?? 0,
      { timeout: 45_000, message: 'Main hidden-delivery gate did not drop hidden PTY output' }
    )
    .toBeGreaterThanOrEqual(pressureOutputChars)
}

export async function measureHiddenOutputRestoreLatency(
  orcaPage: Page,
  worktreeId: string,
  runId: string
): Promise<number> {
  const restoreStart = performance.now()
  await switchToWorktree(orcaPage, worktreeId)
  // Why resolve rather than read activeTabId: after a worktree switch the active tab can
  // still be the previous worktree's, or a non-terminal one; this picks the worktree's own.
  const tabId = (await resolveActiveTabId(orcaPage)) ?? ''
  await expect
    .poll(async () => (await readActiveScreen(orcaPage, tabId))?.rows.join('\n') ?? '', {
      timeout: 20_000,
      // One-second backoff can dominate the measured restore latency.
      intervals: [50],
      message: 'No restored output from main buffer on return (or no active terminal pane)'
    })
    .toContain(`OPENCODE_PRESSURE_DONE_${runId}_`)
  return performance.now() - restoreStart
}

export async function startHiddenPressureCommands(opts: {
  hiddenPanes: HiddenPressurePane[]
  orcaPage: Page
  pressureOutputChars: number
  pressureScriptPath: string
  pressureStartDelayMs: number
}): Promise<void> {
  await Promise.all(
    opts.hiddenPanes.map((pane, paneIndex) =>
      sendToTerminal(
        opts.orcaPage,
        pane.ptyId,
        `node ${JSON.stringify(opts.pressureScriptPath)} ${paneIndex} ${opts.pressureOutputChars} ${opts.pressureStartDelayMs}\r`
      )
    )
  )
}

export async function switchToTypingWorkspace(orcaPage: Page, worktreeId: string): Promise<void> {
  await switchToWorktree(orcaPage, worktreeId)
  await expect.poll(() => getActiveWorktreeId(orcaPage), { timeout: 10_000 }).toBe(worktreeId)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
}

export async function cleanupHiddenPressureScenario(opts: {
  deps: { releaseTerminalAckGate: (page: Page) => Promise<void> }
  firstWorktreeId: string
  hiddenPanes: HiddenPressurePane[]
  orcaPage: Page
  pressureScriptPath: string
  secondWorktreeId: string
  typingScriptPath: string
}): Promise<void> {
  await opts.deps.releaseTerminalAckGate(opts.orcaPage)
  await switchToWorktree(opts.orcaPage, opts.firstWorktreeId).catch(() => undefined)
  await waitForActivePanePtyId(opts.orcaPage)
    .then((ptyId) => sendToTerminal(opts.orcaPage, ptyId, '\x03'))
    .catch(() => undefined)
  await switchToWorktree(opts.orcaPage, opts.secondWorktreeId).catch(() => undefined)
  await Promise.all(
    opts.hiddenPanes.map((pane) =>
      sendToTerminal(opts.orcaPage, pane.ptyId, '\x03').catch(() => undefined)
    )
  )
  rmSync(opts.typingScriptPath, { force: true })
  rmSync(opts.pressureScriptPath, { force: true })
}
