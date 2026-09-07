# xterm patch regeneration

Status: OBSOLETE.

Desktop and web VT now use libghostty-vt (`src/ghostty-vt/`). The old xterm.js
packages and their patch files are gone. Do not regenerate those patches.

Historical IME and composition hooks that lived in the xterm fork now belong on
the Ghostty Canvas2D pane (`OrcaPaneTerminal`) and Orca IME policy modules.
