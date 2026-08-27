import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Why: PR #52 conflicted because a fork timeout patch sat in an upstream e2e
// helper that later received the same poll wrapper. Dual-tree edits there will
// keep colliding; new fork specs belong in files upstream does not own.
// Locale JSON is the same class of hazard (issue #64): one-line Horca string
// deltas conflict every time upstream ships translations.
export const DENIED_OVERLAY_PREFIXES = ['tests/e2e/', 'src/renderer/src/i18n/locales/']

export const FORK_ONLY_PREFIXES = ['src/main/providers/multiplexer/herdr/']

export const FORK_ONLY_PATHS = new Set([
  '.github/workflows/horca_overlay_guard.yml',
  '.github/workflows/horca_shepherd.yml',
  '.github/workflows/horca_repo_admin.yml',
  '.github/workflows/horca_bump_cask.yml',
  '.github/workflows/horca_beta_release.yml',
  '.github/workflows/horca_build.yml',
  '.github/workflows/horca_check_source.yml',
  '.github/workflows/horca_release.yml',
  '.github/workflows/horca_mirror_upstream_v_tags.yml',
  'config/electron-builder-downstream.cjs',
  'src/shared/horca-vite-distribution.cjs',
  'src/shared/horca-vite-distribution.ts',
  'src/shared/horca-vite-distribution.test.ts',
  'config/horca-homebrew/.github/workflows/horca-bump-cask.yml',
  'config/horca-homebrew/Casks/horca.rb',
  'config/horca-homebrew/Casks/horca@beta.rb',
  'config/horca-homebrew/README-horca.md',
  'config/nsis/daemon-host-uninstall-horca.nsh',
  'config/scripts/electron-builder-downstream-distribution.test.mjs',
  'config/scripts/electron-vite-parallel-targets.test.mjs',
  'config/scripts/fork-scheduled-qa-workflow.test.mjs',
  'config/scripts/fork-shepherd-workflow.test.mjs',
  'config/scripts/fork-upstream-overlay-guard.mjs',
  'config/scripts/fork-upstream-overlay-guard.test.mjs',
  'config/scripts/horca-brew-style-cask.sh',
  'config/scripts/horca-brew-style-cask.test.mjs',
  'config/scripts/horca-bump-homebrew-cask.sh',
  'config/scripts/horca-bump-homebrew-cask.test.mjs',
  'config/scripts/horca-prepare-release.sh',
  'config/scripts/horca-prepare-release.test.mjs',
  'config/scripts/horca-release-skip-gate.sh',
  'config/scripts/horca-release-skip-gate.test.mjs',
  'config/scripts/horca-release-workflows.test.mjs',
  'docs/FORK_MAINTENANCE.md',
  'docs/reference/horca-distribution.md',
  'src/main/local-state-root.ts',
  'src/main/window/attach-main-window-services-store.ts',
  'src/main/local-state-root.test.ts',
  'src/main/updater-distribution-gate.test.ts',
  'src/main/updater-distribution-gate.ts',
  'src/shared/distribution-identity.json',
  'src/shared/distribution-identity.test.ts',
  'src/shared/distribution-identity.ts',
  'src/shared/horca-pairing.test.ts',
  'src/shared/distribution-update-copy.ts',
  'src/shared/distribution-update-copy.test.ts',
  'config/herdr-version.json',
  'config/scripts/download-herdr-release.mjs',
  'config/scripts/isolate-lefthook-hooks.ts',
  'config/scripts/run-herdr-stock-integration.mjs',
  'src/main/ipc/pty/ipc/terminal-layout-snapshot.ts',
  'src/main/ipc/parcel-watcher-child-recovery.test.ts',
  'src/main/persistence-herdr.test.ts',
  'src/main/runtime/orchestration/__snapshots__/preamble.test.js.snap',
  'src/renderer/src/i18n/herdr-settings-copy.ts',
  'src/renderer/src/components/settings/ProjectTerminalBackendSetting.test.tsx',
  'src/renderer/src/components/settings/ProjectTerminalBackendSetting.tsx',
  'src/renderer/src/components/settings/TerminalBackendSection.test.tsx',
  'src/renderer/src/components/settings/TerminalBackendSection.tsx',
  'src/renderer/src/components/terminal-pane/pty-logical-write.ts',
  'src/shared/herdr-session-identity.test.ts',
  'src/shared/herdr-session-identity.ts',
  'src/shared/terminal-backend.test.ts',
  'src/shared/terminal-backend.ts',
  'src/shared/terminal-logical-key.test.ts',
  'src/shared/terminal-logical-key.ts',
  'tests/e2e/helpers/herdr-terminal-runtime.ts',
  'tests/e2e/helpers/orca-restart-environment.ts',
  'tests/e2e/helpers/orca-restart.unit.test.ts',
  'tests/e2e/herdr-stock-terminal-runtime.spec.ts'
])

export const ALLOWED_OVERLAY_PATHS = new Set([
  '.github/workflows/computer-e2e.yml',
  '.github/workflows/e2e.yml',
  '.github/workflows/homebrew-bump.yml',
  '.github/workflows/pr.yml',
  '.github/workflows/terminal-ime-e2e.yml',
  '.github/workflows/terminal-perf.yml',
  '.github/workflows/track-community-prs.yaml',
  '.github/workflows/windows-signing-rehearsal.yml',
  '.gitignore',
  'config/electron-builder.config.cjs',
  'config/scripts/build-computer-macos.mjs',
  'config/scripts/build-notification-status-macos.mjs',
  'config/scripts/orca-dev.mjs',
  'config/scripts/pr-workflow-parallelism.test.mjs',
  'config/scripts/run-electron-vite-dev.mjs',
  'config/scripts/run-electron-vite-targets-in-parallel.mjs',
  'config/tsconfig.tc.web.json',
  'electron.vite.config.ts',
  'native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift',
  'native/windows-cli-launcher/OrcaCliLauncher.cs',
  'resources/darwin/bin/orca',
  'resources/win32/bin/orca.cmd',
  'src/main/bitbucket/credential-store.ts',
  'src/main/browser/browser-client-page-renderer-lifecycle.electron.test.ts',
  'src/main/browser/browser-route-egress-electron-launch.ts',
  'src/main/browser/browser-route-webrtc-egress.electron.test.ts',
  'src/main/cli/bundled-cli-launcher-path.ts',
  'src/main/cli/cli-install-constants.ts',
  'src/main/cli/cli-install-location.ts',
  'src/main/cli/windows-launcher-asset.test.ts',
  'src/main/computer/macos-computer-use-permissions.ts',
  'src/main/computer/macos-native-provider-paths.ts',
  'src/main/daemon/daemon-host-relocation.ts',
  'src/main/ipc/notification-system-settings-link.ts',
  'src/main/jira/site-credential-store.ts',
  'src/main/keybindings/keybinding-file.ts',
  'src/main/linear/linear-credential-paths.ts',
  'src/main/macos-tcc-prompt-watch.ts',
  'src/main/native-chat/transcript-watch-liveness.test.ts',
  'src/main/minimax/minimax-cookie-store.ts',
  'src/main/runtime/claude-agent-teams-shim-env.ts',
  'src/main/runtime/windows-mobile-firewall.ts',
  'src/main/windows/windows-host-job.win32.test.ts',
  'src/main/speech/model-cache-path.ts',
  'src/main/speech/openai-api-key-store.ts',
  'src/main/startup/dev-instance-identity.ts',
  'src/main/tray/system-tray.ts',
  'src/main/updater-test-harness.ts',
  'src/main/updater.startup-scheduling.test.ts',
  'src/main/updater.ts',
  'src/main/window/createMainWindow.ts',
  'src/main/window/attach-main-window-services.test.ts',
  'src/main/window/main-window-close-lifecycle.ts',
  'src/renderer/src/components/maintenance/update-card/UpdateCardStateContent.tsx',
  'src/renderer/src/components/maintenance/update-card/update-card-visibility.ts',
  'src/renderer/src/components/settings/GeneralUpdateSettingsSection.tsx',
  'src/renderer/src/lib/palette-match/palette-match-performance.test.ts',
  'src/renderer/src/web/web-pairing.ts',
  'src/shared/orca-cli-command-name.ts',
  'src/shared/pairing.ts',
  'src/shared/skill-share-link.ts',
  'src/shared/update-status-types.ts',
  'src/types/build-constants.d.ts',
  '.oxlintrc.json',
  'config/localization-coverage-allowlist.json',
  'config/scripts/release-cut-token-permissions.test.mjs',
  'config/tsconfig.cli.json',
  'config/vitest.config.ts',
  'package.json',
  'pnpm-workspace.yaml',
  'src/cli/specs/index.ts',
  'src/cli/terminal-format.test.ts',
  'src/cli/terminal-format.ts',
  'src/main/codex-accounts/runtime-home-settings-test-fixtures.ts',
  'src/main/codex-accounts/service-test-harness.ts',
  'src/main/codex/codex-trust-config-rollback.ts',
  'src/main/daemon/daemon-init-provider-installation.test.ts',
  'src/main/daemon/daemon-init.ts',
  'src/main/index.ts',
  'src/main/claude-accounts/claude-account-service-login-process.test.ts',
  'src/main/claude-accounts/claude-command-process.ts',
  'src/main/claude-accounts/claude-login-session.ts',
  'src/main/claude-accounts/keychain.test.ts',
  'src/main/claude-accounts/keychain.ts',
  'src/main/ipc/filesystem.test.ts',
  'src/main/ipc/filesystem.ts',
  'src/main/ipc/parcel-watcher-child-recovery.ts',
  'src/main/ipc/pty-startup-barrier-and-listing.test.ts',
  'src/main/ipc/pty-write-ipc-validation.test.ts',
  'src/main/ipc/pty.ts',
  'src/main/rate-limits/claude-active-usage-fetch.ts',
  'src/main/rate-limits/claude-fetcher-cli-fallback.test.ts',
  'src/main/rate-limits/claude-usage-result.ts',
  'src/main/ipc/pty/ipc/spawn-options.ts',
  'src/main/ipc/pty/ipc/spawn-types.ts',
  'src/main/ipc/pty/ipc/write-input.ts',
  'src/main/ipc/pty/provider/registry.ts',
  'src/main/ipc/pty/runtime/operations.ts',
  'src/main/ipc/pty/runtime/spawn-options.ts',
  'src/main/ipc/pty/runtime/spawn-state.ts',
  'src/main/ipc/repos-local-add-and-project-setup.test.ts',
  'src/main/ipc/repos-remote-test-harness.ts',
  'src/main/ipc/worktree-git-common-narrow-watch.ts',
  'src/main/ipc/worktree-git-common-primary-watch.ts',
  'src/main/ipc/worktree-git-common-watch.test.ts',
  'src/main/ipc/repos/repo-ipc-arg-schemas.ts',
  'src/main/ipc/ssh-app-shutdown.test.ts',
  'src/main/ipc/ssh-disconnect-cancellation.test.ts',
  'src/main/ipc/ssh-handler-reregistration.test.ts',
  'src/main/ipc/ssh-ipc-mock-shapes.ts',
  'src/main/ipc/ssh-ipc-module-mocks.ts',
  'src/main/ipc/ssh-pty-consumer-identity.test.ts',
  'src/main/ipc/ssh-relay-reset-resume.test.ts',
  'src/main/ipc/ssh-state-broadcast-fanout.test.ts',
  'src/main/ipc/ssh-target-registry.test.ts',
  'src/main/ipc/ssh-terminate-sessions.test.ts',
  'src/main/ipc/ssh.test.ts',
  'src/main/persistence/applying-settings/settings-update.ts',
  'src/main/persistence/loading-store/loaded-state-parsing.ts',
  'src/main/persistence/loading-store/normalize-loaded-global-settings.ts',
  'src/main/persistence/tracking-repos/project-host-compatibility.ts',
  'src/main/persistence/tracking-repos/project-host-operations.ts',
  'src/main/providers/pty-provider-contract.ts',
  'src/main/runtime/claude-agent-teams-service.test.ts',
  'src/main/runtime/headless-terminal-split-layout.test.ts',
  'src/main/runtime/headless-terminal-split-layout.ts',
  'src/main/runtime/orca-runtime.test.ts',
  'src/main/runtime/orca-runtime.ts',
  'src/main/runtime/rpc/methods/project-runtime-rpc-methods.ts',
  'src/main/ssh/ssh-relay-session-agent-hooks.integration.test.ts',
  'src/main/ssh/ssh-relay-session-data-delivery.test.ts',
  'src/main/ssh/ssh-relay-session-incarnation.test.ts',
  'src/main/ssh/ssh-relay-session-model-migration.test.ts',
  'src/main/ssh/ssh-relay-session-reconnect-incarnation.test.ts',
  'src/main/ssh/ssh-relay-session-recovery-races.test.ts',
  'src/main/ssh/ssh-relay-session-terminal-error.test.ts',
  'src/main/ssh/ssh-relay-session-test-fixtures.ts',
  'src/main/ssh/ssh-relay-session.test.ts',
  'src/main/ssh/ssh-relay-session.ts',
  'src/main/startup/desktop-startup-ordering.test.ts',
  'src/main/startup/legacy-worker-renderer-recovery.test.ts',
  'src/main/startup/legacy-worker-renderer-recovery.ts',
  'src/preload/api/pty-api.ts',
  'src/preload/api/ui-command-event-api.ts',
  'src/preload/index.ts',
  'src/renderer/src/components/settings/RepositoryPane.tsx',
  'src/renderer/src/components/settings/TerminalPane.tsx',
  'src/renderer/src/components/settings/terminal-search.ts',
  'src/renderer/src/components/terminal-pane/TerminalPane.tsx',
  'src/renderer/src/components/terminal-pane/ipc-pty-accepted-input.ts',
  'src/renderer/src/components/terminal-pane/ipc-pty-spawn-request.ts',
  'src/renderer/src/components/terminal-pane/pty-connection-types.ts',
  'src/renderer/src/components/terminal-pane/pty-connection.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/connect-pane-pty.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/foreground-output-refresh.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/foreground-output-scan.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/fresh-spawn-start.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-output-restore-drain.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-output-restore-request.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-output-restore-snapshot.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-output-seq-and-skip.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-output-snapshot-serialize.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/hidden-restore-state-and-ssh-probe.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/live-data-callback.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/pane-pty-binding.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/pty-input-recovery.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/session-reconcile-dispose.ts',
  'src/renderer/src/components/terminal-pane/pty-connection/write-pty-output-to-xterm.ts',
  'src/renderer/src/components/terminal-pane/pty-transport-connect-spawn.test.ts',
  'src/renderer/src/components/terminal-pane/pty-transport-input-write.test.ts',
  'src/renderer/src/components/terminal-pane/pty-transport-types.ts',
  'src/renderer/src/components/terminal-pane/pty-transport.ts',
  'src/renderer/src/components/terminal-pane/use-terminal-pane-lifecycle.ts',
  'src/renderer/src/hooks/ipc-events-agent-status-window-test-fixtures.ts',
  'src/renderer/src/hooks/ipc-events-close-routing-test-harness.ts',
  'src/renderer/src/hooks/ipc-events-terminal-create-window-test-fixtures.ts',
  'src/renderer/src/hooks/ipc-events/terminal-ui-routing-ipc-bridge.ts',
  'src/renderer/src/hooks/useIpcEvents-browser-tab-create.test.ts',
  'src/renderer/src/hooks/useIpcEvents-cli-worktree-activation.test.ts',
  'src/renderer/src/hooks/useIpcEvents-close-routing-browser-pages.test.ts',
  'src/renderer/src/hooks/useIpcEvents-lifecycle.test.ts',
  'src/renderer/src/hooks/useIpcEvents-ssh-disconnect-cleanup.test.ts',
  'src/renderer/src/hooks/useIpcEvents-updater-status.test.ts',
  'src/renderer/src/web/preload-api/web-ui-api.ts',
  'src/shared/child-process/run-process.test.ts',
  'src/shared/child-process/run-process.ts',
  'src/shared/constants.ts',
  'src/shared/global-settings-types.ts',
  'src/shared/host-setting-overrides.ts',
  'src/shared/posix-command-path-lookup.test.ts',
  'src/shared/project-identity-succession.ts',
  'src/shared/project-types.ts',
  'src/shared/runtime-terminal-contracts.ts'
])

export function isDeniedOverlayPath(filePath) {
  return DENIED_OVERLAY_PREFIXES.some(
    (prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix)
  )
}

export function isForkOnlyPath(filePath) {
  return (
    FORK_ONLY_PATHS.has(filePath) ||
    FORK_ONLY_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  )
}

export function classifyForkPath(filePath, kind) {
  if (kind === 'overlay' && isDeniedOverlayPath(filePath)) {
    return 'denied'
  }
  if (kind === 'fork-only' && isForkOnlyPath(filePath)) {
    return 'allowed'
  }
  if (kind === 'overlay' && ALLOWED_OVERLAY_PATHS.has(filePath)) {
    return 'allowed'
  }
  return 'unexpected'
}

export function allowlistIntegrityErrors() {
  const errors = []
  for (const filePath of ALLOWED_OVERLAY_PATHS) {
    if (isForkOnlyPath(filePath)) {
      errors.push(`${filePath} cannot be both fork-only and an overlay`)
    }
    if (isDeniedOverlayPath(filePath)) {
      errors.push(`${filePath} is a denied overlay path`)
    }
  }
  return errors
}

// Why: scheduled Shepherd lists the whole tree. 18k paths already sit on
// Node's 1 MiB spawnSync default and fail with ENOBUFS (run 32965027180).
export const GIT_LIST_MAX_BUFFER = 32 * 1024 * 1024

function gitLines(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: GIT_LIST_MAX_BUFFER
  })
    .split('\n')
    .filter(Boolean)
}

function gitBlob(ref, filePath) {
  return execFileSync('git', ['rev-parse', `${ref}:${filePath}`], {
    encoding: 'utf8'
  }).trim()
}

export function inspectForkOverlay(ours, theirs) {
  const oursFiles = new Set(gitLines(['ls-tree', '-r', '--name-only', ours]))
  const theirsFiles = new Set(gitLines(['ls-tree', '-r', '--name-only', theirs]))
  // Three-dot: files this fork changed since the merge-base. Upstream-only
  // commits must not fail the guard — that is the normal "mirror is ahead"
  // state and used to block every sync PR.
  const changed = gitLines(['diff', '--name-only', `${theirs}...${ours}`])
  const findings = []

  for (const filePath of changed) {
    const onOurs = oursFiles.has(filePath)
    const onTheirs = theirsFiles.has(filePath)
    if (onOurs && onTheirs) {
      // Why: three-dot still lists a path we touched then restored. Matching
      // blobs are not an overlay (locale JSON after dropping Herdr keys).
      if (gitBlob(ours, filePath) === gitBlob(theirs, filePath)) {
        continue
      }
      findings.push({ filePath, kind: 'overlay', status: classifyForkPath(filePath, 'overlay') })
      continue
    }
    if (onOurs && !onTheirs) {
      findings.push({
        filePath,
        kind: 'fork-only',
        status: classifyForkPath(filePath, 'fork-only')
      })
      continue
    }
    if (onTheirs) {
      findings.push({ filePath, kind: 'upstream-only', status: 'unexpected' })
    }
    // Merge-base path dropped on both trees: three-dot still lists the delete.
  }

  const observedOverlays = new Set(
    findings.filter((finding) => finding.kind === 'overlay').map((finding) => finding.filePath)
  )
  const observedForkOnly = new Set(
    findings.filter((finding) => finding.kind === 'fork-only').map((finding) => finding.filePath)
  )

  for (const filePath of ALLOWED_OVERLAY_PATHS) {
    if (!observedOverlays.has(filePath)) {
      findings.push({ filePath, kind: 'stale-overlay', status: 'unexpected' })
    }
  }
  for (const filePath of FORK_ONLY_PATHS) {
    if (!observedForkOnly.has(filePath)) {
      findings.push({ filePath, kind: 'stale-fork-only', status: 'unexpected' })
    }
  }

  return findings
}

export function formatForkOverlayFailures(findings) {
  return findings
    .filter((finding) => finding.status !== 'allowed')
    .map((finding) => `${finding.status} ${finding.kind}: ${finding.filePath}`)
}

function parseRefArgs(argv) {
  let ours = 'HEAD'
  let theirs
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--ours' && value) {
      ours = value
      index += 1
      continue
    }
    if (flag === '--theirs' && value) {
      theirs = value
      index += 1
    }
  }
  if (!theirs) {
    throw new Error('Missing --theirs <ref>. Fetch stablyai/orca main and pass that commit.')
  }
  return { ours, theirs }
}

export function runForkOverlayGuard(argv = process.argv.slice(2)) {
  const integrity = allowlistIntegrityErrors()
  if (integrity.length > 0) {
    process.stderr.write(`${integrity.join('\n')}\n`)
    return 1
  }

  const { ours, theirs } = parseRefArgs(argv)
  const failures = formatForkOverlayFailures(inspectForkOverlay(ours, theirs))
  if (failures.length > 0) {
    process.stderr.write(`${failures.join('\n')}\n`)
    return 1
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(runForkOverlayGuard())
}
