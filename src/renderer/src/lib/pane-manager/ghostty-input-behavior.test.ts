// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { shouldSeedCacheTimerOnInitialTitle } from '../../components/terminal-pane/cache-timer-seeding'
import { isHangulJamoKeyText } from '../../components/terminal-pane/hangul-jamo-key'
import {
  armTerminalImePendingCandidateKeyRelease,
  clearTerminalImePendingCandidateKeyRelease,
  createTerminalImePendingCandidateKeyReleases,
  isTerminalImeCandidateDigitKeyEvent,
  shouldApplyTerminalImePendingCandidateKeyRelease
} from '../../components/terminal-pane/terminal-ime-candidate-key-release-guard'
import {
  TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS,
  TERMINAL_IME_CANDIDATE_GUARD_STALE_COMPOSITION_EXPIRY_MS
} from '../../components/terminal-pane/terminal-ime-composition-tracker'
import {
  getTerminalImeModifiedEnterKind,
  isTerminalImeConsumedKey,
  isTerminalImeEnterKeyUp,
  isTerminalImeProcessEnter
} from '../../components/terminal-pane/terminal-ime-deferred-newline'
import { encodeImeCommitForKitty } from '../../components/terminal-pane/terminal-ime-kitty-commit-encoding'
import {
  isDocumentBodyOrNull,
  isTerminalImeInputContextRefreshing
} from '../../components/terminal-pane/terminal-ime-input-context-refresh'
import {
  clearTerminalTabColdParkRecheckTimers,
  reconcileTerminalTabColdParkRecheckTimers
} from '../../components/terminal-pane/terminal-cold-park-recheck-timers'
import {
  requestCapturedTerminalReconfirmation,
  sendCapturedTerminalInput
} from '../../components/terminal-pane/terminal-captured-input-dispatch'
import {
  isEditableTarget,
  matchSearchNavigate
} from '../../components/terminal-pane/terminal-keyboard-shortcut-matching'
import { resolvePaneKeyboardProtocolAgent } from '../../components/terminal-pane/terminal-keyboard-protocol-pane-agent'
import { resolveTerminalKeyboardPane } from '../../components/terminal-pane/terminal-keyboard-pane-resolution'
import { keyboardEventBelongsToScope } from '../../components/terminal-pane/terminal-keyboard-scope'
import { runTerminalPasteOperationWithTimeout } from '../../components/terminal-pane/terminal-paste-operation-timeout'
import {
  isRemoteRuntimePastePtyId,
  isWslShellOverride,
  resolveTerminalPasteRuntime
} from '../../components/terminal-pane/terminal-paste-runtime'
import {
  REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS,
  REMOTE_RUNTIME_RECOVERY_ATTEMPT_BUDGET_MS,
  REMOTE_RUNTIME_RECOVERY_DELAYS_MS
} from '../../components/terminal-pane/remote-runtime-pty-recovery-state'
import { resolveCursorAgentImeAnchor } from './terminal-ime-anchor'
import {
  buildTerminalKeyboardProtocolOptions,
  prefersKittyKeyboardDespiteWindowsConpty,
  shouldDisableKittyKeyboardForTerminal
} from './terminal-keyboard-protocol'
import {
  isGenuineWindowsCtrlAltChord,
  shouldRepairWindowsCtrlAltChords
} from './terminal-windows-ctrl-alt-chord-classification'
import { recordKeystroke } from '../typing-latency/echo-instrumentation'

describe('ghostty input behavior', () => {
  it('recognizes one Hangul jamo and rejects a latin letter', () => {
    expect(isHangulJamoKeyText('ᄀ')).toBe(true)
    expect(isHangulJamoKeyText('a')).toBe(false)
    expect(isHangulJamoKeyText('가나')).toBe(false)
  })

  it('refuses the cache-timer seed when the pane is not an initial idle reattach', () => {
    expect(
      shouldSeedCacheTimerOnInitialTitle({
        rawTitle: 'Claude',
        allowInitialIdleSeed: false,
        existingTimerStartedAt: null,
        promptCacheTimerEnabled: true
      })
    ).toBe(false)
  })

  it('keeps a key in scope only when the target or the active element is inside it', () => {
    const scope = document.createElement('div')
    const child = document.createElement('span')
    const outside = document.createElement('span')
    scope.appendChild(child)
    document.body.append(scope, outside)
    const inside = new KeyboardEvent('keydown')
    Object.defineProperty(inside, 'target', { value: child })
    expect(keyboardEventBelongsToScope(inside, scope)).toBe(true)
    outside.focus()
    const missing = new KeyboardEvent('keydown')
    Object.defineProperty(missing, 'target', { value: null })
    expect(keyboardEventBelongsToScope(missing, scope)).toBe(false)
  })

  it('classifies IME enter chords and a consumed process key', () => {
    expect(
      getTerminalImeModifiedEnterKind({
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      })
    ).toBe('shift')
    expect(
      getTerminalImeModifiedEnterKind({
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
        altKey: false
      })
    ).toBe('ctrl')
    expect(
      getTerminalImeModifiedEnterKind({
        shiftKey: true,
        ctrlKey: true,
        metaKey: false,
        altKey: false
      })
    ).toBeNull()
    expect(isTerminalImeConsumedKey({ key: 'Process', keyCode: 229 })).toBe(true)
    expect(isTerminalImeEnterKeyUp({ key: 'Enter', keyCode: 13 })).toBe(true)
    expect(
      isTerminalImeProcessEnter({
        key: 'Process',
        keyCode: 229,
        code: 'Enter',
        shiftKey: true,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      })
    ).toBe(true)
  })

  it('emits no kitty report when the IME commit has no press', () => {
    expect(encodeImeCommitForKitty(null, 0, { committedText: 'é' })).toEqual({
      report: null,
      release: null
    })
  })

  it('keeps kitty keyboard on for Grok and for a non-Windows pane', () => {
    expect(prefersKittyKeyboardDespiteWindowsConpty('grok')).toBe(true)
    expect(prefersKittyKeyboardDespiteWindowsConpty('codex')).toBe(false)
    const mac = {
      executionHostId: 'ssh-host' as never,
      tuiAgent: null,
      platform: 'darwin' as const
    }
    expect(shouldDisableKittyKeyboardForTerminal(mac as never)).toBe(false)
    expect(buildTerminalKeyboardProtocolOptions(mac as never)).toEqual({})
    expect(
      shouldDisableKittyKeyboardForTerminal({ ...mac, tuiAgent: 'grok' } as never)
    ).toBe(false)
  })

  it('treats Ctrl+Alt without AltGraph as a real Windows chord on Chrome', () => {
    expect(
      isGenuineWindowsCtrlAltChord({
        ctrlKey: true,
        altKey: true,
        metaKey: false,
        getModifierState: () => false
      })
    ).toBe(true)
    expect(
      isGenuineWindowsCtrlAltChord({
        ctrlKey: true,
        altKey: true,
        metaKey: false,
        getModifierState: (name) => name === 'AltGraph'
      })
    ).toBe(false)
    expect(
      shouldRepairWindowsCtrlAltChords(
        'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0'
      )
    ).toBe(true)
    expect(shouldRepairWindowsCtrlAltChords('Mozilla/5.0 (Macintosh) Chrome/120')).toBe(false)
  })

  it('plans paste for a remote pty, a WSL shell, and a local mac pane', () => {
    expect(isRemoteRuntimePastePtyId('remote:pane-1')).toBe(true)
    expect(isWslShellOverride('C:\\Windows\\System32\\wsl.exe')).toBe(true)
    expect(isWslShellOverride('/bin/zsh')).toBe(false)
    expect(
      resolveTerminalPasteRuntime({ platform: 'darwin', ptyId: 'remote:pane-1' })
    ).toMatchObject({ kind: 'remote-runtime', runtimeKey: 'remote:remote:pane-1' })
    expect(
      resolveTerminalPasteRuntime({
        platform: 'darwin',
        ptyId: 'pty-1',
        transport: { getLocalSessionMetadata: () => ({ shellOverride: 'wsl.exe' }) }
      })
    ).toMatchObject({ kind: 'wsl', runtimeKey: 'wsl:default' })
    expect(resolveTerminalPasteRuntime({ platform: 'darwin', ptyId: 'pty-1' })).toMatchObject({
      kind: 'local',
      runtimeKey: 'local:darwin'
    })
  })

  it('ignores the xterm helper and navigates search with Cmd-G', () => {
    const helper = document.createElement('textarea')
    helper.className = 'xterm-helper-textarea'
    const field = document.createElement('input')
    document.body.append(helper, field)
    expect(isEditableTarget(helper)).toBe(false)
    expect(isEditableTarget(field)).toBe(true)
    const search = { query: 'name', caseSensitive: false, regex: false }
    expect(
      matchSearchNavigate(
        { key: 'g', metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
        true,
        true,
        search
      )
    ).toBe('next')
    expect(
      matchSearchNavigate(
        { key: 'g', metaKey: true, ctrlKey: false, shiftKey: true, altKey: false },
        true,
        true,
        search
      )
    ).toBe('previous')
    expect(
      matchSearchNavigate(
        { key: 'g', metaKey: true, ctrlKey: false, shiftKey: false, altKey: true },
        true,
        true,
        search
      )
    ).toBeNull()
  })

  it('holds a candidate digit until its keyup and then clears it', () => {
    expect(TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS).toBe(250)
    expect(TERMINAL_IME_CANDIDATE_GUARD_STALE_COMPOSITION_EXPIRY_MS).toBe(10_000)
    const releases = createTerminalImePendingCandidateKeyReleases()
    const down = { type: 'keydown', key: '1', repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }
    expect(isTerminalImeCandidateDigitKeyEvent(down as never)).toBe(true)
    armTerminalImePendingCandidateKeyRelease(releases, down as never, 1_000)
    expect(
      shouldApplyTerminalImePendingCandidateKeyRelease(
        { type: 'keyup', key: '1' } as never,
        releases,
        1_100
      )
    ).toBe(true)
    clearTerminalImePendingCandidateKeyRelease(releases, { type: 'keyup', key: '1' } as never)
    expect(releases.has('1')).toBe(false)
  })

  it('uses the focused pane and falls back to the active pane', () => {
    const host = document.createElement('div')
    const target = document.createElement('span')
    host.appendChild(target)
    const focused = { id: 2, terminal: { element: host } }
    const active = { id: 1, terminal: { element: document.createElement('div') } }
    const manager = {
      getPanes: () => [active, focused],
      getActivePane: () => active
    }
    expect(resolveTerminalKeyboardPane(manager as never, target)?.id).toBe(2)
    expect(resolveTerminalKeyboardPane(manager as never, null)?.id).toBe(1)
  })

  it('drops a cold-park timer whose deadline moved', () => {
    const timers = new Map<string, { timerId: number; deadlineMs: number }>()
    let fired = 0
    reconcileTerminalTabColdParkRecheckTimers({
      timers,
      deadlineMsByTabId: new Map([['tab-1', 50]]),
      nowMs: 0,
      onDeadline: () => {
        fired += 1
      }
    })
    expect(timers.get('tab-1')?.deadlineMs).toBe(50)
    clearTerminalTabColdParkRecheckTimers(timers)
    expect(timers.size).toBe(0)
    expect(fired).toBe(0)
  })

  it('sends captured input only on the transport that still owns the pty', () => {
    const accepted: string[] = []
    const transport = {
      getPtyId: () => 'pty-1',
      sendInput: (data: string) => {
        accepted.push(data)
        return true
      }
    }
    expect(
      sendCapturedTerminalInput({
        targetPaneMounted: true,
        currentTransport: transport as never,
        capturedTransport: transport as never,
        capturedPtyId: 'pty-1',
        data: 'é',
        onAccepted: () => accepted.push('ok')
      })
    ).toBe(true)
    expect(accepted).toEqual(['é', 'ok'])
    expect(
      sendCapturedTerminalInput({
        targetPaneMounted: false,
        currentTransport: transport as never,
        capturedTransport: transport as never,
        capturedPtyId: 'pty-1',
        data: 'no'
      })
    ).toBe(false)
    let reconfirmed = 0
    const binding = {
      requestWindowsShiftEnterReconfirmation: () => {
        reconfirmed += 1
      }
    }
    requestCapturedTerminalReconfirmation(binding, binding)
    expect(reconfirmed).toBe(1)
  })

  it('uses the startup agent and otherwise the tab launch agent', () => {
    expect(resolvePaneKeyboardProtocolAgent({ launchAgent: 'grok' }, 'codex')).toBe('grok')
    expect(resolvePaneKeyboardProtocolAgent(null, 'codex')).toBeNull()
    expect(resolvePaneKeyboardProtocolAgent(undefined, 'codex')).toBe('codex')
  })

  it('returns a paste value when the timeout is not positive', async () => {
    await expect(runTerminalPasteOperationWithTimeout(() => 'é', 0)).resolves.toEqual({
      timedOut: false,
      value: 'é'
    })
  })

  it('does not refresh the ime context for a body that is not a helper', () => {
    expect(isTerminalImeInputContextRefreshing(document.body)).toBe(false)
    expect(isDocumentBodyOrNull(document.body, document)).toBe(true)
    expect(isDocumentBodyOrNull(null, document)).toBe(true)
  })

  it('returns no cursor-agent anchor when the cursor is not in column zero', () => {
    expect(
      resolveCursorAgentImeAnchor({
        buffer: { getLine: () => undefined, baseY: 0 } as never,
        rows: 24,
        cols: 80,
        cursorX: 3,
        cursorY: 1
      })
    ).toBeNull()
  })

  it('records one undispatched keystroke and can drop it before paint', () => {
    const entry = {
      pane: null,
      undispatched: [],
      nextDispatch: null,
      deferredNextDispatch: null,
      ignoredDispatches: [],
      ignoredDispatchOverflowedAt: null,
      awaitingEcho: [],
      attributionGap: false,
      parsingBatch: null,
      parsedBatches: [],
      pendingCount: 0,
      disposables: [],
      restoreWrite: null
    }
    const recorded = recordKeystroke(entry as never, 10, 'direct', 'é')
    expect(entry.pendingCount).toBe(1)
    expect(recorded.candidate.text).toBe('é')
  })

  it('sums the remote recovery ladder into the auto-recovery window', () => {
    expect(REMOTE_RUNTIME_RECOVERY_DELAYS_MS[0]).toBe(250)
    expect(REMOTE_RUNTIME_RECOVERY_ATTEMPT_BUDGET_MS).toBe(15_000)
    const expected =
      REMOTE_RUNTIME_RECOVERY_DELAYS_MS.reduce((total, delay) => total + delay, 0) +
      REMOTE_RUNTIME_RECOVERY_DELAYS_MS.length * REMOTE_RUNTIME_RECOVERY_ATTEMPT_BUDGET_MS
    expect(REMOTE_RUNTIME_AUTO_RECOVERY_TIMEOUT_MS).toBe(expected)
  })
})
