# Fork maintenance

This fork keeps two long-lived branches:

- `upstream-main` is a read-only mirror of `stablyai/orca:main`.
- `main` is the personal distribution and may contain fork-only changes.

Never commit to `upstream-main`, merge `main` into it, or use it as a development
branch. The invariant is:

```text
rudironsoni/orca:upstream-main == stablyai/orca:main
```

Updates flow one way:

```text
stablyai/orca:main
        |
        | hourly fast-forward mirror (Sync Upstream Main)
        v
rudironsoni/orca:upstream-main
        |
        | merge PR, never rebase
        v
rudironsoni/orca:main
        |
        + fork-only maintenance commits
```

## Never rewrite main

`main` is a published, long-lived branch. Never rebase it, never force-push it,
and never "clean up" its history. Update it only by merging — normal PRs and
`upstream-main` merge PRs — so existing commits are always preserved.

This is not theoretical. On 2026-08-20 `main` was rebased onto upstream, which
silently deleted the fork-maintenance work from PRs #7, #8, and #9 (including
this document); PR #11 had to restore the workflow pieces. A merge of
`origin/upstream-main` would have absorbed the same upstream commits without
destroying anything.

Temporary contribution branches may still be rebased (see below). The
prohibition applies to long-lived published branches: `main` and
`upstream-main`.

## The sync workflow

The scheduled `Sync Upstream Main` workflow lives only on personal `main`. It
runs hourly at minute 17 (plus manual dispatch) and does three things:

1. Fast-forwards `upstream-main` to `stablyai/orca:main`. It refuses to push
   anything that is not a fast-forward; a rejected push means history diverged
   and a human must look.
2. Mirrors upstream desktop release tags (`refs/tags/v*`). The Skill update
   round trip check resolves `v<appVersion>` tags from
   `resources/skills/release-mapping.json` and fails on a fork missing them.
   Tags present in both repositories are compared by object id: a divergent tag
   fails the run loudly and is never overwritten.
3. Opens an `upstream-main -> main` merge PR when the mirror is ahead of
   `main`. The PR is never merged automatically; let CI run and merge it with a
   merge commit.

The workflow authenticates with `secrets.UPSTREAM_SYNC_TOKEN` when configured,
falling back to the default Actions token. The default token cannot push tags
whose history touches `.github/workflows` (GitHub rejects them without the
`workflows` permission) and PRs it creates do not trigger PR CI. Configure
`UPSTREAM_SYNC_TOKEN` as a fork-owned fine-grained PAT with contents,
workflows, and pull-requests write on this repository to lift both limits.

Do not add the sync workflow, or other fork-only files, to `upstream-main`.

Upstream-only workflows that need Stably secrets or write to Stably projects
(`track-community-prs`, release, Homebrew, signed builds) stay scoped to
`stablyai/orca` so they do not fail on this fork.

## Branch protection

Both long-lived branches should carry a GitHub ruleset that blocks force
pushes ("Block force pushes") and deletion ("Restrict deletions"), and nothing
else:

- `main`: prefer changes through PRs; the ruleset stops history rewrites.
- `upstream-main`: no PR requirement — it is a machine-maintained mirror and
  the sync workflow must keep making ordinary fast-forward pushes, which these
  two rules do not block.

Configuring rulesets requires repository admin access (Settings → Rules →
Rulesets), which automation tokens on this fork do not have.

Before opening an upstream pull request, read
[`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) on current
`stablyai/orca:main`.

## Remotes

Use `origin` for `rudironsoni/orca` and `upstream` for `stablyai/orca`:

```bash
git remote -v
git remote add upstream git@github.com:stablyai/orca.git
git fetch origin
git fetch upstream
```

Add `upstream` only if it does not already exist.

## Update the upstream mirror manually

```bash
git fetch upstream
git push origin upstream/main:refs/heads/upstream-main
```

This push must remain fast-forward only. Do not add `--force`. If it fails,
inspect the branch history instead of rewriting the mirror.

## Update personal main

```bash
git fetch origin
git switch main
git merge origin/upstream-main
git push origin main
```

Merge upstream updates into published `main`. Do not rebase or force-push this
long-lived branch — see "Never rewrite main" above. Prefer merging through the
automated `upstream-main -> main` PR so CI runs before the merge lands.

## Start fork-specific work

```bash
git switch main
git pull --ff-only origin main
git switch -c personal/<descriptive-name>
```

The `personal/` prefix identifies fork-only work but is not enforced.

## Start an upstream contribution

Read the current upstream contribution guide before starting. Base contribution
branches on current upstream history, never on customized `main`:

```bash
git fetch upstream
git switch -c fix/<descriptive-name> upstream/main
```

Use `feat/<descriptive-name>` or another descriptive prefix when appropriate.
Open the pull request with `stablyai/orca:main` as the base and the fork branch
as the head.

## Refresh an upstream contribution

Temporary contribution branches may be rebased:

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease
```

Never use unrestricted `--force`.

Rebasing keeps a temporary contribution focused on current upstream history.
Merging is preferred for personal `main` because it preserves the published
history other work may already depend on.

When a contribution is also wanted in the personal distribution, prefer to let
it return through upstream after acceptance and the normal mirror-to-main flow.
Upstream may squash or rewrite the pull request commits. Cherry-pick it into
`main` only when immediate inclusion is a deliberate choice.
