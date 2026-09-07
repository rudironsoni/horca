// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getGhosttyVtHostOrThrow } from '../../../../ghostty-vt/host-singleton'
import { OrcaPaneTerminal } from './orca-pane-terminal'

function stubCanvas(): CanvasRenderingContext2D {
  const ctx = {
    font: '',
    textBaseline: 'top',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    measureText: () => ({ width: 8 }),
    setTransform: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn()
  }
  return ctx as unknown as CanvasRenderingContext2D
}

describe('OrcaPaneTerminal CSI/OSC ingest', () => {
  beforeAll(() => {
    getGhosttyVtHostOrThrow()
    HTMLCanvasElement.prototype.getContext = vi.fn(() => stubCanvas()) as never
  })

  it('dispatches OSC 52, OSC 7, OSC 133, and DA1 from write', () => {
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    const seen: string[] = []
    terminal.parser.registerOscHandler(52, (data) => {
      seen.push(`52:${data}`)
      return true
    })
    terminal.parser.registerOscHandler(7, (data) => {
      seen.push(`7:${data}`)
      return true
    })
    terminal.parser.registerOscHandler(133, (data) => {
      seen.push(`133:${data}`)
      return true
    })
    terminal.parser.registerCsiHandler({ final: 'c' }, (params) => {
      seen.push(`da1:${params.join(',')}`)
      return true
    })
    terminal.write('\x1b]52;c;QQ\x07hello\x1b]7;file://host/tmp\x07\x1b]133;A\x07\x1b[c')
    expect(seen).toEqual(['52:c;QQ', '7:file://host/tmp', '133:A', 'da1:'])
    expect(terminal.serialize()).toContain('hello')
    terminal.dispose()
  })

  it('keeps a completion marker after a synchronized table dump', () => {
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    const top = 'RAW_EMOJI_FIXTURE_TABLE_TOP_unit'
    const marker = 'RAW_EMOJI_FIXTURE_TABLE_RESTORE_unit'
    const lines = Array.from({ length: 80 }, (_, index) => `${'━'.repeat(40)} row-${index}`)
    terminal.write(
      `\x1b[?2026h\x1b[2J\x1b[H${top}\r\n${lines.join('\r\n')}\r\nTAIL\r\n\x1b[?2026l${marker}\r\n`
    )
    const serialized = terminal.serialize()
    const plain = terminal.engine.readViewportText()
    const combined = `${serialized}\n${plain}`
    expect(combined).toContain(marker)
    expect(combined).toContain(top)
    const wide = Array.from({ length: 200 }, (_, index) => `┌${'─'.repeat(135)}┐ ${index} 🦤`)
    terminal.write(`\x1b[2J\x1b[H${wide.join('\r\n')}\r\n${marker}\r\n`)
    expect(terminal.serialize()).toContain(marker)
    terminal.dispose()
  })

  it('leaves unmatched CSI for Ghostty when the handler returns false', () => {
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    let hits = 0
    terminal.parser.registerCsiHandler({ final: 'c' }, () => {
      hits += 1
      return false
    })
    terminal.write('\x1b[1;1H')
    expect(hits).toBe(0)
    terminal.dispose()
  })

  it('notifies onTitleChange when Ghostty observes OSC 0', () => {
    const terminal = new OrcaPaneTerminal(document.createElement('div'))
    const titles: string[] = []
    terminal.onTitleChange((title) => {
      titles.push(title)
    })
    terminal.write('\x07\x1b]0;Hidden model side effects\x07marker\n')
    expect(terminal.engine.title).toBe('Hidden model side effects')
    expect(titles).toContain('Hidden model side effects')
    terminal.dispose()
  })
})
