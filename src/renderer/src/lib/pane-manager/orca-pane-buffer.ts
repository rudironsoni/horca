import type {
  IBuffer,
  IBufferLine,
  IParser,
  OrcaDisposable
} from '../../../../shared/orca-terminal-surface'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'

export function createOrcaPaneBuffer(
  engine: GhosttyTerminal,
  baseY: () => number
): { active: IBuffer } {
  return {
    get active(): IBuffer {
      const cursor = engine.cursor
      const origin = baseY()
      const cols = engine.cols
      const lines = engine.readViewportText().split('\n')
      return {
        cursorX: cursor.x,
        cursorY: cursor.y,
        baseY: origin,
        length: origin + engine.rows,
        viewportY: origin,
        type: engine.isAlternateScreen ? 'alternate' : 'normal',
        getLine: (y: number): IBufferLine | undefined => {
          const text = lines[y - origin] ?? ''
          return {
            length: cols,
            isWrapped: false,
            translateToString: (_trim?: boolean, startCol?: number, endCol?: number) =>
              text.slice(startCol ?? 0, endCol ?? text.length),
            getCell: (column: number) => {
              const chars = [...text]
              const ch = chars[column] ?? ''
              return {
                getChars: () => ch,
                getWidth: () => (ch ? 1 : 0),
                isBold: () => false,
                isDim: () => false,
                isFgDefault: () => true
              }
            }
          }
        }
      }
    }
  }
}

export function createOrcaPaneParser(): IParser {
  return {
    registerCsiHandler: () => noopDisposable(),
    registerOscHandler: () => noopDisposable()
  }
}

export function noopDisposable(): OrcaDisposable {
  return { dispose: () => undefined }
}

export function flushWaiters(active: boolean, waiters: Set<() => void>): void {
  if (active || waiters.size === 0) {
    return
  }
  const pending = [...waiters]
  waiters.clear()
  for (const waiter of pending) {
    waiter()
  }
}
