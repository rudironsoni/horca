/**
 * #15192 coverage gap: the model-snapshot fuzzers exercise wide text only through
 * a single `你好世界` word, so a leading/trailing-cell fault in the main-side
 * snapshot path could survive them. This sweeps Hangul across every width where
 * a syllable can straddle the wrap boundary and pins that the restore the
 * renderer replays holds the same text the model does.
 */
import { describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'

const KO =
  '안녕하세요 오르카 테스트입니다. 결론부터 말씀드리면 시각적 피로도 절제된 럭셔리 다크 테마 가독성 행간(1.75) 적용 roadmap/complete-overhaul-backlog-history.md'

describe('headless emulator wide-character snapshot fidelity', () => {
  it('does not duplicate Hangul across widths', () => {
    const bad: string[] = []
    for (let cols = 12; cols <= 80; cols++) {
      const emu = new HeadlessEmulator({ cols, rows: 14 })
      emu.write(`${KO}\r\n${KO}\r\n`)
      const snap = emu.getSnapshot({ scrollbackRows: 200 })
      const src = emu.getVisibleLines().join('').replace(/\s+/g, '')
      const restored = new HeadlessEmulator({ cols, rows: 14 })
      restored.writeSync(`${snap.scrollbackAnsi ?? ''}${snap.snapshotAnsi}`)
      const rt = restored.getVisibleLines().join('').replace(/\s+/g, '')
      restored.dispose()
      expect(src.length).toBeGreaterThan(0)
      if (src !== rt) {
        bad.push(`cols=${cols}\n  src: ${src}\n  rt : ${rt}`)
      }
      emu.dispose()
    }
    expect(bad).toEqual([])
  })
})
