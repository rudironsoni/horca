import type { Page } from '@stablyai/playwright-test'
import { randomUUID } from 'node:crypto'
import { expect } from './helpers/orca-app'
import { ensureTerminalVisible, getActiveWorktreeId, switchToWorktree } from './helpers/store'
import {
  getTerminalContent,
  readPaneIdentitySnapshot,
  sendToTerminal,
  splitActiveTerminalPane,
  UUID_RE,
  waitForActiveTerminalManager,
  type PaneIdentitySnapshot
} from './helpers/terminal'

export type TerminalLoadPane = {
  paneKey: string
  ptyId: string
}

export async function focusActiveTerminalInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window.__store
    const state = store?.getState()
    const worktreeId = state?.activeWorktreeId
    const tabId =
      state?.activeTabType === 'terminal'
        ? state.activeTabId
        : worktreeId
          ? (state?.activeTabIdByWorktree?.[worktreeId] ?? null)
          : null
    const manager = tabId ? window.__paneManagers?.get(tabId) : null
    const pane = manager?.getActivePane?.() ?? manager?.getPanes?.()[0] ?? null
    const textarea = pane?.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
    if (!pane || !textarea) {
      throw new Error('Active terminal input is unavailable')
    }
    pane.terminal.focus()
    textarea.focus()
  })
}

export async function focusPane(page: Page, paneKey: string): Promise<void> {
  const separator = paneKey.indexOf(':')
  const tabId = paneKey.slice(0, separator)
  const leafId = paneKey.slice(separator + 1)
  await page.evaluate(
    ({ tabId, leafId }) => {
      const manager = window.__paneManagers?.get(tabId)
      const pane = manager?.getPanes?.().find((candidate) => candidate.leafId === leafId)
      if (!manager || !pane) {
        throw new Error(`Unable to focus pane ${tabId}:${leafId}`)
      }
      manager.setActivePane?.(pane.id, { focus: true })
    },
    { tabId, leafId }
  )
}

export async function waitForTerminalPtyVisible(
  page: Page,
  ptyId: string,
  timeoutMs = 10_000
): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((targetPtyId) => {
          for (const manager of window.__paneManagers?.values() ?? []) {
            const pane = manager
              .getPanes?.()
              .find((candidate) => candidate.container.dataset.ptyId === targetPtyId)
            if (pane) {
              return pane.container.isConnected && pane.container.getClientRects().length > 0
            }
          }
          return false
        }, ptyId),
      {
        timeout: timeoutMs,
        message: `Terminal PTY ${ptyId} did not become visible`
      }
    )
    .toBe(true)
}

export async function ensureActiveWorktreePaneLoad(
  page: Page,
  paneCount: number
): Promise<TerminalLoadPane[]> {
  await ensureTerminalVisible(page)
  await waitForActiveTerminalManager(page, 30_000)
  const worktreeId = await getActiveWorktreeId(page)
  if (!worktreeId) {
    throw new Error('Active worktree is unavailable for terminal pane load')
  }
  let snapshot = await waitForActiveWorktreePaneLoad(page, worktreeId, 1)
  while (snapshot.panes.length < paneCount) {
    await splitActiveTerminalPane(page, snapshot.panes.length % 2 === 0 ? 'horizontal' : 'vertical')
    snapshot = await waitForActiveWorktreePaneLoad(page, worktreeId, snapshot.panes.length + 1)
  }
  return snapshot.panes.slice(0, paneCount).map((pane) => ({
    paneKey: `${snapshot.tabId}:${pane.leafId}`,
    ptyId: pane.ptyId ?? ''
  }))
}

async function waitForActiveWorktreePaneLoad(
  page: Page,
  worktreeId: string,
  paneCount: number
): Promise<PaneIdentitySnapshot> {
  let snapshot: PaneIdentitySnapshot | null = null
  try {
    await expect
      .poll(
        async () => {
          if ((await getActiveWorktreeId(page)) !== worktreeId) {
            // Why: late session reconciliation can clear selection while split PTYs bind.
            await switchToWorktree(page, worktreeId)
            await ensureTerminalVisible(page)
            await waitForActiveTerminalManager(page, 30_000)
          }
          snapshot = await readPaneIdentitySnapshot(page)
          return Boolean(
            snapshot &&
            snapshot.panes.length === paneCount &&
            snapshot.panes.every(
              (pane) =>
                UUID_RE.test(pane.leafId) &&
                pane.stablePaneId === pane.leafId &&
                pane.datasetLeafId === pane.leafId &&
                pane.ptyId !== null &&
                snapshot?.ptyIdsByLeafId[pane.leafId] === pane.ptyId
            )
          )
        },
        {
          timeout: 30_000,
          message: 'Artificial load panes did not settle with stable PTY bindings'
        }
      )
      .toBe(true)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)} want=${paneCount}`)
  }
  if (!snapshot) {
    throw new Error('Artificial load pane snapshot is unavailable')
  }
  return snapshot
}

function terminalTextContains(haystack: string, needle: string): boolean {
  return haystack.replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))
}

async function readPaneTexts(page: Page): Promise<{ ptyId: string; text: string }[]> {
  return page.evaluate(() => {
    const rows: { ptyId: string; text: string }[] = []
    for (const manager of window.__paneManagers?.values() ?? []) {
      for (const pane of manager.getPanes?.() ?? []) {
        const ptyId = pane.container?.dataset?.ptyId
        if (!ptyId) {
          continue
        }
        const engine = (pane.terminal as { engine?: { readViewportText?: () => string } }).engine
        rows.push({
          ptyId,
          text: `${engine?.readViewportText?.() ?? ''}\n${pane.serializeController?.serialize?.() ?? ''}`
        })
      }
    }
    return rows
  })
}

async function readViewportText(page: Page, ptyId?: string): Promise<string> {
  if (!ptyId) {
    return getTerminalContent(page, 12_000)
  }
  return page.evaluate((ptyId) => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      for (const pane of manager.getPanes?.() ?? []) {
        if (pane.container?.dataset?.ptyId === ptyId) {
          const engine = (pane.terminal as { engine?: { readViewportText?: () => string } }).engine
          return engine?.readViewportText?.() ?? ''
        }
      }
    }
    return ''
  }, ptyId)
}

export async function waitForMarkerLatency(
  page: Page,
  marker: string,
  timeoutMs: number,
  ptyId?: string
): Promise<number> {
  const start = performance.now()
  while (performance.now() - start < timeoutMs) {
    if (terminalTextContains(await readViewportText(page, ptyId), marker)) {
      return performance.now() - start
    }
    if (ptyId && terminalTextContains(await getTerminalContentForPtyId(page, ptyId), marker)) {
      return performance.now() - start
    }
    await page.waitForTimeout(16)
  }
  throw new Error(`Timed out waiting for terminal marker ${marker}`)
}

export async function findPtyIdWithMarker(page: Page, marker: string): Promise<string | null> {
  const match = (await readPaneTexts(page)).find((pane) => terminalTextContains(pane.text, marker))
  return match?.ptyId ?? null
}

export async function bindLiveTypingPane(
  page: Page,
  panes: TerminalLoadPane[]
): Promise<{ typingPane: TerminalLoadPane; loadPanes: TerminalLoadPane[] }> {
  const marker = `OPENCODE_SHELL_ALIVE_${randomUUID()}`
  for (const pane of panes) {
    await sendToTerminal(page, pane.ptyId, `echo ${marker}\r`)
  }
  let typingPtyId: string | null = null
  await expect
    .poll(
      async () => {
        typingPtyId = await findPtyIdWithMarker(page, marker)
        return typingPtyId
      },
      { timeout: 10_000, message: 'no post-split pane executed a shell echo' }
    )
    .not.toBeNull()
  const typingPane =
    panes.find((pane) => pane.ptyId === typingPtyId) ?? panes.find((pane) => pane.ptyId)
  if (!typingPane?.ptyId) {
    throw new Error('post-split live PTY is missing from the load snapshot')
  }
  return {
    typingPane,
    loadPanes: panes.filter((pane) => pane.ptyId !== typingPane.ptyId)
  }
}

export async function focusTerminalPaneByPtyId(page: Page, ptyId: string): Promise<void> {
  await page.evaluate((ptyId) => {
    for (const manager of window.__paneManagers?.values() ?? []) {
      for (const pane of manager.getPanes?.() ?? []) {
        if (pane.container?.dataset?.ptyId !== ptyId) {
          continue
        }
        manager.setActivePane?.(pane.id, { focus: true })
        const textarea = pane.container.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
        pane.terminal.focus()
        textarea?.focus()
        return
      }
    }
    throw new Error(`No terminal pane for PTY ${ptyId}`)
  }, ptyId)
}

export async function getTerminalContentForPtyId(
  page: Page,
  ptyId: string,
  charLimit = 12_000
): Promise<string> {
  const match = (await readPaneTexts(page)).find((pane) => pane.ptyId === ptyId)
  return (match?.text ?? '').slice(-charLimit)
}

export async function waitForTerminalOutputForPtyId(
  page: Page,
  ptyId: string,
  expected: string,
  timeoutMs: number
): Promise<void> {
  await expect
    .poll(
      async () => {
        if (terminalTextContains(await getTerminalContentForPtyId(page, ptyId), expected)) {
          return true
        }
        if (terminalTextContains(await getTerminalContent(page, 12_000), expected)) {
          return true
        }
        const main = await page.evaluate(async (ptyId) => {
          const snap = await window.api.pty.getMainBufferSnapshot(ptyId, { scrollbackRows: 200 })
          return snap?.data ?? ''
        }, ptyId)
        return terminalTextContains(main, expected)
      },
      { timeout: timeoutMs, message: `Terminal PTY ${ptyId} did not contain "${expected}"` }
    )
    .toBe(true)
}
