import { terminalLogicalInputFromBytes } from '../../../../shared/terminal-logical-key'

export function logicalKeysForPtyWrite(data: string): string[] | undefined {
  const classified = terminalLogicalInputFromBytes(data)
  return classified.kind === 'key' ? [classified.name] : undefined
}

export function writePtyLogicalInput(id: string, data: string): void {
  const keys = logicalKeysForPtyWrite(data)
  if (keys) {
    window.api.pty.write(id, data, keys)
    return
  }
  window.api.pty.write(id, data)
}

export function writeAcceptedPtyLogicalInput(id: string, data: string): Promise<boolean> {
  const keys = logicalKeysForPtyWrite(data)
  return keys
    ? window.api.pty.writeAccepted(id, data, keys)
    : window.api.pty.writeAccepted(id, data)
}
