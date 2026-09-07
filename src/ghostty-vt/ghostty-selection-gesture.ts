import type { GhosttyTerminal } from './ghostty-terminal'
import type { GhosttyVtHost } from './wasm-host'

const gestures = new WeakMap<GhosttyTerminal, number>()

export type GestureSurface = {
  left: number
  top: number
  cellWidth: number
  cellHeight: number
  cols: number
  rows: number
}

export function resetSelectionGesture(engine: GhosttyTerminal): void {
  const gesture = gestures.get(engine)
  if (gesture === undefined) {
    return
  }
  const { host, term } = engine.hostHandle()
  host.exports.ghostty_selection_gesture_reset(gesture, term)
}

export function disposeSelectionGesture(engine: GhosttyTerminal): void {
  const gesture = gestures.get(engine)
  if (gesture === undefined) {
    return
  }
  const { host, term } = engine.hostHandle()
  host.exports.ghostty_selection_gesture_free(gesture, term)
  gestures.delete(engine)
}

export function applyPointerSelection(
  engine: GhosttyTerminal,
  event: {
    type: string
    button: number
    buttons: number
    clientX: number
    clientY: number
    timeStamp: number
  },
  surface: GestureSurface
): boolean {
  const { host, term } = engine.hostHandle()
  const kind = eventType(event)
  if (!kind) {
    return false
  }
  const gesture = gestureHandle(host, engine)
  const col = clamp(
    Math.floor((event.clientX - surface.left) / surface.cellWidth),
    0,
    surface.cols - 1
  )
  const row = clamp(
    Math.floor((event.clientY - surface.top) / surface.cellHeight),
    0,
    surface.rows - 1
  )
  const eventSlot = host.allocOpaque()
  host.check(
    host.exports.ghostty_selection_gesture_event_new(
      0,
      eventSlot,
      host.enumValue('GhosttySelectionGestureEventType', kind)
    ),
    'gesture_event_new'
  )
  const ev = host.takeOpaque(eventSlot)
  host.freeOpaque(eventSlot)
  const ref = writeGridRef(host, term, col, row)
  host.check(
    host.exports.ghostty_selection_gesture_event_set(
      ev,
      host.enumValue('GhosttySelectionGestureEventOption', 'REF'),
      ref
    ),
    'gesture REF'
  )
  host.free(ref, host.structSize('GhosttyGridRef'))
  if (kind !== 'RELEASE') {
    setPosition(host, ev, event.clientX - surface.left, event.clientY - surface.top)
  }
  if (kind === 'PRESS') {
    setTimeNs(host, ev, event.timeStamp)
    setU64(host, ev, 'REPEAT_INTERVAL_NS', 500_000_000)
    setF64(host, ev, 'REPEAT_DISTANCE', 32)
  }
  if (kind === 'DRAG') {
    setGeometry(host, ev, surface)
  }
  const selSize = host.structSize('GhosttySelection')
  const sel = host.alloc(selSize)
  host.bytes().fill(0, sel, sel + selSize)
  host.writeU32(sel, selSize)
  const result = host.exports.ghostty_selection_gesture_event(gesture, term, ev, sel)
  host.exports.ghostty_selection_gesture_event_free(ev)
  const noValue = host.enumValue('GhosttyResult', 'NO_VALUE')
  if (result === noValue) {
    host.free(sel, selSize)
    return false
  }
  host.check(result, 'gesture_event')
  host.check(
    host.exports.ghostty_terminal_set(
      term,
      host.enumValue('GhosttyTerminalOption', 'SELECTION'),
      sel
    ),
    'set SELECTION'
  )
  host.free(sel, selSize)
  return true
}

function eventType(event: {
  type: string
  button: number
  buttons: number
}): 'PRESS' | 'RELEASE' | 'DRAG' | null {
  if (event.type === 'pointerdown' && event.button === 0) {
    return 'PRESS'
  }
  if (event.type === 'pointerup' && event.button === 0) {
    return 'RELEASE'
  }
  if (event.type === 'pointermove' && (event.buttons & 1) !== 0) {
    return 'DRAG'
  }
  return null
}

function gestureHandle(host: GhosttyVtHost, engine: GhosttyTerminal): number {
  const existing = gestures.get(engine)
  if (existing !== undefined) {
    return existing
  }
  const slot = host.allocOpaque()
  host.check(host.exports.ghostty_selection_gesture_new(0, slot), 'gesture_new')
  const gesture = host.takeOpaque(slot)
  host.freeOpaque(slot)
  gestures.set(engine, gesture)
  return gesture
}

function writeGridRef(host: GhosttyVtHost, term: number, x: number, y: number): number {
  const pointSize = host.structSize('GhosttyPoint')
  const refSize = host.structSize('GhosttyGridRef')
  const point = host.alloc(pointSize)
  const ref = host.alloc(refSize)
  host.bytes().fill(0, point, point + pointSize)
  host.view().setInt32(point, host.enumValue('GhosttyPointTag', 'ACTIVE'), true)
  host.view().setUint16(point + host.field('GhosttyPoint', 'value').offset, x, true)
  host.view().setUint32(point + host.field('GhosttyPoint', 'value').offset + 4, y, true)
  host.bytes().fill(0, ref, ref + refSize)
  host.writeU32(ref, refSize)
  host.check(host.exports.ghostty_terminal_grid_ref(term, point, ref), 'grid_ref')
  host.free(point, pointSize)
  return ref
}

function setPosition(host: GhosttyVtHost, ev: number, x: number, y: number): void {
  const size = host.structSize('GhosttySurfacePosition')
  const ptr = host.alloc(size)
  host.view().setFloat64(ptr + host.field('GhosttySurfacePosition', 'x').offset, x, true)
  host.view().setFloat64(ptr + host.field('GhosttySurfacePosition', 'y').offset, y, true)
  host.check(
    host.exports.ghostty_selection_gesture_event_set(
      ev,
      host.enumValue('GhosttySelectionGestureEventOption', 'POSITION'),
      ptr
    ),
    'gesture POSITION'
  )
  host.free(ptr, size)
}

function setTimeNs(host: GhosttyVtHost, ev: number, timeStamp: number): void {
  setU64(host, ev, 'TIME_NS', Math.max(0, Math.floor(timeStamp * 1_000_000)))
}

function setU64(host: GhosttyVtHost, ev: number, option: string, value: number): void {
  const ptr = host.alloc(8)
  host.view().setBigUint64(ptr, BigInt(value), true)
  host.check(
    host.exports.ghostty_selection_gesture_event_set(
      ev,
      host.enumValue('GhosttySelectionGestureEventOption', option),
      ptr
    ),
    `gesture ${option}`
  )
  host.free(ptr, 8)
}

function setF64(host: GhosttyVtHost, ev: number, option: string, value: number): void {
  const ptr = host.alloc(8)
  host.view().setFloat64(ptr, value, true)
  host.check(
    host.exports.ghostty_selection_gesture_event_set(
      ev,
      host.enumValue('GhosttySelectionGestureEventOption', option),
      ptr
    ),
    `gesture ${option}`
  )
  host.free(ptr, 8)
}

function setGeometry(host: GhosttyVtHost, ev: number, surface: GestureSurface): void {
  const size = host.structSize('GhosttySelectionGestureGeometry')
  const ptr = host.alloc(size)
  host.bytes().fill(0, ptr, ptr + size)
  const view = host.view()
  view.setUint32(
    ptr + host.field('GhosttySelectionGestureGeometry', 'columns').offset,
    surface.cols,
    true
  )
  view.setUint32(
    ptr + host.field('GhosttySelectionGestureGeometry', 'cell_width').offset,
    surface.cellWidth,
    true
  )
  view.setUint32(
    ptr + host.field('GhosttySelectionGestureGeometry', 'padding_left').offset,
    0,
    true
  )
  view.setUint32(
    ptr + host.field('GhosttySelectionGestureGeometry', 'screen_height').offset,
    surface.rows * surface.cellHeight,
    true
  )
  host.check(
    host.exports.ghostty_selection_gesture_event_set(
      ev,
      host.enumValue('GhosttySelectionGestureEventOption', 'GEOMETRY'),
      ptr
    ),
    'gesture GEOMETRY'
  )
  host.free(ptr, size)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
