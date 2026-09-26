// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { installTerminalLiveScrollbackRestore } from './terminal-live-scrollback-restore'

describe('ghostty live scrollback restore', () => {
  it('restores a pinned viewport after CSI 3 J and ignores an erase that is not scrollback', () => {
    const scrolls: number[] = []
    const handlers: Array<(params: (number | number[])[]) => boolean> = []
    let parsed: (() => void) | undefined
    const buffer = { type: 'normal' as string, viewportY: 2, baseY: 10 }
    const terminal = {
      buffer: { active: buffer },
      parser: {
        registerCsiHandler: (
          _id: { prefix?: string; final: string },
          handler: (params: (number | number[])[]) => boolean
        ) => {
          handlers.push(handler)
          return { dispose: () => undefined }
        }
      },
      onWriteParsed: (listener: () => void) => {
        parsed = listener
        return { dispose: () => undefined }
      },
      scrollToLine: (line: number) => {
        scrolls.push(line)
        buffer.viewportY = line
      }
    }
    const settles: Array<() => void> = []
    const restore = installTerminalLiveScrollbackRestore(terminal, {
      now: () => 1_000,
      scheduleSettle: (run) => {
        settles.push(run)
        return () => undefined
      }
    })
    expect(handlers).toHaveLength(2)
    expect(handlers[0]?.([2])).toBe(false)
    expect(settles).toHaveLength(0)
    buffer.type = 'alternate'
    expect(handlers[0]?.([3])).toBe(false)
    expect(settles).toHaveLength(0)
    buffer.type = 'normal'
    buffer.viewportY = 10
    expect(handlers[0]?.([3])).toBe(false)
    expect(settles).toHaveLength(0)
    buffer.viewportY = 2
    expect(handlers[0]?.([3])).toBe(false)
    expect(settles).toHaveLength(1)
    buffer.viewportY = 0
    parsed?.()
    expect(settles.length).toBeGreaterThan(1)
    settles.at(-1)?.()
    expect(scrolls).toEqual([2])
    expect(buffer.viewportY).toBe(2)
    restore.dispose()
  })
})
