import type { ComponentType } from 'react'
import { TerminalView, type TerminalViewProps } from 'expo-libghostty'
import type {
  ExpoLibghosttySelectionEvent,
  ExpoLibghosttyTapEvent,
  ExpoLibghosttyUrlEvent
} from './expo-libghostty-interaction'

export type ExpoLibghosttyPaneViewProps = TerminalViewProps & {
  keyboardEnabled?: boolean
  surfaceVisible?: boolean
  onSelectionChange?: (event: ExpoLibghosttySelectionEvent) => void
  onUrl?: (event: ExpoLibghosttyUrlEvent) => void
  onFilePath?: (event: ExpoLibghosttyTapEvent) => void
  onTap?: () => void
}

export type ExpoLibghosttySurfaceProps = {
  keyboardEnabled: false
  surfaceVisible: boolean
}

export function expoLibghosttySurfaceProps(surfaceVisible: boolean): ExpoLibghosttySurfaceProps {
  return {
    keyboardEnabled: false,
    surfaceVisible
  }
}

// oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: expo-libghostty types omit Horca pane hide/IME/selection props; the native view ignores unknown keys until the module grows them.
export const ExpoLibghosttyPaneView = TerminalView as ComponentType<ExpoLibghosttyPaneViewProps>
