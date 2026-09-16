# Gate B2 — Dependency composition (PASS)

Probe: `migration/probes/gate-b2/horca-probe` (`@horca/gate-b2-probe`, TypeScript,
Horca-only dep `change-case@5.4.4`, observable `Horca Gate B2 probeTitle`).
Immutable upstream: `85d1ffc0726d8403f9494436c421c5e3d7932c47`.

Both candidates were implemented, built, packaged, and produced the probe result
inside `app.asar`. Neither embeds the value in the overlay.

| Metric | A (separate workspace + lock) | B (combined workspace + lock) |
|---|---|---|
| upstream source files transformed | 2 (`electron.vite.config.ts`, `main.tsx`) | 1 (`main.tsx`) |
| upstream files added | 1 (`horca-gate-b2-probe.d.ts`) | 0 |
| upstream dependency manifests transformed | 0 | 1 (`pnpm-workspace.yaml`) |
| upstream lockfile transformed | no | yes (`pnpm-lock.yaml` regenerated) |
| Orca `package.json` / `pnpm-lock.yaml` stay upstream-owned | yes | lock is derived |
| generated dependency files | 0 | 2 + probe copy |
| Horca-owned dependency files | probe `package.json` + `pnpm-lock.yaml` | probe `package.json` |
| resolver configuration | Vite alias + TS seam + env input | none |
| package-manager commands | none in the worktree | `pnpm install --lockfile-only` |
| reacts to upstream dependency churn | no | regenerates combined lock |
| type safety | decoupled (ambient shim) | real |
| reproducibility | identical deltas + BuildIdentity | byte-identical generated metadata |
| packaging | PASS (523M) | PASS (534M) |

## Decision: A — separate Horca workspace + lock

Decisive principle: the migration's core invariant is that Orca is an immutable
build input whose manifests and lock stay upstream-owned. A preserves this
exactly (0 upstream dependency manifests/locks transformed, 2 upstream-owned
files transformed). B makes Horca's dependency resolution part of Orca's
dependency graph and regenerates Orca's lock, coupling Horca to upstream
dependency churn and conflicts.

Measured cost of A: one explicit Vite resolver seam, one TypeScript seam, and one
build input. Required refinement: replace the ambient module declaration with a
`tsconfig` `paths` mapping to the real probe source, because the ambient shim
decoupled types and hid a missing export during prototyping.

## BuildIdentity

Now `upstreamSha + overlayDigest + schema-2 + Horca dependency-lock digest`
(`d61c43aa7447`). Deterministic across materialization paths; runId/path/time/pid
excluded. `product.json` intentionally excluded until Gate C creates it.

## Cleanup hardening

`scripts/cleanup-worktrees.sh` validates that every tracked modification is a
declared overlay target or an allowed generated dependency file before
`git worktree remove --force`; an unexpected modification fails cleanup
(verified with a deliberate `README.md` tamper). No stale metadata remains.
