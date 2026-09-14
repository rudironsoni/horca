import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createTerminalWriteCoalescer,
  TERMINAL_WRITE_FLUSH_WINDOW_MS
} from './terminal-write-coalescer'

const webViewSource = readFileSync(new URL('./TerminalWebView.tsx', import.meta.url), 'utf8')

describe('terminal write coalescer boundaries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops buffered trailing writes on init so they cannot follow the snapshot', () => {
    vi.useFakeTimers()
    const delivered: string[] = []
    const coalescer = createTerminalWriteCoalescer((data) => {
      delivered.push(data)
    })
    coalescer.write('lead')
    coalescer.write('stale-pending')
    coalescer.clear()
    coalescer.write('snapshot')
    vi.advanceTimersByTime(TERMINAL_WRITE_FLUSH_WINDOW_MS)
    expect(delivered).toEqual(['lead', 'snapshot'])
  })

  it('routes handle.write through the coalescer to writeText', () => {
    expect(webViewSource).toContain("from 'expo-libghostty'")
    expect(webViewSource).toContain('createTerminalWriteCoalescer((data) => {')
    expect(webViewSource).toContain('nativeRef.current?.writeText(data)')
    const writeStart = webViewSource.indexOf('write(data: string) {')
    expect(writeStart).toBeGreaterThanOrEqual(0)
    const writeBody = webViewSource.slice(writeStart, writeStart + 120)
    expect(writeBody).toContain('writeCoalescer.write(data)')
  })

  it('clears the coalescer before snapshot init and clear', () => {
    const initStart = webViewSource.indexOf(
      'init(_cols: number, _rows: number, initialData?: string)'
    )
    expect(initStart).toBeGreaterThanOrEqual(0)
    const initClear = webViewSource.indexOf('writeCoalescer.clear()', initStart)
    const initWrite = webViewSource.indexOf('writeText', initStart)
    expect(initClear).toBeGreaterThan(initStart)
    expect(initClear).toBeLessThan(initWrite)

    const clearStart = webViewSource.indexOf('clear() {', initWrite)
    const clearBody = webViewSource.slice(clearStart, clearStart + 220)
    expect(clearBody).toContain('writeCoalescer.clear()')
    expect(clearBody).toContain('writeText')
  })

  it('clears the coalescer on unmount so no timer leaks', () => {
    const cleanupStart = webViewSource.indexOf('useEffect(() => {\n      return () => {')
    expect(cleanupStart).toBeGreaterThanOrEqual(0)
    const cleanupBody = webViewSource.slice(cleanupStart, cleanupStart + 160)
    expect(cleanupBody).toContain('writeCoalescer.clear()')
  })
})
