import { afterEach, describe, expect, it } from 'vitest'
import { GhosttyHeadlessEmulator as HeadlessEmulator } from './ghostty-headless-emulator'

describe('HeadlessEmulator protocol authority and model sequence', () => {
  let emulator: HeadlessEmulator

  afterEach(() => {
    emulator?.dispose()
  })

  it('does not emit query replies unless forwarding is opted in', async () => {
    const replies: string[] = []
    emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => {
        replies.push(reply)
      }
    })
    await emulator.write('\x1b]11;?\x07')
    expect(replies).toEqual([])
  })

  it('resize does not emit query replies or originate a backend write', async () => {
    const replies: string[] = []
    emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => {
        replies.push(reply)
      }
    })
    emulator.resize(100, 30)
    expect(replies).toEqual([])
    expect(emulator.getAppliedSize()).toEqual({ cols: 100, rows: 30 })
  })

  it('orders OUTPUT then RESIZE on one model sequence and blocks snapshots until applied', async () => {
    emulator = new HeadlessEmulator({ cols: 80, rows: 24 })
    const writeDone = emulator.write('hello')
    expect(emulator.canPublishSnapshot(1)).toBe(true)
    await writeDone
    expect(emulator.getModelSeq()).toBe(1)
    emulator.resize(90, 24)
    expect(emulator.getModelSeq()).toBe(2)
    expect(emulator.getProjectionAppliedModelSeq()).toBe(2)
    expect(emulator.canPublishSnapshot(2)).toBe(true)
    expect(emulator.canPublishSnapshot(3)).toBe(false)
    await emulator.write('world')
    expect(emulator.getModelSeq()).toBe(3)
    expect(emulator.canPublishSnapshot(3)).toBe(true)
  })
})
