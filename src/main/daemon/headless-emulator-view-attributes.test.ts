import { afterEach, describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'
import type { TerminalViewRgb } from '../../shared/terminal-view-attributes'

const BLACK: TerminalViewRgb = [0, 0, 0]
const WHITE: TerminalViewRgb = [255, 255, 255]

describe('HeadlessEmulator view-attribute responder', () => {
  let emulator: HeadlessEmulator | undefined

  afterEach(() => {
    emulator?.dispose()
    emulator = undefined
  })

  it('answers OSC 11 from pushed attributes through the query-reply sink', async () => {
    const replies: string[] = []
    emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => {
        replies.push(reply)
      }
    })
    emulator.installViewAttributeResponder(() => ({
      foreground: WHITE,
      background: BLACK,
      cursor: WHITE,
      ansi: Array.from({ length: 256 }, () => BLACK),
      colorSchemeMode: 'dark',
      cursorStyle: 'block',
      cursorBlink: false
    }))
    await emulator.write('\x1b]11;?\x07', { forwardQueryReplies: true })
    expect(replies.join('')).toContain('\x1b]11;rgb:0000/0000/0000\x1b\\')
  })

  it('stays silent for OSC 11 before the first attribute push', async () => {
    const replies: string[] = []
    emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => {
        replies.push(reply)
      }
    })
    emulator.installViewAttributeResponder(() => null)
    await emulator.write('\x1b]11;?\x07', { forwardQueryReplies: true })
    expect(replies).toEqual([])
  })
})
