import { formatTerminal } from './ghostty-format'
import { collectHyperlinkRanges, type HyperlinkRange } from './ghostty-hyperlinks'
import { encodePaste } from './ghostty-paste'
import { readSelection, selectAllOnTerminal } from './ghostty-selection'
import { decodeNativeSnapshot, encodeNativeSnapshot } from './ghostty-snapshot'
import { bindGhosttyVt, rebindGhosttyVt, unbindGhosttyVt } from './ghostty-vt-access'
import type { GhosttyVtHost, WritePtyCallback } from './wasm-host'

export type TerminalGeometry = {
  cols: number
  rows: number
  cellWidthPx?: number
  cellHeightPx?: number
}

export type TerminalCapture = {
  nativeSnapshot: Uint8Array
}

export type GhosttyTerminalOptions = {
  cols: number
  rows: number
  scrollbackLines?: number
  onWritePty?: WritePtyCallback
}

const DEFAULT_SCROLLBACK = 5000
const CONTINUATION_MAX_BYTES = 4096
export class GhosttyTerminal {
  private readonly host: GhosttyVtHost
  private term: number
  private userdata: number
  private disposed = false

  constructor(host: GhosttyVtHost, options: GhosttyTerminalOptions) {
    this.host = host
    const slot = host.allocOpaque()
    host.check(
      host.exports.ghostty_terminal_new(0, slot, options.cols, options.rows),
      'ghostty_terminal_new'
    )
    this.term = host.takeOpaque(slot)
    host.freeOpaque(slot)
    bindGhosttyVt(this, host, this.term)
    this.userdata = host.registerWritePty(options.onWritePty)
    host.check(
      host.exports.ghostty_terminal_set(
        this.term,
        host.enumValue('GhosttyTerminalOption', 'USERDATA'),
        this.userdata
      ),
      'set USERDATA'
    )
    if (options.onWritePty) {
      host.check(
        host.exports.ghostty_terminal_set(
          this.term,
          host.enumValue('GhosttyTerminalOption', 'WRITE_PTY'),
          host.writePtyTableIndex
        ),
        'set WRITE_PTY'
      )
    }
    const scrollback = options.scrollbackLines ?? DEFAULT_SCROLLBACK
    this.setU32Option('SCROLLBACK_MAX_LINES', scrollback)
    this.setU32Option('CONTINUATION_MAX_BYTES', CONTINUATION_MAX_BYTES)
  }

  reset(): void {
    this.assertOpen()
    this.host.exports.ghostty_terminal_reset(this.term)
  }

  writePtyOutput(data: Uint8Array | string): void {
    this.assertOpen()
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    if (bytes.length === 0) {
      return
    }
    const written = this.host.writeBytes(bytes)
    this.host.exports.ghostty_terminal_vt_write(this.term, written.ptr, written.len)
    this.host.free(written.ptr, written.len)
  }

  resize(geometry: TerminalGeometry): void {
    this.assertOpen()
    this.host.check(
      this.host.exports.ghostty_terminal_resize(
        this.term,
        geometry.cols,
        geometry.rows,
        geometry.cellWidthPx ?? 8,
        geometry.cellHeightPx ?? 16
      ),
      'ghostty_terminal_resize'
    )
  }

  get cols(): number {
    return this.getU16('COLS')
  }

  get rows(): number {
    return this.getU16('ROWS')
  }

  get isAlternateScreen(): boolean {
    return (
      this.getI32('ACTIVE_SCREEN') === this.host.enumValue('GhosttyTerminalScreen', 'ALTERNATE')
    )
  }

  get title(): string {
    return this.getString('TITLE')
  }

  get pwd(): string {
    return this.getString('PWD')
  }

  get cursor(): { x: number; y: number } {
    return { x: this.getU16('CURSOR_X'), y: this.getU16('CURSOR_Y') }
  }

  get kittyKeyboardFlags(): number {
    return this.getU8('KITTY_KEYBOARD_FLAGS')
  }

  get mouseTracking(): boolean {
    return this.getBool('MOUSE_TRACKING')
  }

  getMode(mode: number): boolean {
    const size = this.host.structSize('GhosttyTerminalModeConfig')
    const ptr = this.host.alloc(size)
    this.host.bytes().fill(0, ptr, ptr + size)
    this.host.view().setUint16(ptr, mode, true)
    const result = this.host.exports.ghostty_terminal_get(
      this.term,
      this.host.enumValue('GhosttyTerminalData', 'MODE'),
      ptr
    )
    const value = result === this.host.success && this.host.bytes()[ptr + 2] !== 0
    this.host.free(ptr, size)
    return value
  }

  get scrollbackRows(): number {
    return this.getUsize('SCROLLBACK_ROWS')
  }

  get totalRows(): number {
    return this.getUsize('TOTAL_ROWS')
  }

  readViewportText(): string {
    return formatTerminal(this.host, this.term, 'PLAIN')
  }

  readVt(options?: { extras?: boolean }): string {
    return formatTerminal(this.host, this.term, 'VT', options)
  }

  collectHyperlinkRanges(): HyperlinkRange[] {
    this.assertOpen()
    return collectHyperlinkRanges(this.host, this.term, this.cols, this.totalRows)
  }

  encodePaste(text: string): string {
    this.assertOpen()
    return encodePaste(this.host, text, this.getMode(2004))
  }

  selectAll(): void {
    this.assertOpen()
    selectAllOnTerminal(this.host, this.term)
  }

  readSelection(): string {
    this.assertOpen()
    return readSelection(this.host, this.term)
  }

  capture(): TerminalCapture {
    this.assertOpen()
    return { nativeSnapshot: encodeNativeSnapshot(this.host, this.term) }
  }

  restore(capture: TerminalCapture): void {
    this.assertOpen()
    const restored = decodeNativeSnapshot(this.host, capture.nativeSnapshot)
    this.host.exports.ghostty_terminal_free(this.term)
    this.term = restored
    rebindGhosttyVt(this, this.term)
    this.host.check(
      this.host.exports.ghostty_terminal_set(
        this.term,
        this.host.enumValue('GhosttyTerminalOption', 'USERDATA'),
        this.userdata
      ),
      'restore USERDATA'
    )
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.host.exports.ghostty_terminal_free(this.term)
    this.host.unregisterWritePty(this.userdata)
    unbindGhosttyVt(this)
  }

  private setU32Option(name: string, value: number): void {
    const ptr = this.host.alloc(4)
    this.host.writeU32(ptr, value)
    this.host.check(
      this.host.exports.ghostty_terminal_set(
        this.term,
        this.host.enumValue('GhosttyTerminalOption', name),
        ptr
      ),
      `set ${name}`
    )
    this.host.free(ptr, 4)
  }

  private getU16(name: string): number {
    return this.getNumeric(name, 2)
  }

  private getU8(name: string): number {
    return this.getNumeric(name, 1)
  }

  private getBool(name: string): boolean {
    return this.getU8(name) !== 0
  }

  private getI32(name: string): number {
    return this.getNumeric(name, 4, true)
  }

  private getUsize(name: string): number {
    return this.getNumeric(name, 4)
  }

  private getNumeric(name: string, bytes: 1 | 2 | 4, signed = false): number {
    const ptr = this.host.alloc(bytes)
    this.host.check(
      this.host.exports.ghostty_terminal_get(
        this.term,
        this.host.enumValue('GhosttyTerminalData', name),
        ptr
      ),
      `get ${name}`
    )
    const view = this.host.view()
    const value =
      bytes === 1
        ? (this.host.bytes()[ptr] ?? 0)
        : bytes === 2
          ? view.getUint16(ptr, true)
          : signed
            ? view.getInt32(ptr, true)
            : this.host.readU32(ptr)
    this.host.free(ptr, bytes)
    return value
  }

  private getString(name: string): string {
    const ptr = this.host.alloc(8)
    const result = this.host.exports.ghostty_terminal_get(
      this.term,
      this.host.enumValue('GhosttyTerminalData', name),
      ptr
    )
    if (result !== this.host.success) {
      this.host.free(ptr, 8)
      return ''
    }
    const dataPtr = this.host.readU32(ptr)
    const len = this.host.readU32(ptr + 4)
    const text = new TextDecoder().decode(this.host.bytes().subarray(dataPtr, dataPtr + len))
    this.host.free(ptr, 8)
    return text
  }

  private assertOpen(): void {
    if (this.disposed) {
      throw new Error('GhosttyTerminal is disposed')
    }
  }
}
