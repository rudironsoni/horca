import { describe, expect, it } from 'vitest'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import {
  buildPreviewAppearanceOptions,
  buildPreviewTerminalOptions
} from './preview-terminal-options'

const SETTINGS = {
  terminalFontSize: 17,
  terminalFontFamily: 'Fira Code',
  terminalFontWeight: 500,
  terminalFontWeightBold: 800,
  terminalCursorStyle: 'bar',
  terminalCursorBlink: false,
  terminalLineHeight: 1.4
} as unknown as GlobalSettings

describe('buildPreviewAppearanceOptions', () => {
  it('carries the user terminal appearance a pane would apply', () => {
    const options = buildPreviewAppearanceOptions(SETTINGS)
    expect(options.fontSize).toBe(17)
    expect(options.fontFamily).toContain('Fira Code')
    expect(options.fontWeight).toBe(500)
    expect(options.fontWeightBold).toBe(800)
    expect(options.cursorStyle).toBe('bar')
    expect(options.cursorBlink).toBe(false)
    expect(options.lineHeight).toBe(1.4)
  })

  it('falls back to pane defaults with no settings hydrated', () => {
    const options = buildPreviewAppearanceOptions(null)
    expect(options.fontSize).toBe(14)
    expect(options.cursorBlink).toBe(true)
  })
})

describe('buildPreviewTerminalOptions', () => {
  it('pins preview scrollback independently of appearance', () => {
    const options = buildPreviewTerminalOptions({
      settings: SETTINGS,
      cols: 100,
      rows: 30,
      scrollback: 1000
    })
    expect(options.scrollback).toBe(1000)
    expect(options.fontSize).toBe(17)
  })
})
