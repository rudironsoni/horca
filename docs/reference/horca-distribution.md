# Horca downstream distribution

Horca is the fork's personal distribution of Orca (see
[`../FORK_MAINTENANCE.md`](../FORK_MAINTENANCE.md)). It installs side by side
with official Orca on macOS and Windows, shares the same WSL distros, and must
never collide with an installed Orca's OS-level or on-disk state.

## Build switch and identity contract

`ORCA_DOWNSTREAM_BUILD=1` at build time compiles `ORCA_DISTRIBUTION` to
`'horca'` (see `electron.vite.config.ts`); every other build path —
official CI, contributor builds, `pnpm dev`, vitest — resolves `'official'`
and behaves exactly as before.

All externally visible identity resolves from one contract:
`src/shared/distribution-identity.ts` (runtime) mirrored by
`src/shared/distribution-identity.json` (consumed by
`config/electron-builder-downstream.cjs` and
`config/scripts/build-computer-macos.mjs`; an equality test keeps them in
sync). `config/electron-builder.config.cjs` stays the upstream file plus a
wrap that applies that post-processor, so packaging tweaks upstream do not
re-conflict with Horca identity hunks.

| Field | Official | Horca |
| --- | --- | --- |
| productName | Orca | Horca |
| appId / AppUserModelID | com.stablyai.orca | com.rudironsoni.horca |
| URL protocol | `orca:` | `horca:` |
| public CLI | `orca` | `horca` |
| local state root | `~/.orca` | `~/.horca` |
| updater | enabled | disabled |
| Windows daemon-host dir | `%LOCALAPPDATA%\Orca` | `%LOCALAPPDATA%\Horca` |
| Windows per-user install dir | `%LOCALAPPDATA%\Programs\orca` | `%LOCALAPPDATA%\Programs\Horca` |
| Windows daemon image | orca-terminal-daemon.exe | horca-terminal-daemon.exe |

Horca packaging explicitly disables electron-builder publishing; a push
to `main` runs `horca-release.yml`, which calls `horca-build.yml`, uploads
GitHub Releases tagged `v<core>-horca.<N>` on this repository, then calls
`bump-horca-cask.yml` and waits until the Homebrew tap's `horca` cask matches
that tag. Pushes to conventional `feature/**` / `fix/**` / `hotfix/**` /
`feat/**` / `bugfix/**` / `perf/**` / `refactor/**` branches run
`horca-beta-release.yml` instead: same three assets, GitHub **prerelease**
`v<core>-horca.<nextN>-beta.<M>` (nextN is 1 + max stable N; betas never
increment stable N), then `horca@beta` on the tap
(`brew install --cask rudironsoni/tap/horca@beta`, `conflicts_with cask:
"horca"`). Skip with `[skip horca-beta]` or `[skip horca-release]` on the
commit subject (first line); a token only in the squash body does not skip.
`/releases/latest` and `horca-check-source.yml` stay on stable. Official
mirrored `vX.Y.Z` git tags stay tags, not GitHub Releases. Horca Windows
installers are currently unsigned (no Stably `publisherName`, no SignPath
identity); the electron-updater Windows signature pin is dropped only for
downstream builds, which never run the updater anyway.

## State classification

Each `.orca` path is classified, not blanket-renamed:

**Horca-owned local state (isolated via `src/main/local-state-root.ts`):**
credential/API-key stores (OpenAI speech, Bitbucket, Linear, Jira, MiniMax),
`keybindings.json`, the Claude agent-teams shim root. Electron `userData`
(and with it terminal-daemon sockets/tokens/PIDs under `userData/daemon`,
history, caches), macOS Keychain safeStorage identity, and Windows
`%APPDATA%`/`%LOCALAPPDATA%` follow the product name / bundle id
automatically — verify experimentally in Phase 2, do not assume.

**Deliberately shared local surfaces (must stay `.orca`):**

- `~/.orca/agent-hooks/*` and its install lock (`~/.orca/orca-hooks.lock`):
  third-party agent CLIs (Claude, Codex, Gemini, …) each hold ONE hook entry
  in their own settings pointing at these scripts. The surface is already
  multi-instance (stable + dev instances share it); the lock must stay shared
  because it guards the shared scripts. Renaming per-distribution would break
  the other app's installed hooks.
- Per-repo `.orca/` directories (`issue-command`, `drops`, `templates`,
  worktree roots): project metadata both apps read in the same repositories.

**Remote/WSL/SSH state (execution-host owned, intentionally shared):**
remote `~/.orca/agent-hooks/*` (same one-hook-entry-per-agent-CLI reasoning as
local), relay `~/.orca/sessions` (keyed by unique session ids), relay skill
install state, and per-worktree `.orca/` paths. Remote hosts serve multiple
client instances by design; the `orca:` deep-link FORMAT likewise stays a
cross-client wire surface (`getAcceptedDeepLinkProtocols()`), while OS-level
protocol REGISTRATION is per-distribution.

**Windows collision audit:** executable name, installer/uninstaller identity,
AppUserModelID, protocol registration, CLI shim (`horca.cmd` +
`horca.exe` launcher resolving the app by its own basename), appData, the
per-user install directory (`%LOCALAPPDATA%\Programs\Horca` — electron-builder
oneClick would otherwise use package.json `name` and land in `Programs\orca`;
`config/nsis/daemon-host-uninstall-horca.nsh` redefines `APP_FILENAME`), the
`horca:` protocol (electron-builder NSIS never writes `protocols`; the Horca
include registers `HKCU\Software\Classes\horca` at install and deletes it on
real uninstall), the
relocated daemon host (dir + image name + per-distribution NSIS uninstall
include `config/nsis/daemon-host-uninstall-horca.nsh`), the mobile-pairing
firewall rule (`Horca.MobilePairing` — a shared name would let one app's
repair delete the other's rule), and the non-ASCII-path speech-model cache
under `%ProgramData%\<productName>` are all distribution-scoped. The daemon
named pipe embeds a hash of the `userData`-scoped runtime dir, so pipes never
collide. `ORCA_CLI_COMMAND` (an orchestration hint constrained to
`orca`/`orca-ide`) is intentionally unchanged; it is agent-facing guidance,
not an OS identity.

**macOS helper identity:** the Computer Use helper's peer-trust check derives
its owner from the helper's own bundle id (`<appId>.computer-use` →
`<appId>`), so each distribution's helper authorizes only its own main app.
The `orca-notification-status` helper embeds the distribution's appId as its
`CFBundleIdentifier` (macOS keys notification records to it); the build
script defaults from `ORCA_DOWNSTREAM_BUILD` like electron-builder does.
Remaining host-scoped remote roots (`~/.orca-remote`, `~/.orca-relay`,
`~/.orca-wsl`) are versioned/instance-keyed wire contracts shared across
client instances by design and stay unchanged.

## Updater

Horca disables the in-app updater entirely through one gate,
`src/main/updater-distribution-gate.ts`:

- `setupAutoUpdater` returns before wiring electron-updater, feed pinning,
  event handlers, nudge polling, and scheduled checks.
- Manual "Check for Updates" reports a deliberate
  `not-available`/`updatesDisabledReason: 'downstream-distribution'` status;
  the UI explains that updates ship via Homebrew or GitHub Releases.
- The release picker (`listAvailableReleaseBuilds`) refuses with the same
  explanation; remote-server update support degrades to the existing
  `updater-unavailable` reason (no wire change).

Do not retarget `updater-prerelease-feed.ts`, `updater-release-builds.ts`,
release-channel classification, or feed selection at Horca — that is a
separate project.

## Official-service audit (fail-closed proofs)

- **PostHog telemetry** (`src/main/telemetry/client.ts`): transmits only when
  CI injects both `ORCA_BUILD_IDENTITY` (stable/rc) and
  `ORCA_POSTHOG_WRITE_KEY`. Horca workflows inject neither → compile-time null
  → `track()` is a no-op. No new gate added.
- **Diagnostics uploads** (`src/main/observability/diagnostic-upload-endpoint.ts`):
  require `ORCA_DIAGNOSTICS_TOKEN_URL` plus official build identity; both are
  absent downstream.
- **Crash reporting** (`src/main/crash-reporting/crashpad-capture.ts`):
  `uploadToServer: false`, no submit URL configured anywhere — local-only for
  every distribution.
- **onorca.dev** (nudge + changelog JSON) and **stablyai/orca release APIs**
  (feed manifests, release tags): only reachable through the updater, which
  the gate disables for Horca.
