# native/horca-ghostty provenance

Ghostty pin: `c41c6b81a4642ccba18d47b375d9495664de72a0`
Horca branch: `feat/d2-ghostty-gpu` @ `9fa2698c0b`

CODE COPIED FROM CMUX: 0

## COPY

| Path | Source | Commit | License |
| --- | --- | --- | --- |
| `adopted/electron-ghostty/**` | `mxschmitt/ghostty-xterm-bench` `packages/electron-ghostty` | `046045cc5743a155c2975bb7a690384eaa42ef32` | MIT (Max Schmitt) |
| `patches/0001-build-install-libghostty-static-on-macos.patch` | same repo `patches/` | `046045cc5743a155c2975bb7a690384eaa42ef32` | MIT (ghostty derivative) |
| `patches/0002-apprt-embedded-headless-platform.patch` | same repo `patches/` | `046045cc5743a155c2975bb7a690384eaa42ef32` | MIT (ghostty derivative) |
| `upstream-snippets/gterm-passthru/Passthru.zig` | `madeye/ghostty` `src/termio/Passthru.zig` | `ea0622bc4a3a2acada488574cf4bd83b297a6c68` | MIT (Max Lv / ghostty) |
| `patches/0003-termio-passthru-io-backend.patch` | `madeye/ghostty` commit `ea0622bc` (mailbox patch, 7 files) | `ea0622bc4a3a2acada488574cf4bd83b297a6c68` | MIT |

## ADAPT

None in this checkpoint. `0003` applied cleanly to `c41c6b81` + `0001` + `0002` with no hunk edits.

## INVENT

| Path | Why |
| --- | --- |
| `harness/combined_passthru_headless.c` | Standalone proof of passthru + headless Metal/IOSurface. Not a renderer. |
| `harness/abi_header_probe.c` | Compile-time proof of `GHOSTTY_IO_BACKEND_PASSTHRU` and callback fields. |

Inspected madeye fork head `7fb9e90363a431d15a67a22ff661e33c1be59060` is not the 0003 source.
