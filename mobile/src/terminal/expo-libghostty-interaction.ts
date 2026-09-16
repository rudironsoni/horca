export type ExpoLibghosttySelectionEvent = {
  nativeEvent: {
    active?: boolean
    text?: string
  }
}

export type ExpoLibghosttyUrlEvent = {
  nativeEvent: {
    url?: string
    path?: string
  }
}

export type ExpoLibghosttyTapEvent = {
  nativeEvent: {
    pathText?: string
    line?: number | null
    column?: number | null
  }
}

export function selectionFromNativeEvent(
  event: ExpoLibghosttySelectionEvent,
  onSelectionMode?: (active: boolean) => void,
  onSelectionCopy?: (text: string) => void,
  onSelectionEvicted?: () => void
): void {
  const { active, text } = event.nativeEvent
  if (typeof active === 'boolean') {
    onSelectionMode?.(active)
    if (!active) {
      onSelectionEvicted?.()
    }
  }
  if (typeof text === 'string' && text.length > 0) {
    onSelectionCopy?.(text)
  }
}

export function urlFromNativeEvent(
  event: ExpoLibghosttyUrlEvent,
  onOpenUrl?: (url: string) => void
): void {
  const url = event.nativeEvent.url ?? event.nativeEvent.path
  if (url) {
    onOpenUrl?.(url)
  }
}

export function fileTapFromNativeEvent(
  event: ExpoLibghosttyTapEvent,
  onFileTap?: (pathText: string, line: number | null, column: number | null) => void
): void {
  const pathText = event.nativeEvent.pathText
  if (!pathText) {
    return
  }
  onFileTap?.(pathText, event.nativeEvent.line ?? null, event.nativeEvent.column ?? null)
}
