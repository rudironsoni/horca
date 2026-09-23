import { describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { SubprocessHandle } from '../daemon/session-subprocess-handle'
import {
  createHorcaGhosttyPassthruEngine,
  HORCA_GHOSTTY_ENGINE_PLACEMENT,
  resolveElectronGhosttyRoot
} from './ghostty-passthru-engine'

const instances: FakeGhostty[] = []

class FakeGhostty extends EventEmitter {
  static lastOpts: { engine: string; passthru: boolean; config?: string } | undefined
  attach = vi.fn()
  ptyData = vi.fn()
  destroy = vi.fn()
  constructor(opts: { engine: string; passthru: boolean; config?: string }) {
    super()
    FakeGhostty.lastOpts = opts
    instances.push(this)
  }
}

function fakeHandle() {
  let onData: ((d: string) => void) | null = null
  const handle = {
    pid: 1,
    getForegroundProcess: () => 'zsh',
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    forceKill: vi.fn(),
    terminateOwnedTree: () => ({ kind: 'unavailable' as const }),
    signal: vi.fn(),
    onData: (cb: (d: string) => void) => {
      onData = cb
    },
    onExit: vi.fn(),
    dispose: vi.fn(),
    emitData: (d: string | Buffer) => onData?.(d as string)
  }
  return handle as typeof handle & SubprocessHandle
}

describe('resolveElectronGhosttyRoot', () => {
  it('resolves the transplanted electron-ghostty package in development', () => {
    expect(resolveElectronGhosttyRoot()).toContain('native/horca-ghostty/adopted/electron-ghostty')
  })
})

describe('createHorcaGhosttyPassthruEngine', () => {
  it('places Ghostty on MAIN passthru and writes pty_write_cb as Buffer', () => {
    instances.length = 0
    const handle = fakeHandle()
    const engine = createHorcaGhosttyPassthruEngine(
      handle,
      FakeGhostty as unknown as Parameters<typeof createHorcaGhosttyPassthruEngine>[1]
    )
    expect(engine.placement).toBe(HORCA_GHOSTTY_ENGINE_PLACEMENT)
    expect(FakeGhostty.lastOpts).toEqual({
      engine: 'main',
      passthru: true,
      config: 'window-vsync = false\nmacos-option-as-alt = true\n'
    })
    const term = instances[0]
    expect(term).toBeDefined()
    handle.emitData('abc')
    expect(term.ptyData).toHaveBeenCalledWith(Buffer.from('abc', 'utf8'))
    handle.emitData('é')
    const eAcute = term.ptyData.mock.calls.at(-1)?.[0] as Buffer
    expect(eAcute.equals(Buffer.from([0xc3, 0xa9]))).toBe(true)
    expect(eAcute.equals(Buffer.from([0xe9]))).toBe(false)
    handle.emitData('😀')
    const emoji = term.ptyData.mock.calls.at(-1)?.[0] as Buffer
    expect(emoji.equals(Buffer.from([0xf0, 0x9f, 0x98, 0x80]))).toBe(true)
    handle.emitData(Buffer.from([0xc3, 0xa9]))
    expect((term.ptyData.mock.calls.at(-1)?.[0] as Buffer).equals(Buffer.from([0xc3, 0xa9]))).toBe(true)
    const ghosttyBytes = Buffer.from([0xc3, 0xa9])
    term.emit('pty-write', ghosttyBytes)
    expect(handle.write).toHaveBeenCalledWith(ghosttyBytes)
    expect(Buffer.isBuffer(handle.write.mock.calls[0][0])).toBe(true)
    term.emit('pty-resize', { cols: 100, rows: 30 })
    expect(handle.resize).toHaveBeenCalledWith(100, 30)
    engine.clearScreen()
    expect(term.ptyData).toHaveBeenCalledWith(Buffer.from('\x1b[H\x1b[2J\x1b[3J', 'utf8'))
  })
})

function findUp(rel: string): string {
  let dir = __dirname
  for (let i = 0; i < 12; i += 1) {
    const candidate = join(dir, rel)
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`${rel} not found from ${__dirname}`)
}

function findPreload(): string {
  return findUp('native/horca-ghostty/adopted/electron-ghostty/preload.js')
}

describe('ghostty key protocol', () => {
  it('encodes legacy keys and kitty CSI-u through the native surface', () => {
    const electron = findUp('node_modules/.bin/electron')
    const script = findUp('native/horca-ghostty/harness/electron-43/key-protocol.js')
    const result = spawnSync(electron, [script], { encoding: 'utf8', timeout: 30000 })
    const line = result.stdout.split('\n').filter((row) => row.startsWith('{')).at(-1)
    const report = JSON.parse(line ?? '{}') as { ok?: boolean; bad?: string[]; out?: Record<string, string> }
    expect(result.status).toBe(0)
    expect(report.ok).toBe(true)
    expect(report.out?.enter).toBe('0d')
    expect(report.out?.up).toBe('1b5b41')
    expect(report.out?.ctrlc).toBe('03')
    expect(report.out?.altqPlain).toBe('1b71')
    expect(report.out?.altqPlain).not.toBe('71')
    expect(report.out?.altq).toBe('1b5b3131333b3375')
    expect(report.out?.altqRelease).toBe('1b5b3131333b333a3375')
    expect(report.out?.ctrlAltQ).toBe('1b5b3131333b3775')
  }, 30000)
})

describe('ghostty selection', () => {
  it('returns the full mouse selection from the native surface', () => {
    const electron = findUp('node_modules/.bin/electron')
    const script = findUp('native/horca-ghostty/harness/electron-43/selection.js')
    const result = spawnSync(electron, [script], { encoding: 'utf8', timeout: 30000 })
    const line = result.stdout.split('\n').filter((row) => row.startsWith('{')).at(-1)
    const report = JSON.parse(line ?? '{}') as { text?: string }
    expect(result.status).toBe(0)
    expect(report.text).toBe('HELLO selection')
  }, 30000)
})

describe('ghostty preload late canvas', () => {
  it('sends key, paste, composition, and mouse IPC after the canvas appears', () => {
    const sent: Array<[string, { slot?: string; event?: { action?: number; text?: string }; text?: string }]> = []
    class El {
      tag: string
      attrs: Record<string, string> = {}
      children: El[] = []
      listeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {}
      constructor(tag: string) {
        this.tag = tag
      }
      setAttribute(name: string, value: string) {
        this.attrs[name] = value
      }
      getAttribute(name: string) {
        return this.attrs[name] ?? null
      }
      hasAttribute(name: string) {
        return Object.prototype.hasOwnProperty.call(this.attrs, name)
      }
      matches(sel: string) {
        return sel === 'canvas[data-ghostty]' && this.tag === 'canvas' && this.hasAttribute('data-ghostty')
      }
      querySelectorAll(sel: string): El[] {
        const out: El[] = []
        for (const child of this.children) {
          if (child.matches(sel)) out.push(child)
          out.push(...child.querySelectorAll(sel))
        }
        return out
      }
      addEventListener(type: string, fn: (event: Record<string, unknown>) => void) {
        ;(this.listeners[type] ??= []).push(fn)
      }
      focus() {
        active = this
      }
      getBoundingClientRect() {
        return { width: 80, height: 40, left: 0, top: 0 }
      }
      getContext() {
        return { drawImage() {} }
      }
    }
    let active: El | null = null
    const observers: Array<{ cb: (records: Array<{ addedNodes: El[] }>) => void }> = []
    class MutationObserverStub {
      cb: (records: Array<{ addedNodes: El[] }>) => void
      constructor(cb: (records: Array<{ addedNodes: El[] }>) => void) {
        this.cb = cb
      }
      observe() {
        observers.push(this)
      }
      disconnect() {}
    }
    const root = new El('html')
    const body = new El('body')
    root.children.push(body)
    const windowListeners: Record<string, Array<(event: Record<string, unknown>) => void>> = {}
    const windowObj = {
      document: {
        documentElement: root,
        querySelectorAll: (sel: string) => root.querySelectorAll(sel),
        querySelector: (sel: string) => root.querySelectorAll(sel)[0] ?? null,
        get activeElement() {
          return active
        }
      },
      addEventListener(type: string, fn: (event: Record<string, unknown>) => void) {
        ;(windowListeners[type] ??= []).push(fn)
      },
      dispatch(type: string, event: Record<string, unknown>) {
        for (const fn of windowListeners[type] ?? []) fn(event)
      }
    }
    const g = globalThis as Record<string, unknown>
    const prev = {
      window: g.window,
      document: g.document,
      MutationObserver: g.MutationObserver,
      ResizeObserver: g.ResizeObserver,
      requestAnimationFrame: g.requestAnimationFrame,
      Element: g.Element
    }
    g.window = windowObj
    g.document = windowObj.document
    g.MutationObserver = MutationObserverStub
    g.Element = El
    g.ResizeObserver = class {
      observe() {}
      disconnect() {}
    }
    g.requestAnimationFrame = (cb: (t: number) => void) => {
      cb(0)
      return 1
    }
    const electron = {
      sharedTexture: { setSharedTextureReceiver() {} },
      ipcRenderer: {
        send(channel: string, payload: { slot?: string }) {
          sent.push([channel, payload])
        }
      }
    }
    const req = createRequire(__filename)
    const nodeModule = req('module') as { prototype: { require: (id: string) => unknown } }
    const orig = nodeModule.prototype.require
    nodeModule.prototype.require = function (id: string) {
      if (id === 'electron') return electron
      return orig.apply(this, [id])
    }
    const preload = findPreload()
    try {
      delete req.cache[preload]
      req(preload)
      windowObj.dispatch('DOMContentLoaded', {})
      windowObj.dispatch('keydown', {
        code: 'KeyA',
        key: 'a',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        preventDefault() {}
      })
      expect(sent.some(([channel]) => channel === 'electron-ghostty:key')).toBe(false)
      const canvas = new El('canvas')
      canvas.setAttribute('data-ghostty', 'pane-1')
      body.children.push(canvas)
      for (const obs of observers) obs.cb([{ addedNodes: [canvas] }])
      windowObj.dispatch('keydown', {
        code: 'KeyA',
        key: 'a',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        keyCode: 0,
        preventDefault() {}
      })
      const key = sent.find(([channel]) => channel === 'electron-ghostty:key')
      expect(key?.[1]).toMatchObject({
        slot: 'pane-1',
        event: { action: 1, keycode: 0, text: 'a' }
      })
      windowObj.dispatch('paste', { clipboardData: { getData: () => 'é' } })
      expect(sent.some(([channel, payload]) => channel === 'electron-ghostty:text' && payload.text === 'é')).toBe(true)
      windowObj.dispatch('compositionend', { data: '你' })
      expect(sent.some(([channel, payload]) => channel === 'electron-ghostty:text' && payload.text === '你')).toBe(true)
      windowObj.dispatch('keyup', {
        code: 'KeyA',
        key: 'a',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
        isComposing: false,
        keyCode: 0
      })
      const keyUp = sent.filter(([channel, payload]) => channel === 'electron-ghostty:key' && payload.event?.action === 0)
      expect(keyUp.at(-1)?.[1]).toMatchObject({
        slot: 'pane-1',
        event: { action: 0, keycode: 0, unshiftedCodepoint: 97 }
      })
      canvas.listeners.mousedown?.[0]?.({
        button: 0,
        clientX: 4,
        clientY: 5,
        shiftKey: false,
        ctrlKey: false,
        altKey: false,
        metaKey: false
      })
      expect(sent.some(([channel, payload]) => channel === 'electron-ghostty:mouse-button' && payload.slot === 'pane-1')).toBe(true)
      canvas.listeners.wheel?.[0]?.({
        deltaX: 0,
        deltaY: 12,
        clientX: 4,
        clientY: 5,
        preventDefault() {}
      })
      expect(sent.some(([channel, payload]) => channel === 'electron-ghostty:mouse-scroll' && payload.slot === 'pane-1')).toBe(true)
    } finally {
      nodeModule.prototype.require = orig
      delete req.cache[preload]
      Object.assign(g, prev)
    }
  })
})
