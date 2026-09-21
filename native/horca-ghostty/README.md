# Horca Ghostty adapter

MIT transplant from mxschmitt/ghostty-xterm-bench (packages/electron-ghostty)
plus madeye/ghostty passthru IO, pinned at Ghostty c41c6b81.

COPY: adopted/electron-ghostty/**, patches/0001, patches/0002, patches/0003 (ea0622bc mailbox)
ADAPT: none for 0003 (clean apply onto c41c6b81 + 0001 + 0002)
INVENT: harness/combined_passthru_headless.c, harness/abi_header_probe.c

See PROVENANCE.md. CODE COPIED FROM CMUX: 0
