import { afterEach, describe, expect, it } from 'vitest'
import { HeadlessEmulator } from './headless-emulator'
import { collectHeadlessOscLinkRanges } from './headless-osc-link-ranges'
import { readKittyKeyboardFlags, readTerminalModes } from './headless-emulator-modes'
import { buildFrameRestoreSnapshotFields } from './terminal-frame-restore-sequences'
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
      { mouseTrackingMode: 'vt200', sgrMouseMode: true, sgrMousePixelsMode: false } as never
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
    let handler: (params: Array<number | number[]>) => boolean = () => false
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
    let csi: (params: Array<number | number[]>) => boolean = () => false
    const replies: string[] = []
    let base: TerminalViewAttributes | null = null
    const installed = installTerminalViewAttributeResponder({
      parser: {
        registerOscHandler(id, callback) {
          osc.set(id, callback)
          return { dispose() {} }
        },
        registerCsiHandler(_query, callback) {
          csi = callback as (params: Array<number | number[]>) => boolean
          return { dispose() {} }
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
    expect(csi([996])).toBe(true)
    expect(replies[1]).toBe('\x1b[?997;1n')
    expect(csi([6])).toBe(false)
    installed.clearColorOverrides()
  })
})

describe('headless link and frame restore', () => {
  it('returns no OSC ranges when the terminal has no link service', () => {
    const ranges = collectHeadlessOscLinkRanges(
      {
        cols: 4,
        rows: 1,
        buffer: { active: { length: 1, getNullCell: () => ({}), getLine: () => undefined } }
      } as never,
      undefined
    )
    expect(ranges).toEqual([])
  })

  it('reads one OSC 8 cell into a column range', () => {
    const scratch: { extended?: { urlId?: number }; hasExtendedAttrs?: () => boolean } = {}
    const line = {
      length: 2,
      getCell: (col: number, cell: typeof scratch) => {
        cell.extended = { urlId: col === 0 ? 7 : 0 }
        cell.hasExtendedAttrs = () => col === 0
        return cell
      }
    }
    const ranges = collectHeadlessOscLinkRanges(
      {
        cols: 2,
        rows: 1,
        buffer: {
          active: {
            length: 1,
            getNullCell: () => scratch,
            getLine: () => line
          }
        },
        _core: { _oscLinkService: { getLinkData: () => ({ uri: 'https://example.com/é' }) } }
      } as never,
      undefined
    )
    expect(ranges).toEqual([
      { row: 0, startCol: 0, endCol: 1, uri: 'https://example.com/é' }
    ])
  })

  it('emits alt-screen frame sequences and an empty object off the alt screen', () => {
    const terminal = {
      cols: 80,
      rows: 24,
      modes: {
        bracketedPasteMode: true,
        applicationCursorKeysMode: false,
        applicationKeypadMode: false,
        insertMode: false,
        reverseWraparoundMode: false,
        sendFocusMode: false,
        wraparoundMode: true,
        showCursor: true
      },
      buffer: { active: { cursorX: 1, cursorY: 2 }, normal: { length: 0 } }
    }
    const off = buildFrameRestoreSnapshotFields(
      { serialize: () => 'PEN' },
      terminal as never,
      {
        alternateScreen: false,
        bracketedPaste: true,
        mouseTracking: false,
        applicationCursor: false
      }
    )
    expect(off).toEqual({})
    const on = buildFrameRestoreSnapshotFields(
      { serialize: () => 'PEN' },
      terminal as never,
      {
        alternateScreen: true,
        bracketedPaste: true,
        mouseTracking: true,
        mouseTrackingMode: 'vt200',
        applicationCursor: false
      }
    )
    expect(on.frameRestoreAnsi).toContain('\x1b[?1049h')
    expect(on.frameRestoreAnsi).toContain('\x1b[?2004h')
    expect(on.frameRestoreAnsi).toContain('\x1b[?1000h')
    expect(on.frameRestoreAnsi).toContain('PEN')
  })
})
