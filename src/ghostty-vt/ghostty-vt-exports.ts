export type WritePtyCallback = (bytes: Uint8Array) => void

export type WasmExports = {
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
  ghostty_grid_ref_row: (ref: number, out: number) => number
  ghostty_grid_ref_cell: (ref: number, out: number) => number
  ghostty_grid_ref_graphemes: (ref: number, buf: number, bufLen: number, outLen: number) => number
  ghostty_grid_ref_style: (ref: number, out: number) => number
  ghostty_row_get: (row: bigint, data: number, out: number) => number
  ghostty_cell_get: (cell: bigint, data: number, out: number) => number
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
    bufLen: number,
    outLen: number
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
