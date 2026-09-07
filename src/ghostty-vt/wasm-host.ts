import type { WasmExports, WritePtyCallback } from './ghostty-vt-exports'
import {
  enumValue,
  field,
  parseTypeLayout,
  structSize,
  type TypeField,
  type TypeLayout
} from './type-layout'

export type { WritePtyCallback } from './ghostty-vt-exports'

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
