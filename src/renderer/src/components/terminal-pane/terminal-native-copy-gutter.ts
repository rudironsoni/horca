import { readTerminalClipboardSelection } from './terminal-clipboard-selection-text'

type NativeCopyTerminal = {
  getSelection(): string
  hasSelection(): boolean
  element?: HTMLElement
}

/**
 * Horca's Ghostty pane still sees native copy (Ctrl+Insert, assistive tech).
 * Capture phase writes the gutter-trimmed selection so those paths match
 * Orca's Cmd/Ctrl+C clipboard seams (#19770).
 */
export function installTerminalNativeCopyGutterTrim(terminal: NativeCopyTerminal): {
  dispose(): void
} {
  const element = terminal.element
  if (!element) {
    return { dispose: () => {} }
  }
  const onCopy = (event: ClipboardEvent): void => {
    if (!terminal.hasSelection() || !event.clipboardData) {
      return
    }
    event.clipboardData.setData('text/plain', readTerminalClipboardSelection(terminal))
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  element.addEventListener('copy', onCopy, { capture: true })
  return { dispose: () => element.removeEventListener('copy', onCopy, { capture: true }) }
}
