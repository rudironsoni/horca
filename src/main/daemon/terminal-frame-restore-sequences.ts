import type { TerminalModes } from './types'

export function buildFrameRestoreSnapshotFields(
  _serializer: unknown,
  _terminal: unknown,
  modes: TerminalModes
): { frameRestoreAnsi?: string } {
  return modes.alternateScreen ? { frameRestoreAnsi: '' } : {}
}
