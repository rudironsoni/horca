import { vi } from 'vitest'
import type { Mock } from 'vitest'

type TerminalWriteMock = Mock<(data: string, callback?: () => void) => void>

/** Background/queued write target; `classes` mirrors the classList the scheduler toggles. */
export type SchedulerTestTerminal = {
  classes: Set<string>
  element: {
    classList: {
      add: Mock<(className: string) => void>
      remove: Mock<(className: string) => void>
    }
  }
  write: TerminalWriteMock
}

export type ForegroundSchedulerTestTerminal = {
  cursor: { x: number; y: number }
  baseY: number
  viewportY: number
  rows: number
  refresh: Mock<(start: number, end: number) => void>
  write: TerminalWriteMock
}

export function createTerminal(): SchedulerTestTerminal {
  const classes = new Set<string>()
  return {
    classes,
    element: {
      classList: {
        add: vi.fn((className: string) => {
          classes.add(className)
        }),
        remove: vi.fn((className: string) => {
          classes.delete(className)
        })
      }
    },
    write: vi.fn((_data: string, callback?: () => void) => {
      callback?.()
    })
  }
}

export function createForegroundTerminal(): ForegroundSchedulerTestTerminal {
  return {
    cursor: { x: 0, y: 7 },
    baseY: 0,
    viewportY: 0,
    rows: 24,
    refresh: vi.fn(),
    write: vi.fn((_data: string, callback?: () => void) => callback?.())
  }
}

export async function loadScheduler() {
  vi.resetModules()
  return import('./pane-terminal-output-scheduler')
}
