# Horca fork maintenance

Horca is an Orca distribution with additive features. Treat upstream files as read-only unless a narrow integration hook or product identity requires a change.

## Branches

- `main` is the released Horca branch.
- `upstream/main` is the unmodified `stablyai/orca` reference.
- `personal/*` starts from `main` and contains Horca-only work.
- `fix/*` and `feat/*` for upstream pull requests start from `upstream/main`.

Never open an upstream pull request from Horca `main`. The branch would include Horca identity and Herdr.

## Upstream sync

`.github/workflows/horca_sync.yml` fetches upstream each day. It merges upstream into `automation/upstream-sync`, validates the result, and opens a pull request. It never force-pushes `main`.

If the merge conflicts, the workflow leaves `main` unchanged and opens or updates one `sync-conflict` issue. Resolve only the listed files on the sync branch, then run:

```bash
node config/horca/scripts/check-overlay-policy.mjs
pnpm tc
```

## Ownership rules

Prefer a new file under a Horca-owned prefix:

- `src/main/horca/`
- `src/shared/horca/`
- `src/main/providers/multiplexer/herdr/`
- `config/horca/`
- `docs/horca/`
- `.github/workflows/horca_*`

`config/horca/overlay-policy.json` is the debt register for modified upstream files. New entries need a specific topic and a reason. The total should decrease. Deleted upstream files, upstream workflow edits, locale overlays, and E2E overlays are forbidden.

## Upstream contributions

Create the branch from upstream, not Horca:

```bash
git fetch upstream
git switch -c fix/example upstream/main
```

The Claude Keychain fix is the model. Horca carries the exact commit from `stablyai/orca#16673`. Drop that commit after upstream contains an equivalent fix.

## Feature design

1. Add the implementation in a Horca-owned module.
2. Add one generic Orca extension point if required.
3. Keep renderer, persistence, SSH, and folder-workspace behavior behind that interface.
4. Send useful generic extension points upstream.
5. Reject a feature if it requires broad edits to high-churn Orca files.
