import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type { SubprocessHandle } from '../daemon/session-subprocess-handle'

export const HORCA_GHOSTTY_ENGINE_PLACEMENT = 'main' as const

type PtyWriteBuf = Buffer | Uint8Array | string

type GhosttyPassthruTerminal = {
  attach(webContents: WebContents, opts?: { slot?: string }): void
  ptyData(data: Buffer): void
  destroy(): void
  on(event: 'pty-write', listener: (buf: PtyWriteBuf) => void): void
  on(event: 'pty-resize', listener: (size: { cols: number; rows: number }) => void): void
}

export type HorcaGhosttyPassthruEngine = {
  placement: typeof HORCA_GHOSTTY_ENGINE_PLACEMENT
  attach(webContents: WebContents, slot?: string): void
  destroy(): void
}

type GhosttyTerminalCtor = new (opts: {
  engine: 'main'
  passthru: true
  scale?: number
  fontSize?: number
}) => GhosttyPassthruTerminal

export function resolveElectronGhosttyRoot(): string {
  const packaged = join(process.resourcesPath ?? '', 'horca-ghostty')
  if (existsSync(join(packaged, 'index.js'))) {
    return packaged
  }
  return join(__dirname, '../../../native/horca-ghostty/adopted/electron-ghostty')
}

function loadGhosttyTerminal(): GhosttyTerminalCtor {
  const requireFromHere = createRequire(__filename)
  const mod = requireFromHere(resolveElectronGhosttyRoot()) as {
    GhosttyTerminal: GhosttyTerminalCtor
  }
  return mod.GhosttyTerminal
}

function asBuffer(data: PtyWriteBuf): Buffer {
  if (Buffer.isBuffer(data)) {
    return data
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'latin1')
  }
  return Buffer.from(data)
}

export function createHorcaGhosttyPassthruEngine(
  handle: SubprocessHandle,
  GhosttyTerminal = loadGhosttyTerminal()
): HorcaGhosttyPassthruEngine {
  const term = new GhosttyTerminal({
    engine: HORCA_GHOSTTY_ENGINE_PLACEMENT,
    passthru: true
  })
  handle.onData((data) => {
    term.ptyData(Buffer.from(data, 'latin1'))
  })
  term.on('pty-write', (buf) => {
    handle.write(asBuffer(buf))
  })
  term.on('pty-resize', ({ cols, rows }) => {
    handle.resize(cols, rows)
  })
  return {
    placement: HORCA_GHOSTTY_ENGINE_PLACEMENT,
    attach: (webContents, slot) => term.attach(webContents, { slot: slot ?? '' }),
    destroy: () => term.destroy()
  }
}
