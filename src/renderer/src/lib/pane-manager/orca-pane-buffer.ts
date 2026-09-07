import { readGridLine } from '../../../../ghostty-vt/ghostty-grid-introspection'
import type { GhosttyTerminal } from '../../../../ghostty-vt/ghostty-terminal'
import { HeadlessVtQueryParser } from '../../../../ghostty-vt/headless-vt-query-parser'
import type { IBuffer, IBufferLine, OrcaDisposable } from '../../../../shared/orca-terminal-surface'

export function createOrcaPaneBuffer(
  engine: GhosttyTerminal,
  baseY: () => number
): { active: IBuffer } {
  return {
    get active(): IBuffer {
      const cursor = engine.cursor
      const origin = baseY()
      const cols = engine.cols
      const { host, term } = engine.hostHandle()
      return {
        cursorX: cursor.x,
        cursorY: cursor.y,
        baseY: origin,
        length: origin + engine.rows,
        viewportY: origin,
        type: engine.isAlternateScreen ? 'alternate' : 'normal',
        getLine: (y: number): IBufferLine | undefined => {
          const line = readGridLine(host, term, cols, y)
          if (!line) {
            return undefined
          }
          return {
            length: cols,
            isWrapped: line.isWrapped,
            translateToString: (_trim?: boolean, startCol?: number, endCol?: number) => {
              const start = startCol ?? 0
              const end = endCol ?? cols
              return line.cells
                .slice(start, end)
                .map((cell) => cell.chars)
                .join('')
            },
            getCell: (column: number) => {
              const cell = line.cells[column]
              if (!cell) {
                return undefined
              }
              return {
                getChars: () => cell.chars,
                getWidth: () => cell.width,
                isBold: () => cell.bold,
                isDim: () => cell.dim,
                isFgDefault: () => cell.fgDefault
              }
            }
          }
        }
      }
    }
  }
}

export function createOrcaPaneParser(): HeadlessVtQueryParser {
  return new HeadlessVtQueryParser()
}

export function noopDisposable(): OrcaDisposable {
  return { dispose: () => undefined }
}

export function trackListener<T>(listeners: Set<T>, listener: T): OrcaDisposable {
  listeners.add(listener)
  return { dispose: () => listeners.delete(listener) }
}

export function orcaPaneModes(engine: GhosttyTerminal): {
  bracketedPasteMode: boolean
  mouseTrackingMode: 'none' | 'on'
  sendFocusMode: boolean
  showCursor: boolean
} {
  return {
    bracketedPasteMode: engine.getMode(2004),
    mouseTrackingMode: engine.mouseTracking ? 'on' : 'none',
    sendFocusMode: engine.getMode(1004),
    showCursor: engine.getMode(25)
  }
}

export function notifyTitleListeners(
  before: string,
  after: string,
  listeners: Set<(title: string) => void>
): void {
  if (before === after) {
    return
  }
  for (const listener of listeners) {
    listener(after)
  }
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
