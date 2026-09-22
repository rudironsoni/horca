// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { resolveLatestAgentDoneStartedAt } from '../../components/terminal-pane/pty-connection/agent-done-started-at'
import {
  hasCodexRestartNotices,
  isCodexPaneStale
} from '../../components/terminal-pane/pty-connection/codex-pane-stale'
import {
  containsHiddenStartupRendererQuery,
  shouldKeepHiddenStartupRendererQueriesLive
} from '../../components/terminal-pane/pty-connection/hidden-startup-renderer-query'
import { isSshSessionGoneError } from '../../components/terminal-pane/pty-connection/pty-connect-limits'
import {
  scanSynchronizedForegroundOutput,
  shouldWritePtyOutputForeground
} from '../../components/terminal-pane/pty-connection/foreground-output-scan'
import { toProcessExitStartup } from '../../components/terminal-pane/pty-connection/process-exit-startup'
import {
  hasVisibleRect,
  isSetupSplitGeometryReady
} from '../../components/terminal-pane/pty-connection/setup-split-geometry'
import { STARTUP_CWD_FALLBACK_NOTICE } from '../../components/terminal-pane/pty-connection/startup-cwd-fallback-notice'
import { isAgentTaskCompleteNotificationEnabled } from '../../components/terminal-pane/pty-connection/agent-task-complete-settings'
import { resolvePaneWslDistro } from '../../components/terminal-pane/terminal-pane-wsl-distro'

describe('ghostty remote pty helpers', () => {
  it('reads the newest done timestamp from agent history', () => {
    expect(resolveLatestAgentDoneStartedAt(undefined)).toBeUndefined()
    expect(resolveLatestAgentDoneStartedAt({
      state: 'done',
      stateStartedAt: 9
    } as never)).toBe(9)
    expect(resolveLatestAgentDoneStartedAt({
      state: 'working',
      stateStartedAt: 4,
      stateHistory: [
        { state: 'done', startedAt: 2 },
        { state: 'working', startedAt: 3 }
      ]
    } as never)).toBe(2)
  })

  it('treats an empty Codex notice map as a live pane', () => {
    expect(hasCodexRestartNotices({})).toBe(false)
    expect(hasCodexRestartNotices({
      'pty-1': { previousAccountLabel: 'a', nextAccountLabel: 'b' }
    })).toBe(true)
    expect(isCodexPaneStale({ tabId: 'tab-1', worktreeId: 'wt-1', panePtyId: 'pty-1' })).toBe(false)
  })

  it('keeps a hidden OSC color query live and drops ordinary text', () => {
    expect(containsHiddenStartupRendererQuery('\x1b]10;?')).toBe(true)
    expect(containsHiddenStartupRendererQuery('hello')).toBe(false)
    expect(shouldKeepHiddenStartupRendererQueriesLive(null)).toBe(false)
    expect(shouldKeepHiddenStartupRendererQueriesLive({
      command: 'codex',
      telemetry: { agent_kind: 'codex' }
    } as never)).toBe(true)
  })

  it('retires a pane only when SSH says that PTY is gone', () => {
    expect(isSshSessionGoneError(new Error('SSH_SESSION_EXPIRED'))).toBe(true)
    expect(isSshSessionGoneError(new Error('SSH_SESSION_EXPIRED SSH_PTY_IDENTITY_MISMATCH'))).toBe(false)
    expect(isSshSessionGoneError(new Error('connection reset'))).toBe(false)
  })

  it('holds synchronized output until the end marker arrives', () => {
    expect(shouldWritePtyOutputForeground(false)).toBe(false)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(shouldWritePtyOutputForeground(true)).toBe(true)
    const started = scanSynchronizedForegroundOutput('\x1b[?2026hready', '', false)
    expect(started.started).toBe(true)
    expect(started.active).toBe(true)
    const ended = scanSynchronizedForegroundOutput('\x1b[?2026l', started.markerTail, true)
    expect(ended.ended).toBe(true)
    expect(ended.active).toBe(false)
  })

  it('maps a cold agent resume into a process-exit startup', () => {
    expect(toProcessExitStartup(null)).toBeNull()
    const plain = { command: 'ls' }
    expect(toProcessExitStartup(plain as never)).toBe(plain)
    expect(toProcessExitStartup({
      command: 'codex',
      env: { A: '1' },
      launchConfig: { kind: 'agent' },
      resumeProviderSession: true,
      launchToken: 'tok',
      agent: 'codex'
    } as never)).toMatchObject({
      command: 'codex',
      launchAgent: 'codex',
      showSessionRestoredBanner: true
    })
  })

  it('refuses a setup split until both panes have a visible box', () => {
    expect(hasVisibleRect(null)).toBe(false)
    expect(hasVisibleRect({ width: 0, height: 20 } as DOMRect)).toBe(false)
    expect(hasVisibleRect({ width: 80, height: 24 } as DOMRect)).toBe(true)
    const container = document.createElement('div')
    expect(isSetupSplitGeometryReady({
      id: 1,
      container,
      terminal: { cols: 80, rows: 24, proposeDimensions: () => ({ cols: 80, rows: 24 }) }
    } as never, { getPanes: () => [] } as never, 'vertical')).toBe(false)
  })

  it('names the saved-folder fallback and reads a WSL distro from the UNC path', () => {
    expect(STARTUP_CWD_FALLBACK_NOTICE).toContain('workspace root')
    expect(typeof isAgentTaskCompleteNotificationEnabled()).toBe('boolean')
    expect(resolvePaneWslDistro({} as never, 'wt-1', '\\\\wsl$\\Ubuntu\\home\\rudi')).toBe('Ubuntu')
  })
})
