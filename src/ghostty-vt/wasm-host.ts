import {
  enumValue,
  field,
  parseTypeLayout,
  structSize,
  type TypeField,
  type TypeLayout
} from './type-layout'

export type WritePtyCallback = (bytes: Uint8Array) => void

type WasmExports = {
  memory: WebAssembly.Memory
  __indirect_function_table: WebAssembly.Table
  ghostty_type_json: () => number
  ghostty_wasm_alloc: (len: number) => number
  ghostty_wasm_free: (ptr: number, len: number) => void
  ghostty_wasm_alloc_opaque: () => number
  ghostty_wasm_take_opaque: (slot: number) => number
  ghostty_wasm_free_opaque: (slot: number) => void
  ghostty_free: (allocator: number, ptr: number, len: number) => void
  ghostty_terminal_new: (allocator: number, out: number, cols: number, rows: number) => number
  ghostty_terminal_free: (term: number) => void
  ghostty_terminal_vt_write: (term: number, data: number, len: number) => void
  ghostty_terminal_resize: (
    term: number,
    cols: number,
    rows: number,
    cellWidthPx: number,
    cellHeightPx: number
  ) => number
  ghostty_terminal_set: (term: number, option: number, value: number) => number
  ghostty_terminal_get: (term: number, data: number, out: number) => number
  ghostty_terminal_reset: (term: number) => void
  ghostty_formatter_terminal_new: (
    allocator: number,
    out: number,
    term: number,
    opts: number
  ) => number
  ghostty_formatter_format_alloc: (
    formatter: number,
    allocator: number,
    outPtr: number,
    outLen: number
  ) => number
  ghostty_formatter_free: (formatter: number) => void
  ghostty_snapshot_encode_alloc: (
    term: number,
    allocator: number,
    outPtr: number,
    outLen: number
  ) => number
  ghostty_snapshot_decoder_new_buf: (
    allocator: number,
    out: number,
    buf: number,
    len: number
  ) => number
  ghostty_snapshot_decoder_decode: (decoder: number, outTerm: number) => number
  ghostty_snapshot_decoder_free: (decoder: number) => void
  ghostty_render_state_new: (allocator: number, out: number) => number
  ghostty_render_state_free: (state: number) => void
  ghostty_render_state_begin_update: (state: number) => number
  ghostty_render_state_end_update: (state: number) => number
  ghostty_render_state_update: (state: number, term: number) => number
  ghostty_render_state_clean: (state: number) => number
  ghostty_render_state_get: (state: number, data: number, out: number) => number
  ghostty_render_state_row_iterator_new: (allocator: number, out: number) => number
  ghostty_render_state_row_iterator_free: (iterator: number) => void
  ghostty_render_state_row_iterator_next: (iterator: number) => number
  ghostty_render_state_row_get: (iterator: number, data: number, out: number) => number
  ghostty_render_state_row_cells_new: (allocator: number, out: number) => number
  ghostty_render_state_row_cells_free: (cells: number) => void
  ghostty_render_state_row_cells_next: (cells: number) => number
  ghostty_render_state_row_cells_get: (cells: number, data: number, out: number) => number
  ghostty_terminal_grid_ref: (term: number, point: number, out: number) => number
  ghostty_grid_ref_hyperlink_uri: (
    ref: number,
    buf: number,
    bufLen: number,
    outLen: number
  ) => number
  ghostty_terminal_paste: (term: number, paste: number, outWritten: number) => number
  ghostty_paste_encode: (
    data: number,
    dataLen: number,
    bracketed: number,
    buf: number,
    bufLen: number,
    outWritten: number
  ) => number
  ghostty_terminal_scroll_viewport: (term: number, viewport: number) => void
  ghostty_terminal_select_all: (term: number, out: number) => number
  ghostty_terminal_selection_format_buf: (
    term: number,
    options: number,
    buf: number,
    bufLen: number,
    outWritten: number
  ) => number
  ghostty_search_new: (allocator: number, term: number, out: number) => number
  ghostty_search_free: (search: number) => void
  ghostty_search_set: (search: number, option: number, value: number) => number
  ghostty_search_run: (search: number) => number
  ghostty_search_get: (search: number, data: number, out: number) => number
  ghostty_key_encoder_new: (allocator: number, out: number) => number
  ghostty_key_encoder_free: (encoder: number) => void
  ghostty_key_encoder_setopt_from_terminal: (encoder: number, term: number) => number
  ghostty_key_encoder_encode: (
    encoder: number,
    event: number,
    buf: number,
    bufLen: number
  ) => number
  ghostty_key_event_new: (allocator: number, out: number) => number
  ghostty_key_event_free: (event: number) => void
  ghostty_key_event_set_action: (event: number, action: number) => void
  ghostty_key_event_set_key: (event: number, key: number) => void
  ghostty_key_event_set_mods: (event: number, mods: number) => void
  ghostty_key_event_set_utf8: (event: number, ptr: number, len: number) => number
  ghostty_mouse_encoder_new: (allocator: number, out: number) => number
  ghostty_mouse_encoder_free: (encoder: number) => void
  ghostty_mouse_encoder_setopt: (encoder: number, option: number, value: number) => void
  ghostty_mouse_encoder_setopt_from_terminal: (encoder: number, term: number) => void
  ghostty_mouse_encoder_encode: (
    encoder: number,
    event: number,
    buf: number,
    bufLen: number,
    outLen: number
  ) => number
  ghostty_mouse_event_new: (allocator: number, out: number) => number
  ghostty_mouse_event_free: (event: number) => void
  ghostty_mouse_event_set_action: (event: number, action: number) => void
  ghostty_mouse_event_set_button: (event: number, button: number) => void
  ghostty_mouse_event_set_mods: (event: number, mods: number) => void
  ghostty_mouse_event_set_position: (event: number, x: number, y: number) => void
  ghostty_unicode_codepoint_width: (cp: number) => number
  ghostty_unicode_grapheme_width: (cps: number, len: number, width: number) => number
  ghostty_selection_gesture_new: (allocator: number, out: number) => number
  ghostty_selection_gesture_free: (gesture: number, term: number) => void
  ghostty_selection_gesture_reset: (gesture: number, term: number) => void
  ghostty_selection_gesture_event: (
    gesture: number,
    term: number,
    event: number,
    outSelection: number
  ) => number
  ghostty_selection_gesture_event_new: (allocator: number, out: number, type: number) => number
  ghostty_selection_gesture_event_free: (event: number) => void
  ghostty_selection_gesture_event_set: (event: number, option: number, value: number) => number
}

export class GhosttyVtHost {
  readonly exports: WasmExports
  readonly layout: TypeLayout
  readonly success: number
  readonly writePtyTableIndex: number
  private readonly writePtyByUserdata = new Map<number, WritePtyCallback>()
  private nextUserdata = 1
  private cachedBuffer: ArrayBuffer | null = null
  private cachedU8: Uint8Array | null = null
  private cachedDv: DataView | null = null

  constructor(vtWasm: BufferSource, trampolineWasm: BufferSource) {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(vtWasm))
    this.exports = instance.exports as unknown as WasmExports
    this.layout = parseTypeLayout(this.readCString(this.exports.ghostty_type_json()))
    this.success = enumValue(this.layout, 'GhosttyResult', 'SUCCESS')
    const tramp = new WebAssembly.Instance(new WebAssembly.Module(trampolineWasm), {
      env: {
        write_pty: (_term: number, userdata: number, data: number, len: number) => {
          const callback = this.writePtyByUserdata.get(userdata)
          if (!callback) {
            return
          }
          callback(this.bytes().slice(data, data + len))
        }
      }
    })
    const table = this.exports.__indirect_function_table
    this.writePtyTableIndex = table.length
    table.grow(1)
    table.set(
      this.writePtyTableIndex,
      tramp.exports.trampoline as unknown as (
        term: number,
        userdata: number,
        data: number,
        len: number
      ) => void
    )
  }

  bytes(): Uint8Array {
    const buffer = this.exports.memory.buffer
    if (this.cachedBuffer !== buffer || !this.cachedU8) {
      this.cachedBuffer = buffer
      this.cachedU8 = new Uint8Array(buffer)
      this.cachedDv = new DataView(buffer)
    }
    return this.cachedU8
  }

  view(): DataView {
    this.bytes()
    return this.cachedDv as DataView
  }

  alloc(len: number): number {
    if (len === 0) {
      return 0
    }
    const ptr = this.exports.ghostty_wasm_alloc(len)
    if (ptr === 0) {
      throw new Error('ghostty_wasm_alloc failed')
    }
    return ptr
  }

  free(ptr: number, len: number): void {
    if (ptr !== 0) {
      this.exports.ghostty_wasm_free(ptr, len)
    }
  }

  allocOpaque(): number {
    const slot = this.exports.ghostty_wasm_alloc_opaque()
    if (slot === 0) {
      throw new Error('ghostty_wasm_alloc_opaque failed')
    }
    return slot
  }

  takeOpaque(slot: number): number {
    return this.exports.ghostty_wasm_take_opaque(slot)
  }

  freeOpaque(slot: number): void {
    this.exports.ghostty_wasm_free_opaque(slot)
  }

  check(result: number, label: string): void {
    if (result !== this.success) {
      throw new Error(`${label} failed: ${result}`)
    }
  }

  writeBytes(data: Uint8Array): { ptr: number; len: number } {
    const ptr = this.alloc(data.length)
    this.bytes().set(data, ptr)
    return { ptr, len: data.length }
  }

  readCString(ptr: number): string {
    const bytes = this.bytes()
    let end = ptr
    while (bytes[end] !== 0) {
      end += 1
    }
    return new TextDecoder().decode(bytes.subarray(ptr, end))
  }

  readU32(ptr: number): number {
    return this.view().getUint32(ptr, true)
  }

  writeU32(ptr: number, value: number): void {
    this.view().setUint32(ptr, value, true)
  }

  registerWritePty(callback: WritePtyCallback | undefined): number {
    const userdata = this.nextUserdata
    this.nextUserdata += 1
    if (callback) {
      this.writePtyByUserdata.set(userdata, callback)
    }
    return userdata
  }

  unregisterWritePty(userdata: number): void {
    this.writePtyByUserdata.delete(userdata)
  }

  structSize(typeName: string): number {
    return structSize(this.layout, typeName)
  }

  enumValue(typeName: string, name: string): number {
    return enumValue(this.layout, typeName, name)
  }

  field(typeName: string, fieldName: string): TypeField {
    return field(this.layout, typeName, fieldName)
  }
}
