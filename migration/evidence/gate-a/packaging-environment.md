# Gate A packaging environment — RETRACTED as a blocker

## Status: NOT a blocker

An earlier round reported a `node:sqlite` packaging seam and a macOS 27 SDK
`arm64e.x1` node-pty blocker. Both are **retracted**; each was an artifact of
running the build outside the toolchain Orca declares.

## Retraction 1: node:sqlite

Cause: the experiment ran under **Node v22.23.2**. Orca declares
`engines.node = 24`. `module.builtinModules` gained prefix-only builtins
(`node:sqlite`, `node:test`) in Node 23.5.0, so Node 24 includes them.

Orca's real exported `isPackagedExternalSpecifier`:

| specifier | Node 22.23.2 (unsupported) | Node 24.20.0 (declared) |
|---|---|---|
| `node:sqlite` | true (wrong) | false |
| `node:test` | true (wrong) | false |
| `node:fs` | false | false |
| `fs` | false | false |
| `electron` | false | false |
| `some-user-package` | true | true |

Conclusion: correct under the supported runtime. No overlay. The historical
Horca patch (`!specifier.startsWith('node:')`) is legacy, not a required seam.

## Retraction 2: macOS SDK / node-pty — LOCAL_ENVIRONMENT_INCOMPATIBLE

Earlier: `pnpm install` failed for node-pty with
`/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk/...: unknown architecture arm64e.x1`.

Now: a fresh full install succeeds under both Node 24 and Node 22 (`pty.node`
present).

Root cause is a **local Xcode/SDK selection change**, not a bootstrap race and
not a Horca or upstream defect:

| when | active Xcode | linker | SDK | node-pty |
|---|---|---|---|---|
| earlier in session | Xcode 26.6 | `ld-1267` | MacOSX27.0 | FAIL (`arm64e.x1` unknown) |
| now | Xcode 27.0 RC (`/Applications/Xcode-27.0.0-Release.Candidate.app`) | `ld-27037.1` | MacOSX27.0 | PASS |

The SDK 27.0 `.tbd` files still declare `arm64e.x1`; the older `ld-1267` could
not parse them, the current `ld-27037.1` can. The machine's `xcode-select`
target moved to the Xcode 27.0 RC during the session.

Classification:

```
LOCAL_ENVIRONMENT_INCOMPATIBLE
  (active Xcode linker older than the SDK in use)
```

This is machine configuration, not Horca architecture. It needs no Horca
workaround. A clean CI runner with a coherent Xcode/SDK pair is the right
environment for a signed release proof.

## Toolchain (recorded for reference)

```
macOS 27.0 (26A428)
Xcode 26.6 (17F113)
active SDK: .../MacOSX26.5.sdk
CommandLineTools SDKs: MacOSX.sdk, MacOSX26.5.sdk, MacOSX26.sdk, MacOSX27.0.sdk, MacOSX27.sdk
Apple clang 21.0.0 (clang-2100.1.1.101)
ld-1267 / TAPI 21.0.0
node v24.20.0 (declared)
pnpm 12.0.0
```

## Unsigned packaging (Gate A requirement)

`electron-builder --dir` with ad-hoc signing succeeds:

```
CSC_IDENTITY_AUTO_DISCOVERY=false CSC_NAME=- npx electron-builder \
  --config config/electron-builder.config.cjs --dir
# exit 0; skipped macOS application code signing; 527M Orca.app
```

`CSC_NAME=-` is required because a Developer ID exists in the local keychain and
the upstream `afterPack` hook prefers it; Gate A must not depend on a Developer
ID, so ad-hoc signing is forced.
