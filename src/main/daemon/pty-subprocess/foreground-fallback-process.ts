import { win32 as pathWin32 } from 'node:path'
import { PTY_TERM_NAME } from '../../../shared/pty-term-name'

function normalizeForegroundProcessName(processName: string | null | undefined): string | null {
  const trimmed = processName?.trim().replace(/^["']|["']$/g, '') ?? ''
  if (!trimmed || trimmed === PTY_TERM_NAME) {
    return null
  }
  return trimmed.split(/[\\/]/).pop() || null
}

/**
 * node-pty's reported foreground name, normalized to a bare executable.
 * Windows ConPTY can report nothing useful; fall back to the spawned shell.
 */
export function resolveFallbackForegroundProcess(
  processName: string | null | undefined,
  shellPath: string
): string | null {
  const normalized = normalizeForegroundProcessName(processName)
  if (normalized || process.platform !== 'win32') {
    return normalized
  }
  return normalizeForegroundProcessName(pathWin32.basename(shellPath))
}
