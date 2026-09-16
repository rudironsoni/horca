type SearchOptions = { caseSensitive?: boolean; regex?: boolean }

/**
 * Why: search highlight decorations whose width is
 * `Math.min(terminal.cols - matchCol, remainingSize)`. When the live viewport is
 * narrower than the buffer column where a match starts — e.g. searching content
 * laid out at a wider width before the pane reflowed, or a collapsed/0-col
 * viewport — that width goes negative and terminal's registerDecoration ->
 * _verifyPositiveIntegers throws "This API only accepts positive integers"
 * synchronously inside findNext/findPrevious. Thrown from a React effect/handler,
 * it trips RecoverableRenderErrorBoundary and kills the whole terminal surface
 * (crash report 0b9ab636, Orca 1.4.104).
 *
 * Horca Ghostty findNext/findPrevious throw "GhosttyTerminal is not bound" after
 * dispose/unbind (pane remount after fit/DPR). TerminalSearch is always portaled
 * into the pane and clears via findNext('') on mount and effect cleanup, so that
 * throw also takes down terminal.workbench (crash report 764bf9e3, Horca
 * 1.4.202-horca.5).
 *
 * Match navigation happens before decoration creation, so swallowing these
 * specific find failures keeps search functional and merely drops the highlight
 * on the pathological frame instead of taking down the terminal. The next find
 * (after a reflow/fit widens the viewport, or a live engine rebinds) highlights
 * normally.
 */
export function safeFind(
  search: (term: string, options?: SearchOptions) => boolean,
  term: string,
  options?: SearchOptions
): boolean {
  try {
    return search(term, options)
  } catch (error) {
    if (isRecoverableTerminalSearchError(error)) {
      return false
    }
    throw error
  }
}

function isRecoverableTerminalSearchError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    /only accepts positive integers/i.test(error.message) ||
    /GhosttyTerminal is not bound/i.test(error.message)
  )
}
