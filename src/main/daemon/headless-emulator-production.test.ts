import { describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'
import { GhosttyHeadlessEmulator } from './ghostty-headless-emulator'

describe('D1-H production HeadlessEmulator', () => {
  it('constructs GhosttyHeadlessEmulator with no xterm fallback', () => {
    expect(HeadlessEmulator).toBe(GhosttyHeadlessEmulator)
    const emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    try {
      expect(emulator.constructor.name).toBe('GhosttyHeadlessEmulator')
    } finally {
      emulator.dispose()
    }
  })
})
