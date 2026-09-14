import { describe, expect, it, vi } from 'vitest'
import {
  fileTapFromNativeEvent,
  selectionFromNativeEvent,
  urlFromNativeEvent
} from './expo-libghostty-interaction'

describe('expo-libghostty interaction mapping', () => {
  it('reports selection mode and copies native selection text', () => {
    const onSelectionMode = vi.fn()
    const onSelectionCopy = vi.fn()
    const onSelectionEvicted = vi.fn()
    selectionFromNativeEvent(
      { nativeEvent: { active: true, text: 'copied' } },
      onSelectionMode,
      onSelectionCopy,
      onSelectionEvicted
    )
    expect(onSelectionMode).toHaveBeenCalledWith(true)
    expect(onSelectionCopy).toHaveBeenCalledWith('copied')
    expect(onSelectionEvicted).not.toHaveBeenCalled()
    selectionFromNativeEvent(
      { nativeEvent: { active: false } },
      onSelectionMode,
      onSelectionCopy,
      onSelectionEvicted
    )
    expect(onSelectionMode).toHaveBeenCalledWith(false)
    expect(onSelectionEvicted).toHaveBeenCalled()
  })

  it('opens URLs from url or path fields', () => {
    const onOpenUrl = vi.fn()
    urlFromNativeEvent({ nativeEvent: { url: 'https://example.com' } }, onOpenUrl)
    urlFromNativeEvent({ nativeEvent: { path: 'file:///tmp/a' } }, onOpenUrl)
    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com')
    expect(onOpenUrl).toHaveBeenCalledWith('file:///tmp/a')
  })

  it('forwards file taps with optional line and column', () => {
    const onFileTap = vi.fn()
    fileTapFromNativeEvent({ nativeEvent: { pathText: 'src/a.ts', line: 4 } }, onFileTap)
    expect(onFileTap).toHaveBeenCalledWith('src/a.ts', 4, null)
  })
})
