type TerminalWebglAddonLoadHandlers = {
  onLoaded: () => void
  onFailed: () => void
}

export function setTerminalWebglAddonLoadHandlers(_next: TerminalWebglAddonLoadHandlers): void {}

export function getTerminalWebglAddonConstructor(): null {
  return null
}

export function primeTerminalWebglAddon(): Promise<void> {
  return Promise.resolve()
}

export function rearmTerminalWebglAddonLoad(): void {}
