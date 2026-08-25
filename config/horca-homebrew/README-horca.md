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

- Horca's in-app updater is intentionally disabled; `brew upgrade --cask horca`
  is the update path (the cask sets no `auto_updates`).
- The cask is bumped by Release Horca on `rudironsoni/orca` (it calls
  `bump-horca-cask.yml` and waits). This tap's scheduled `bump-horca-cask`
  workflow is a 6-hour backup: it polls `v*-horca.*` releases and commits
  with this repository's own `GITHUB_TOKEN`.
- `brew zap horca` removes only Horca-owned state; an installed official
  Orca (app, `~/.orca`, Application Support, Keychain, TCC grants) survives.
