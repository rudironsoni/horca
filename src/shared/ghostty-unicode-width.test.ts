import { describe, expect, it } from 'vitest'
import { ghosttyStringWidth, ghosttyWcwidth } from './ghostty-unicode-width'

describe('ghostty unicode width', () => {
  it('measures ascii, wide, and zwj sequences', () => {
    expect(ghosttyWcwidth(0x41)).toBe(1)
    expect(ghosttyWcwidth(0xac00)).toBe(2)
    expect(ghosttyWcwidth(0x200d)).toBe(0)
    expect(ghosttyStringWidth('a')).toBe(1)
    expect(ghosttyStringWidth('한')).toBe(2)
    expect(ghosttyStringWidth('🧑‍💻')).toBe(4)
  })
})
