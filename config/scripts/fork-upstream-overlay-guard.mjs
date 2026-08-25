import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

// Why: PR #52 conflicted because a fork timeout patch sat in an upstream e2e
// helper that later received the same poll wrapper. Dual-tree edits there will
// keep colliding; new fork specs belong in files upstream does not own.
// Locale JSON is the same class of hazard (issue #64): one-line Horca string
// deltas conflict every time upstream ships translations.
export const DENIED_OVERLAY_PREFIXES = ['tests/e2e/', 'src/renderer/src/i18n/locales/']

export const FORK_ONLY_PATHS = new Set([
  '.github/workflows/fork-overlay-guard.yml',
  '.github/workflows/fork-shepherd.yml',
  '.github/workflows/horca-repo-admin.yml',
  '.github/workflows/bump-horca-cask.yml',
  '.github/workflows/horca-beta-release.yml',
  '.github/workflows/horca-build.yml',
  '.github/workflows/horca-check-source.yml',
  '.github/workflows/horca-release.yml',
  '.github/workflows/mirror-upstream-v-tags.yml',
  'config/electron-builder-downstream.cjs',
  'config/horca-homebrew/.github/workflows/bump-horca-cask.yml',
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
  'config/scripts/horca-bump-homebrew-cask.sh',
  'config/scripts/horca-bump-homebrew-cask.test.mjs',
  'config/scripts/horca-prepare-release.sh',
  'config/scripts/horca-prepare-release.test.mjs',
  'config/scripts/horca-release-workflows.test.mjs',
  'docs/FORK_MAINTENANCE.md',
  'docs/reference/horca-distribution.md',
  'src/main/local-state-root.ts',
  'src/main/updater-distribution-gate.test.ts',
  'src/main/updater-distribution-gate.ts',
  'src/shared/distribution-identity.json',
  'src/shared/distribution-identity.test.ts',
  'src/shared/distribution-identity.ts',
  'src/shared/horca-pairing.test.ts',
  'src/shared/distribution-update-copy.ts',
  'src/shared/distribution-update-copy.test.ts'
])

export const ALLOWED_OVERLAY_PATHS = new Set([
  '.github/workflows/computer-e2e.yml',
  '.github/workflows/e2e.yml',
  '.github/workflows/homebrew-bump.yml',
  '.github/workflows/terminal-ime-e2e.yml',
  '.github/workflows/terminal-perf.yml',
  '.github/workflows/track-community-prs.yaml',
  '.github/workflows/windows-signing-rehearsal.yml',
  '.gitignore',
  'config/electron-builder.config.cjs',
  'config/scripts/build-computer-macos.mjs',
  'config/scripts/build-notification-status-macos.mjs',
  'config/scripts/run-electron-vite-targets-in-parallel.mjs',
  'config/tsconfig.tc.web.json',
  'electron.vite.config.ts',
  'native/computer-use-macos/Sources/OrcaComputerUseMacOS/main.swift',
  'native/windows-cli-launcher/OrcaCliLauncher.cs',
  'resources/darwin/bin/orca',
  'resources/win32/bin/orca.cmd',
  'src/main/bitbucket/credential-store.ts',
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
  'src/main/minimax/minimax-cookie-store.ts',
  'src/main/runtime/claude-agent-teams-shim-env.ts',
  'src/main/runtime/windows-mobile-firewall.ts',
  'src/main/speech/model-cache-path.ts',
  'src/main/speech/openai-api-key-store.ts',
  'src/main/startup/dev-instance-identity.ts',
  'src/main/tray/system-tray.ts',
  'src/main/updater-test-harness.ts',
  'src/main/updater.startup-scheduling.test.ts',
  'src/main/updater.ts',
  'src/main/window/createMainWindow.ts',
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
  'src/types/build-constants.d.ts'
])

export function isDeniedOverlayPath(filePath) {
  return DENIED_OVERLAY_PREFIXES.some(
    (prefix) => filePath === prefix.slice(0, -1) || filePath.startsWith(prefix)
  )
}

export function classifyForkPath(filePath, kind) {
  if (kind === 'overlay' && isDeniedOverlayPath(filePath)) {
    return 'denied'
  }
  if (kind === 'fork-only' && FORK_ONLY_PATHS.has(filePath)) {
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
    if (FORK_ONLY_PATHS.has(filePath)) {
      errors.push(`${filePath} cannot be both fork-only and an overlay`)
    }
    if (isDeniedOverlayPath(filePath)) {
      errors.push(`${filePath} is a denied overlay path`)
    }
  }
  for (const filePath of FORK_ONLY_PATHS) {
    if (isDeniedOverlayPath(filePath)) {
      errors.push(`${filePath} is a denied overlay path listed as fork-only`)
    }
  }
  return errors
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
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
    findings.push({ filePath, kind: 'upstream-only', status: 'unexpected' })
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
