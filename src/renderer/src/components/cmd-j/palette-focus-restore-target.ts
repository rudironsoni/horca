// Why: when Cmd+J closes it must hand focus back to whatever the user was
// doing. Prefer the exact element focused before the palette opened (e.g. the
// specific terminal textarea they were typing in); the querySelector fallbacks
// grab the first match in the DOM, which can be a background worktree's
// mounted-but-hidden terminal rather than the visible one.
export function resolvePaletteFocusRestoreTarget(
  preferredTarget: HTMLElement | null,
  doc: Document = document
): HTMLElement | null {
  if (preferredTarget && preferredTarget.isConnected) {
    return preferredTarget
  }
  const terminal = doc.querySelector('.orca-terminal-helper-textarea')
  if (terminal instanceof HTMLElement) {
    return terminal
  }
  const monaco = doc.querySelector('.monaco-editor textarea')
  return monaco instanceof HTMLElement ? monaco : null
}
