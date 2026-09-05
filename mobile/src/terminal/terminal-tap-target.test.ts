import { describe, expect, it } from 'vitest'
import { resolveTerminalTapTarget } from './terminal-tap-target'

describe('resolveTerminalTapTarget', () => {
  it('opens an HTTP URL under the tapped column', () => {
    expect(resolveTerminalTapTarget('see https://example.com/docs.', 16)).toEqual({
      kind: 'url',
      url: 'https://example.com/docs'
    })
  })

  it('opens a file URL through the file flow', () => {
    expect(resolveTerminalTapTarget('file:///tmp/app.ts#L8C3', 10)).toEqual({
      kind: 'file',
      file: { pathText: '/tmp/app.ts', line: 8, column: 3 }
    })
  })

  it('opens a plain path with its line and column', () => {
    expect(resolveTerminalTapTarget('failed at src/app.ts:12:4', 15)).toEqual({
      kind: 'file',
      file: { pathText: 'src/app.ts', line: 12, column: 4 }
    })
  })
})
