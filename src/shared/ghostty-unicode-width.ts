export const ZERO_WIDTH_JOINER = 0x200d

export function ghosttyWcwidth(codepoint: number): 0 | 1 | 2 {
  if (codepoint === 0) {
    return 0
  }
  if (codepoint < 32 || (codepoint >= 0x7f && codepoint < 0xa0)) {
    return 0
  }
  if (codepoint === ZERO_WIDTH_JOINER) {
    return 0
  }
  if (
    (codepoint >= 0x300 && codepoint <= 0x36f) ||
    (codepoint >= 0x1ab0 && codepoint <= 0x1aff) ||
    (codepoint >= 0x1dc0 && codepoint <= 0x1dff) ||
    (codepoint >= 0x20d0 && codepoint <= 0x20ff) ||
    (codepoint >= 0xfe20 && codepoint <= 0xfe2f)
  ) {
    return 0
  }
  if (
    (codepoint >= 0x1100 && codepoint <= 0x115f) ||
    (codepoint >= 0x2e80 && codepoint <= 0xa4cf) ||
    (codepoint >= 0xac00 && codepoint <= 0xd7a3) ||
    (codepoint >= 0xf900 && codepoint <= 0xfaff) ||
    (codepoint >= 0xfe30 && codepoint <= 0xfe4f) ||
    (codepoint >= 0xff00 && codepoint <= 0xff60) ||
    (codepoint >= 0xffe0 && codepoint <= 0xffe6) ||
    (codepoint >= 0x20000 && codepoint <= 0x3fffd)
  ) {
    return 2
  }
  if (codepoint >= 0x1f300) {
    return 2
  }
  return 1
}

export function ghosttyStringWidth(text: string): number {
  let width = 0
  let prevWidth = 0
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0
    if (cp === ZERO_WIDTH_JOINER && prevWidth > 0) {
      continue
    }
    const w = ghosttyWcwidth(cp)
    width += w
    if (w > 0) {
      prevWidth = w
    }
  }
  return width
}
