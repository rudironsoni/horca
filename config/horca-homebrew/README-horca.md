# Horca cask (section for the tap README)

Merge this into `rudironsoni/homebrew-tap`'s `README.md` when copying the
staged files (see `docs/FORK_MAINTENANCE.md`, Horca releases).

---

## Horca

Personal downstream distribution of [Orca](https://github.com/stablyai/orca),
built and released from [rudironsoni/orca](https://github.com/rudironsoni/orca).
Installs side by side with official Orca — distinct app (`Horca.app`),
bundle id (`com.rudironsoni.horca`), URL protocol (`horca:`), CLI
(`horca`), and state root (`~/.horca`).

```bash
brew install --cask rudironsoni/tap/horca
```

Beta (same `Horca.app` / bundle id; uninstall stable first, or the other way
around — the casks `conflicts_with` each other):

```bash
brew install --cask rudironsoni/tap/horca@beta
```

- Horca's in-app updater is intentionally disabled; `brew upgrade --cask horca`
  (or `horca@beta`) is the update path (neither cask sets `auto_updates`).
- The stable cask is bumped by Release Horca on `rudironsoni/orca` (it calls
  `bump-horca-cask.yml` with `cask_token: horca` and waits). Release Horca
  beta does the same for `Casks/horca@beta.rb`. This tap's scheduled
  `bump-horca-cask` workflow is a 6-hour backup: it polls stable
  `v*-horca.*` and prerelease `v*-horca.*-beta.*` (never `/releases/latest`)
  and commits with this repository's own `GITHUB_TOKEN`.
- `brew zap horca` / `brew zap horca@beta` removes only Horca-owned state; an
  installed official Orca (app, `~/.orca`, Application Support, Keychain, TCC
  grants) survives.
