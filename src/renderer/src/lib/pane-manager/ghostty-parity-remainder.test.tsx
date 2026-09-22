// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import TerminalSearch from '../../components/TerminalSearch'
import { buildPreviewTerminalOptions } from '../../components/dashboard-popout/preview-terminal-options'
import { TerminalSettingsPreview } from '../../components/settings/TerminalSettingsPreview'
import {
  composeActiveTerminalTheme,
  hexToRgba,
  isHexColor
} from '../../components/terminal-pane/terminal-appearance'
import { scheduleImagePasteWebglAtlasRecovery } from '../../components/terminal-pane/terminal-webgl-atlas-recovery'
import { safeFind } from '../../components/terminal-search-safe-find'
import {
  DEFAULT_TERMINAL_THEME_DARK,
  clampNumber,
  getTerminalTheme,
  normalizeColor
} from '@/lib/terminal-theme'
import { getTheme, getThemeNames } from '@/lib/terminal-themes-data'
import {
  buildDefaultTerminalOptions,
  normalizeTerminalFastScrollSensitivity,
  normalizeTerminalScrollSensitivity,
  resolveTerminalCursorInactiveStyle
} from './pane-terminal-options'
import { applyTerminalGpuAcceleration } from './pane-terminal-gpu-acceleration'
import {
  ENABLE_WEBGL_RENDERER,
  attachWebgl,
  shouldUseTerminalWebgl
} from './pane-webgl-renderer'
import {
  findRtlJoinRanges,
  isStrongRtlCodePoint,
  registerArabicShapingJoiner
} from './terminal-arabic-shaping-joiner'
import {
  getTerminalWebglAutoDecision,
  isLinuxRendererHost,
  resetTerminalWebglAutoDecision
} from './terminal-webgl-auto-policy'
import {
  resetHiddenWebglRetentionForTest,
  retainedHiddenWebglOwnerCountForTest,
  tryRetainHiddenPanesWebgl
} from './terminal-webgl-hidden-retention'

function render(node: ReturnType<typeof createElement>): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  return { container, root }
}

describe('ghostty parity remainder', () => {
  it('keeps search alive when a decoration width is not a positive integer', () => {
    expect(safeFind(() => true, 'é')).toBe(true)
    expect(
      safeFind(() => {
        throw new Error('This API only accepts positive integers')
      }, 'é')
    ).toBe(false)
    expect(() =>
      safeFind(() => {
        throw new Error('other')
      }, 'é')
    ).toThrow('other')
    const found: string[] = []
    const ref = { current: { query: '', caseSensitive: false, regex: false } }
    let closed = 0
    const { container, root } = render(
      createElement(TerminalSearch, {
        isOpen: true,
        onClose: () => {
          closed += 1
        },
        terminal: {
          clearSearch() {},
          findNext(term: string) {
            found.push(term)
            throw new Error('This API only accepts positive integers')
          },
          findPrevious() {
            return false
          }
        },
        searchStateRef: ref
      })
    )
    const input = container.querySelector('input')
    expect(input).toBeTruthy()
    act(() => {
      const prototype = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')
      prototype?.set?.call(input, 'é')
      input?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(ref.current.query).toBe('é')
    expect(found).toEqual(['é'])
    const searchRoot = container.querySelector('[data-terminal-search-root]')
    act(() => {
      searchRoot?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(closed).toBe(1)
    act(() => {
      root.unmount()
    })
  })

  it('builds pane and preview options from the same cursor and scroll rules', () => {
    expect(normalizeTerminalScrollSensitivity(undefined)).toBe(1.15)
    expect(normalizeTerminalScrollSensitivity(0)).toBe(0.1)
    expect(normalizeTerminalScrollSensitivity(99)).toBe(10)
    expect(normalizeTerminalFastScrollSensitivity(undefined)).toBe(5)
    expect(resolveTerminalCursorInactiveStyle('bar')).toBe('bar')
    expect(resolveTerminalCursorInactiveStyle('block')).toBe('outline')
    const defaults = buildDefaultTerminalOptions()
    expect(defaults.scrollback).toBe(5000)
    expect(defaults.macOptionIsMeta).toBe(false)
    expect(defaults.cursorInactiveStyle).toBe('outline')
    const preview = buildPreviewTerminalOptions({
      settings: null,
      terminalInput: null,
      macOptionIsMeta: true,
      theme: { background: '#000000' },
      themeMode: 'dark',
      cols: 80,
      rows: 24,
      scrollback: 200
    })
    expect(preview.fontSize).toBe(14)
    expect(preview.cols).toBe(80)
    expect(preview.scrollback).toBe(200)
    expect(preview.macOptionIsMeta).toBe(true)
    expect(preview.cursorInactiveStyle).toBe('outline')
  })

  it('resolves a builtin theme and composes the scrollbar ruler', () => {
    expect(getThemeNames()).toContain(DEFAULT_TERMINAL_THEME_DARK)
    const theme = getTheme(DEFAULT_TERMINAL_THEME_DARK)
    expect(theme?.background).toBeTruthy()
    expect(getTerminalTheme(undefined, DEFAULT_TERMINAL_THEME_DARK)?.background).toBe(theme?.background)
    expect(clampNumber(9, 0, 1)).toBe(1)
    expect(normalizeColor('  #fff ', '#000')).toBe('#fff')
    expect(hexToRgba('#abc', 0.5)).toBe('rgba(170, 187, 204, 0.5)')
    expect(isHexColor('#112233')).toBe(true)
    expect(isHexColor('red')).toBe(false)
    expect(
      composeActiveTerminalTheme(null, {
        terminalColorOverrides: {},
        terminalBackgroundOpacity: 1,
        terminalCursorOpacity: 1
      })
    ).toBeNull()
    const composed = composeActiveTerminalTheme(
      { background: '#111111' },
      { terminalColorOverrides: {}, terminalBackgroundOpacity: 1, terminalCursorOpacity: 1 }
    )
    expect(composed?.background).toBe('rgba(17, 17, 17, 1)')
    expect(composed?.overviewRulerBorder).toBe('transparent')
  })

  it('joins an Arabic run and ignores Latin text', () => {
    expect(isStrongRtlCodePoint(0x0627)).toBe(true)
    expect(isStrongRtlCodePoint(0x41)).toBe(false)
    expect(findRtlJoinRanges('ab')).toEqual([])
    const ranges = findRtlJoinRanges('مرحبا')
    expect(ranges).toEqual([[0, 'مرحبا'.length]])
    let handler: (text: string) => [number, number][] = () => []
    let dropped = 0
    const stop = registerArabicShapingJoiner(
      {
        registerCharacterJoiner(fn: (text: string) => [number, number][]) {
          handler = fn
          return 7
        },
        deregisterCharacterJoiner(id: number) {
          dropped = id
        }
      },
      () => true
    )
    expect(handler('مرحبا')).toEqual([[0, 'مرحبا'.length]])
    stop()
    expect(dropped).toBe(7)
    expect(registerArabicShapingJoiner({}, () => true)()).toBeUndefined()
  })

  it('does not attach the WebGL rasterizer on the Ghostty path', () => {
    expect(ENABLE_WEBGL_RENDERER).toBe(false)
    expect(shouldUseTerminalWebgl({} as never)).toBe(false)
    const pane = {
      terminalGpuAcceleration: 'auto',
      webglDisabledAfterContextLoss: true,
      webglAttachFailedSinceRecovery: true,
      pendingWebglRefreshRafId: null,
      gpuRenderingEnabled: false,
      webglAttachmentDeferred: false
    }
    attachWebgl(pane as never)
    expect(pane.gpuRenderingEnabled).toBe(false)
    applyTerminalGpuAcceleration([pane as never], { terminalGpuAcceleration: 'auto' } as never, 'off')
    expect(pane.terminalGpuAcceleration).toBe('off')
    resetHiddenWebglRetentionForTest()
    expect(tryRetainHiddenPanesWebgl({}, () => [pane as never])).toBe(false)
    expect(retainedHiddenWebglOwnerCountForTest()).toBe(0)
    expect(isLinuxRendererHost('MacIntel', 'Mozilla/5.0 (Macintosh)')).toBe(false)
    expect(isLinuxRendererHost('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe(true)
    const previousPlatform = navigator.platform
    const previousAgent = navigator.userAgent
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true })
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh)',
      configurable: true
    })
    resetTerminalWebglAutoDecision()
    const decision = getTerminalWebglAutoDecision()
    Object.defineProperty(navigator, 'platform', { value: previousPlatform, configurable: true })
    Object.defineProperty(navigator, 'userAgent', { value: previousAgent, configurable: true })
    resetTerminalWebglAutoDecision()
    expect(decision).toMatchObject({ allowWebgl: true, reason: 'non-linux' })
    let frames = 0
    const previousFrame = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (callback) => {
      frames += 1
      callback(0)
      return 1
    }
    scheduleImagePasteWebglAtlasRecovery()
    globalThis.requestAnimationFrame = previousFrame
    expect(frames).toBe(1)
  })

  it('mounts the settings preview on a Ghostty canvas', () => {
    const settings = {
      theme: 'dark',
      terminalFontFamily: 'SF Mono',
      terminalFontSize: 14,
      terminalFontWeight: 400,
      terminalFontWeightBold: 500,
      terminalLineHeight: 1,
      terminalCursorStyle: 'block',
      terminalCursorBlink: true,
      terminalLigatures: 'off',
      terminalThemeDark: DEFAULT_TERMINAL_THEME_DARK,
      terminalThemeLight: 'Builtin Tango Light',
      terminalUseSeparateLightTheme: false,
      terminalDividerColorDark: '#333333',
      terminalDividerColorLight: '#dddddd',
      terminalColorOverrides: {},
      terminalBackgroundOpacity: 1,
      terminalCursorOpacity: 1,
      terminalDividerThicknessPx: 3,
      terminalInactivePaneOpacity: 0.6,
      terminalActivePaneOpacity: 1,
      terminalPaneOpacityTransitionMs: 0,
      terminalFocusFollowsMouse: false,
      terminalCustomThemes: []
    } as GlobalSettings
    const { container, root } = render(
      createElement(TerminalSettingsPreview, {
        title: 'Preview title',
        settings,
        systemPrefersDark: true
      })
    )
    expect(container.textContent).toContain('Preview title')
    expect(container.querySelector('canvas')).toBeTruthy()
    act(() => {
      root.unmount()
    })
  })
})
