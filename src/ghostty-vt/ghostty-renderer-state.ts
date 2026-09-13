import type { ThemeRgb } from './ghostty-css-color'
import type { GhosttyVtHost } from './wasm-host'

export type FrameColors = {
  background: ThemeRgb
  foreground: ThemeRgb
  cursor: ThemeRgb
}

export type GhosttyRendererScratch = {
  dirty: number
  y: number
  iter: number
  cells: number
  colors: number
  selected: number
  bg: number
  fg: number
  style: number
  raw: number
  utf8: number
  utf8Storage: number
}

export function bindRenderRowIterator(
  host: GhosttyVtHost,
  state: number,
  scratch: GhosttyRendererScratch,
  rowIter: number
): number {
  host.writeU32(scratch.iter, rowIter)
  host.check(
    host.exports.ghostty_render_state_get(
      state,
      host.enumValue('GhosttyRenderStateData', 'ROW_ITERATOR'),
      scratch.iter
    ),
    'ROW_ITERATOR'
  )
  return host.readU32(scratch.iter)
}

export function readRenderDirty(
  host: GhosttyVtHost,
  state: number,
  scratch: GhosttyRendererScratch
): number {
  host.check(
    host.exports.ghostty_render_state_get(
      state,
      host.enumValue('GhosttyRenderStateData', 'DIRTY'),
      scratch.dirty
    ),
    'DIRTY'
  )
  return host.view().getInt32(scratch.dirty, true)
}

export function isRenderDirty(
  host: GhosttyVtHost,
  value: number,
  name: 'FALSE' | 'PARTIAL' | 'FULL'
): boolean {
  return value === host.enumValue('GhosttyRenderStateDirty', name)
}

export function readRenderColors(
  host: GhosttyVtHost,
  state: number,
  scratch: GhosttyRendererScratch
): FrameColors {
  const size = host.structSize('GhosttyRenderStateColors')
  host.bytes().fill(0, scratch.colors, scratch.colors + size)
  host.writeU32(scratch.colors, size)
  const result = host.exports.ghostty_render_state_get(
    state,
    host.enumValue('GhosttyRenderStateData', 'COLORS'),
    scratch.colors
  )
  if (result !== host.success) {
    return {
      background: readStateRgb(host, state, scratch, 'COLOR_BACKGROUND') ?? [0, 0, 0],
      foreground: readStateRgb(host, state, scratch, 'COLOR_FOREGROUND') ?? [221, 221, 221],
      cursor: readStateRgb(host, state, scratch, 'COLOR_CURSOR') ?? [221, 221, 221]
    }
  }
  const background = rgbAt(
    host,
    scratch.colors + host.field('GhosttyRenderStateColors', 'background').offset
  )
  const foreground = rgbAt(
    host,
    scratch.colors + host.field('GhosttyRenderStateColors', 'foreground').offset
  )
  const cursorHas =
    host.bytes()[
      scratch.colors + host.field('GhosttyRenderStateColors', 'cursor_has_value').offset
    ] !== 0
  const cursor = cursorHas
    ? rgbAt(host, scratch.colors + host.field('GhosttyRenderStateColors', 'cursor').offset)
    : foreground
  return { background, foreground, cursor }
}

export function readRenderStateU16(
  host: GhosttyVtHost,
  state: number,
  scratch: GhosttyRendererScratch,
  name: string
): number {
  host.check(
    host.exports.ghostty_render_state_get(
      state,
      host.enumValue('GhosttyRenderStateData', name),
      scratch.y
    ),
    `render ${name}`
  )
  return host.view().getUint16(scratch.y, true)
}

function readStateRgb(
  host: GhosttyVtHost,
  state: number,
  scratch: GhosttyRendererScratch,
  name: 'COLOR_BACKGROUND' | 'COLOR_FOREGROUND' | 'COLOR_CURSOR'
): ThemeRgb | null {
  const result = host.exports.ghostty_render_state_get(
    state,
    host.enumValue('GhosttyRenderStateData', name),
    scratch.bg
  )
  if (result !== host.success) {
    return null
  }
  return rgbAt(host, scratch.bg)
}

export function rgbAt(host: GhosttyVtHost, ptr: number): ThemeRgb {
  const bytes = host.bytes()
  return [bytes[ptr] ?? 0, bytes[ptr + 1] ?? 0, bytes[ptr + 2] ?? 0]
}
