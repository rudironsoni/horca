import { afterEach, describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'

const CHUNK_FIXTURE =
  '\x1b[?1049h\x1b[>1u\x1b[31;44;1mhi\x1b[3;8r\x1b[?6h\x1b[2;7H\x1b7\x1b[4;5H\x1b[!p'

function observe(emulator: HeadlessEmulator) {
  const snapshot = emulator.getSnapshot()
  return {
    lines: emulator.getVisibleLines(),
    modes: snapshot.modes,
    cwd: snapshot.cwd,
    frameRestoreAnsi: snapshot.frameRestoreAnsi ?? '',
    snapshotAnsi: snapshot.snapshotAnsi,
    pendingEscapeTailAnsi: snapshot.pendingEscapeTailAnsi ?? ''
  }
}

describe('D1-H Ghostty semantic regression', () => {
  let emulator: HeadlessEmulator | undefined

  afterEach(() => {
    emulator?.dispose()
    emulator = undefined
  })

  it('DECSC/DECRC under DECOM restores C then S', async () => {
    emulator = new HeadlessEmulator({ cols: 20, rows: 10 })
    await emulator.write('\x1b[?1049h\x1b[3;8r\x1b[?6h\x1b[2;7H\x1b7\x1b[4;5H')
    const restored = new HeadlessEmulator({ cols: 20, rows: 10 })
    await restored.write(emulator.getSnapshot().frameRestoreAnsi ?? '')
    await restored.write('C\x1b8S')
    expect(restored.getVisibleLines()[5]?.[4]).toBe('C')
    expect(restored.getVisibleLines()[3]?.[6]).toBe('S')
    restored.dispose()
  })

  it('DECSC before DECOM restores saved home-relative cell', async () => {
    emulator = new HeadlessEmulator({ cols: 20, rows: 10 })
    await emulator.write('\x1b[?1049h\x1b[1;3H\x1b7\x1b[3;8r\x1b[?6h\x1b[4;5H')
    const restored = new HeadlessEmulator({ cols: 20, rows: 10 })
    await restored.write(emulator.getSnapshot().frameRestoreAnsi ?? '')
    await restored.write('C\x1b8S')
    expect(restored.getVisibleLines()[5]?.[4]).toBe('C')
    expect(restored.getVisibleLines()[0]?.[2]).toBe('S')
    restored.dispose()
  })

  it('frameRestoreAnsi carries current SGR', async () => {
    emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    await emulator.write('\x1b[?1049h\x1b[?1004h\x1b[?25l\x1b[5;10H\x1b7\x1b[31;44;1mframe')
    expect(emulator.getSnapshot().frameRestoreAnsi).toContain('\x1b[31;44;1m')
  })

  it('DECSTR clears kittyKeyboardFlags', async () => {
    emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    await emulator.write('\x1b[>1u')
    expect(emulator.getSnapshot().modes.kittyKeyboardFlags).toBe(1)
    await emulator.write('\x1b[!p')
    expect(emulator.getSnapshot().modes.kittyKeyboardFlags).toBe(0)
  })

  it('chunk-split DECSTR still clears kitty flags', async () => {
    emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    await emulator.write('\x1b[>1u')
    await emulator.write('\x1b')
    await emulator.write('[!')
    await emulator.write('p')
    expect(emulator.getSnapshot().modes.kittyKeyboardFlags).toBe(0)
  })

  it('one-byte writes match one-chunk writes for DECSC/SGR/DECSTR/kitty', async () => {
    const whole = new HeadlessEmulator({ cols: 20, rows: 10 })
    const split = new HeadlessEmulator({ cols: 20, rows: 10 })
    try {
      await whole.write(CHUNK_FIXTURE)
      for (const ch of CHUNK_FIXTURE) await split.write(ch)
      expect(observe(split)).toEqual(observe(whole))
    } finally {
      whole.dispose()
      split.dispose()
    }
  })
})
