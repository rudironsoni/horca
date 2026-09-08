import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { TerminalView, type TerminalTheme, type TerminalViewRef } from '@orca/libghostty-terminal'
import type { RuntimeMobileTerminalTheme } from '../../../src/shared/runtime-types'
import type { TerminalWebViewHandle, TerminalWebViewProps } from './terminal-webview-contract'
import { createTerminalWriteCoalescer } from './terminal-write-coalescer'

function mapTheme(theme?: RuntimeMobileTerminalTheme): TerminalTheme | undefined {
  const colors = theme?.theme
  if (!colors) {
    return undefined
  }
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursorColor: colors.cursor,
    selectionBackground: colors.selectionBackground,
    selectionForeground: colors.selectionForeground,
    palette: [
      colors.black,
      colors.red,
      colors.green,
      colors.yellow,
      colors.blue,
      colors.magenta,
      colors.cyan,
      colors.white,
      colors.brightBlack,
      colors.brightRed,
      colors.brightGreen,
      colors.brightYellow,
      colors.brightBlue,
      colors.brightMagenta,
      colors.brightCyan,
      colors.brightWhite
    ]
  }
}

export type { TerminalWebViewHandle } from './terminal-webview-contract'

export const TerminalWebView = forwardRef<TerminalWebViewHandle, TerminalWebViewProps>(
  function TerminalWebView(
    { style, terminalTheme, textScale = 1, onWebReady, onTerminalInput },
    ref
  ) {
    const nativeRef = useRef<TerminalViewRef>(null)
    const sizeRef = useRef({ cols: 80, rows: 24 })
    const writeCoalescer = useMemo(
      () =>
        createTerminalWriteCoalescer((data) => {
          void nativeRef.current?.writeText(data)
        }),
      []
    )

    useEffect(() => {
      return () => {
        writeCoalescer.clear()
      }
    }, [writeCoalescer])

    useEffect(() => {
      onWebReady?.()
    }, [onWebReady])

    const handleInput = useCallback(
      (event: { nativeEvent: { text: string } }) => {
        onTerminalInput?.(event.nativeEvent.text)
      },
      [onTerminalInput]
    )

    const handleResize = useCallback((event: { nativeEvent: { cols: number; rows: number } }) => {
      sizeRef.current = { cols: event.nativeEvent.cols, rows: event.nativeEvent.rows }
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        prepareForForegroundRecovery() {},
        write(data: string) {
          writeCoalescer.write(data)
        },
        init(_cols: number, _rows: number, initialData?: string) {
          writeCoalescer.clear()
          const snapshot = initialData ?? ''
          void nativeRef.current?.writeText(`\x1b[2J\x1b[3J\x1b[H${snapshot}`)
        },
        resize(cols: number, rows: number) {
          sizeRef.current = { cols, rows }
        },
        reflow() {},
        clear() {
          writeCoalescer.clear()
          void nativeRef.current?.writeText('\x1b[2J\x1b[3J\x1b[H')
        },
        measureFitDimensions() {
          return Promise.resolve(sizeRef.current)
        },
        resetZoom() {},
        cancelSelect() {},
        doSelectAll() {},
        awaitReady() {
          return Promise.resolve()
        }
      }),
      [writeCoalescer]
    )

    return (
      <TerminalView
        ref={nativeRef}
        style={style}
        fontSize={14 * textScale}
        theme={mapTheme(terminalTheme)}
        onInput={handleInput}
        onResize={handleResize}
      />
    )
  }
)
