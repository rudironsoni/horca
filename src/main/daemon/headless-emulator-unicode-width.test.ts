import { describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'

// Why these oracles: agent TUIs position the cursor assuming the widths the
// on-screen xterm uses (Unicode 11 + ZWJ joining). If this mirror measures a
// preceding emoji differently, the positioned write lands on the wrong cell
// and the mirrored row tears — which snapshot restores then paint back.
describe('headless emulator unicode widths', () => {
  it('advances emoji as two cells so positioned writes land like the renderer', async () => {
    const emulator = new HeadlessEmulator({ cols: 40, rows: 4 })
    // 🤖 occupies columns 1-2 under Unicode 11 (one cell under the v6 default),
    // so "A" is at column 3, "B" at 4, and column 5 overwrites just past "B".
    await emulator.write('\x1b[H\u{1F916}AB')
    await emulator.write('\x1b[1;5HZ')
    expect(emulator.getVisibleLines()[0]).toBe('\u{1F916}ABZ')
    emulator.dispose()
  })

  it('keeps ZWJ emoji pairs on Ghostty cell width, not xterm joining', async () => {
    const emulator = new HeadlessEmulator({ cols: 40, rows: 4 })
    // Ghostty budgets woman + laptop as two wide cells (four columns). Column 3
    // is the laptop, so a CUP to 1;3 overwrites it and leaves X at column 5.
    await emulator.write('\x1b[H\u{1F469}\u{200D}\u{1F4BB}X')
    await emulator.write('\x1b[1;3HY')
    const line = emulator.getVisibleLines()[0] ?? ''
    expect(line).toContain('\u{1F469}')
    expect(line).toContain('Y')
    expect(line).toContain('X')
    expect(line).not.toBe('\u{1F469}\u{200D}\u{1F4BB}Y')
    emulator.dispose()
  })
})
