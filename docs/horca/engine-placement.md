# Ghostty engine placement (macOS)

Decision: Ghostty engine placement on macOS is the Electron **MAIN** process.

Context: Horca daemon retains PTY ownership via `createPtySubprocess` → `SubprocessHandle`. Ghostty consumes PTY bytes with passthru (`ghostty_surface_pty_data`) and returns encoded input through `pty_write_cb` as `Buffer`.

Measured evidence (pre-PaneManager gate, Electron 43.7.0, 50 MiB flood, 5 interleaved runs after warmup):

- MAIN median 12.976 s (3.85 MiB/s)
- UTILITY median 55.790 s (0.90 MiB/s)
- 16 KiB and 64 KiB utility batching did not close the gap
- key-under-load and Ctrl+C-under-load latency approximately equal (30 samples each)
- MAIN lower measured single-terminal total RSS
- UTILITY stronger engine-crash isolation

Raw run files: `/tmp/horca-d2-e43-results/placement-gate.json`, `latency30.json`, `batch-four.json`.

Consequences:

- no PTY-byte hop between processes
- no Mach transport required between Ghostty engine and Electron main
- Ghostty engine failure can terminate Electron main
- engine placement can be revisited if isolation requirements change

PTY write contract: `SubprocessHandle.write(data: string | Buffer)`. Existing string callers keep string semantics. Ghostty passthru writes `Buffer` only.
