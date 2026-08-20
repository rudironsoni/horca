# Fork Maintenance

This repository (`rudironsoni/orca`) is a long-lived personal distribution of
[`stablyai/orca`](https://github.com/stablyai/orca). This document describes how the fork is
kept in sync with upstream and how to work on it without contaminating upstream
contributions. It is fork-specific and intentionally separate from upstream's
[contribution guide](../.github/CONTRIBUTING.md).

## Branch model

| Branch | Role |
| --- | --- |
| `upstream-main` | Read-only exact mirror of `stablyai/orca:main`. Never commit to it, never merge `main` into it, never develop on it. |
| `main` | The personal Orca distribution and the fork's default branch. Diverges deliberately from upstream; upstream changes are periodically **merged** in. Never force-pushed. |
| `personal/*` | Optional branches for fork-specific development, based on `main`. |
| `fix/*`, `feat/*`, `chore/*` | Temporary upstream contribution branches, based on `upstream/main` — never on the customized `main`. |

Invariant: `rudironsoni/orca:upstream-main == stablyai/orca:main` at all times
(same commit, same tree). The mirror carries no fork-specific commits — not even
this document or the sync workflow, which live only on `main`.

## Remotes

Expected local remote configuration:

```text
origin    git@github.com:rudironsoni/orca.git
upstream  git@github.com:stablyai/orca.git
```

If `upstream` is missing: `git remote add upstream git@github.com:stablyai/orca.git`.

## Automated mirror synchronization

[`.github/workflows/sync-upstream-main.yml`](../.github/workflows/sync-upstream-main.yml)
runs hourly (and on manual dispatch) and pushes `stablyai/orca:main` to
`upstream-main` as a plain, non-forced push. Normal upstream movement
fast-forwards the mirror. If upstream rewrites history, or fork-specific commits
somehow land on `upstream-main`, the push is no longer a fast-forward and the
workflow **fails loudly instead of force-pushing**. That failure is intentional:
inspect the two branches, decide what happened, and only then reconcile manually.

Notes:

- Scheduled workflows only run from the default branch (`main`), which is where
  this workflow lives.
- GitHub suspends scheduled workflows after ~60 days of repository inactivity;
  re-enable from the Actions tab or trigger a manual dispatch.

### Updating the mirror manually

```bash
git fetch upstream
git push origin upstream/main:refs/heads/upstream-main
```

This must remain fast-forward only. If the push is rejected as non-fast-forward,
stop and investigate — do not add `--force`.

## Updating the personal `main`

Periodically merge upstream changes into `main`:

```bash
git fetch origin
git switch main
git merge origin/upstream-main
git push origin main
```

(Merging a current local `upstream-main` or `upstream/main` is equivalent.)

`main` is a published, long-lived branch that others (and CI) may reference, so
it merges upstream rather than rebasing onto it: rebasing would rewrite its
published history and require force-pushes, breaking every clone and any branch
based on it. Merge commits keep the fork's own history intact while pulling in
upstream.

## Starting fork-specific work

```bash
git switch main
git pull --ff-only origin main
git switch -c personal/<descriptive-name>
```

The `personal/` prefix is a convention to make fork-only work obvious, not a
technical requirement.

## Contributing to upstream

Upstream contributions must start from current upstream history, **never** from
the customized `main` — otherwise fork-specific commits leak into the PR.

```bash
git fetch upstream
git switch -c fix/<descriptive-name> upstream/main   # or feat/, chore/
git push -u origin fix/<descriptive-name>
```

Open the PR as `base: stablyai/orca:main`, `head: rudironsoni/orca:fix/<name>`.
Follow upstream's [CONTRIBUTING.md](../.github/CONTRIBUTING.md) for branch
naming, testing, and PR expectations.

### Refreshing an upstream contribution

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease
```

Rebasing is appropriate here — unlike for `main` — because these branches are
temporary, single-author, and unpublished except as a PR head; rewriting them
keeps the PR a clean series on top of current upstream. Use
`--force-with-lease` (never bare `--force`) so the push aborts if someone else
updated the branch in the meantime.

### Getting an accepted contribution back into `main`

Prefer letting it flow through normal synchronization: upstream merges the PR →
`upstream-main` mirrors it → the next routine merge brings it into `main`. Do
not habitually cherry-pick contributions into `main`; upstream may squash or
rewrite them on merge, and the cherry-pick would create duplicate history and
recurring conflicts. If a change is needed on `main` immediately, cherry-pick it
deliberately and expect the upstream-merged form to supersede it later.
