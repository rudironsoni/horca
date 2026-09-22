import { afterEach, describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'
import { readKittyKeyboardFlags, readTerminalModes } from './headless-emulator-modes'
import {
  STARTUP_DA1_RESPONSE,
  StartupDeviceAttributesQueryFilter,
  installDeviceAttributesResponder
} from './startup-device-attributes-responder'
import { installTerminalViewAttributeResponder } from './terminal-view-attribute-responder'
import type { TerminalViewAttributes } from '../../shared/terminal-view-attributes'

describe('headless parity remainder', () => {
  let emulator: HeadlessEmulator | undefined

  afterEach(() => {
    emulator?.dispose()
  })

  it('keeps the headless re-export passive on a DA query', async () => {
    const replies: string[] = []
    emulator = new HeadlessEmulator({
      cols: 80,
      rows: 24,
      onQueryReply: (reply) => {
        replies.push(reply)
      }
    })
    await emulator.write('\x1b[c')
    expect(replies).toEqual([])
    expect(emulator.getAppliedSize()).toEqual({ cols: 80, rows: 24 })
  })

  it('reads snapshot modes from the live buffer without a renderer', () => {
    const modes = readTerminalModes(
      {
        buffer: { active: { type: 'alternate' } },
        modes: { bracketedPasteMode: true, applicationCursorKeysMode: true },
        _core: { coreService: { kittyKeyboard: { flags: 3 } } }
      },
      { mouseTrackingMode: 'button', sgrMouseMode: true, sgrMousePixelsMode: false }
    )
    expect(readKittyKeyboardFlags({ buffer: { active: { type: 'normal' } }, modes: { bracketedPasteMode: false, applicationCursorKeysMode: false } })).toBe(0)
    expect(modes.alternateScreen).toBe(true)
    expect(modes.applicationCursor).toBe(false)
    expect(modes.bracketedPaste).toBe(true)
    expect(modes.mouseTracking).toBe(true)
    expect(modes.kittyKeyboardFlags).toBe(3)
  })

  it('strips a startup DA1 query and answers only the primary form', () => {
    const filter = new StartupDeviceAttributesQueryFilter()
    expect(filter.accept('hi\x1b[cbye')).toBe('hibye')
    expect(filter.accept('x\x1b[')).toBe('x')
    expect(filter.accept('0c!')).toBe('!')
    const replies: string[] = []
    let disposed = false
    let handler: (params: number[]) => boolean = () => false
    const stop = installDeviceAttributesResponder({
      parser: {
        registerCsiHandler(_query, callback) {
          handler = callback
          return { dispose: () => { disposed = true } }
        }
      },
      response: STARTUP_DA1_RESPONSE,
      reply: (data) => {
        replies.push(data)
      }
    })
    expect(handler([])).toBe(true)
    expect(replies).toEqual(['\x1b[?1;2c'])
    expect(handler([1])).toBe(false)
    expect(replies).toHaveLength(1)
    stop()
    expect(disposed).toBe(true)
  })

  it('stays silent until a view snapshot exists, then reports the background', () => {
    const osc = new Map<number, (data: string) => boolean>()
    let csi: ((params: number[]) => boolean) | null = null
    const replies: string[] = []
    let base: TerminalViewAttributes | null = null
    const installed = installTerminalViewAttributeResponder({
      parser: {
        registerOscHandler(id, callback) {
          osc.set(id, callback)
        },
        registerCsiHandler(_query, callback) {
          csi = callback
        }
      },
      getBaseAttributes: () => base,
      emitReply: (reply) => {
        replies.push(reply)
      }
    })
    expect(osc.get(11)?.('?')).toBe(true)
    expect(replies).toEqual([])
    const ansi = Array.from({ length: 256 }, () => [1, 2, 3] as [number, number, number])
    base = {
      foreground: [255, 255, 255],
      background: [0, 0, 0],
      cursor: [255, 0, 0],
      ansi,
      colorSchemeMode: 'dark',
      cursorStyle: 'block',
      cursorBlink: true
    }
    osc.get(11)?.('?')
    expect(replies[0]).toBe('\x1b]11;rgb:0000/0000/0000\x1b\\')
    expect(csi?.([996])).toBe(true)
    expect(replies[1]).toBe('\x1b[?997;1n')
    expect(csi?.([6])).toBe(false)
    installed.clearColorOverrides()
  })
})
