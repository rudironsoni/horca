import { markTerminalFollowOutput, type TerminalScrollIntentTarget } from './terminal-scroll-intent'

type TerminalScrollbackClearTarget = TerminalScrollIntentTarget & {
  clear?: () => void
  write: (data: string) => void
  scrollToBottom: () => void
}

export function clearTerminalScrollbackAndFollowOutput(
  terminal: TerminalScrollbackClearTarget
): void {
  if (typeof terminal.clear === 'function') {
    terminal.clear()
  } else {
    terminal.write('\x1b[2J\x1b[3J\x1b[H')
  }
  terminal.scrollToBottom()
  markTerminalFollowOutput(terminal)
}
