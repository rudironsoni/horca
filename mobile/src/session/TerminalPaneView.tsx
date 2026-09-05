import {
  TerminalView,
  type TerminalInputEvent,
  type TerminalTapEvent,
  type TerminalTheme,
  type TerminalViewRef
} from '@orca/libghostty-terminal'
import { useCallback, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import type { RuntimeMobileTerminalTheme } from '../../../src/shared/runtime-types'
import { isUsableTerminalViewport } from '../terminal/terminal-native-viewport-update'
import { resolveTerminalTapTarget } from '../terminal/terminal-tap-target'

type TerminalPaneViewProps = {
  handle: string
  active: boolean
  keyboardLift: number
  terminalTheme?: RuntimeMobileTerminalTheme
  textScale: number
  onRef: (handle: string, ref: TerminalViewRef | null) => void
  onReady: (handle: string, cols: number, rows: number) => void
  onResize: (handle: string, cols: number, rows: number) => void
  onInput: (handle: string, input: TerminalInputEvent) => void
  onTap: (handle: string) => void
  onFileTap: (handle: string, pathText: string, line: number | null, column: number | null) => void
  onOpenUrl: (handle: string, url: string) => void
}

const ANSI_COLOR_KEYS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite'
] as const

function toGhosttyTheme(source?: RuntimeMobileTerminalTheme): TerminalTheme | undefined {
  if (!source) {
    return undefined
  }
  const colors = source.theme
  return {
    background: colors.background,
    foreground: colors.foreground,
    cursorColor: colors.cursor,
    selectionBackground: colors.selectionBackground,
    selectionForeground: colors.selectionForeground,
    palette: ANSI_COLOR_KEYS.map((key) => colors[key] ?? null)
  }
}

export function TerminalPaneView({
  handle,
  active,
  keyboardLift,
  terminalTheme,
  textScale,
  onRef,
  onReady,
  onResize,
  onInput,
  onTap,
  onFileTap,
  onOpenUrl
}: TerminalPaneViewProps) {
  const readyRef = useRef(false)
  const setRef = useCallback((ref: TerminalViewRef | null) => onRef(handle, ref), [handle, onRef])
  const theme = useMemo(() => toGhosttyTheme(terminalTheme), [terminalTheme])
  const handleTap = useCallback(
    (event: TerminalTapEvent) => {
      const target =
        typeof event.lineText === 'string' && typeof event.column === 'number'
          ? resolveTerminalTapTarget(event.lineText, event.column)
          : null
      if (target?.kind === 'file') {
        onFileTap(handle, target.file.pathText, target.file.line, target.file.column)
        return
      }
      if (target?.kind === 'url') {
        onOpenUrl(handle, target.url)
        return
      }
      onTap(handle)
    },
    [handle, onFileTap, onOpenUrl, onTap]
  )

  return (
    <View
      pointerEvents={active ? 'auto' : 'none'}
      style={[
        styles.terminalPane,
        keyboardLift > 0 && { transform: [{ translateY: -keyboardLift }] },
        !active && styles.terminalPaneHidden
      ]}
    >
      <TerminalView
        ref={setRef}
        style={styles.terminal}
        fontSize={8 * textScale}
        theme={theme}
        keyboardEnabled={false}
        surfaceVisible={active}
        onTap={({ nativeEvent }) => handleTap(nativeEvent)}
        onInput={({ nativeEvent }) => onInput(handle, nativeEvent)}
        onResize={({ nativeEvent }) => {
          const { cols, rows } = nativeEvent
          if (!isUsableTerminalViewport({ cols, rows })) {
            return
          }
          if (!readyRef.current) {
            readyRef.current = true
            onReady(handle, cols, rows)
          } else {
            onResize(handle, cols, rows)
          }
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  terminalPane: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  },
  terminalPaneHidden: {
    width: 0,
    height: 0,
    overflow: 'hidden'
  },
  terminal: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0
  }
})
