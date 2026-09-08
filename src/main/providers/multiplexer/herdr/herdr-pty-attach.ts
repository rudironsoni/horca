import { Buffer } from 'node:buffer'
import type { HerdrHostTransport, HerdrTerminalController } from './herdr-runtime-contract'
import type { HerdrPtyBinding } from './herdr-pty-types'

type HerdrPaneSizePulse = {
  exclusive: HerdrTerminalController
  done: Promise<void>
  abort: () => void
}

const sizePulses = new WeakMap<HerdrPtyBinding, HerdrPaneSizePulse>()
const exclusiveAborts = new Set<() => void>()

export function abortHerdrExclusiveAttaches(): void {
  for (const abort of exclusiveAborts) {
    abort()
  }
}

export function openSharedHerdrPaneController(
  transport: HerdrHostTransport,
  sessionName: string,
  paneId: string,
  size: { cols: number; rows: number }
): HerdrTerminalController {
  if (!transport.controlTerminal) {
    throw new Error('Herdr host transport does not support terminal control')
  }
  // Why observe: pane.split needs the parent free. Exclusive is a short drain
  // pulse for unread PTY bytes, not the standing attach.
  return transport.controlTerminal(sessionName, paneId, { ...size, observe: true })
}

export async function writeSharedHerdrInput(binding: HerdrPtyBinding, data: string): Promise<void> {
  await settleHerdrPaneSizePulse(binding)
  await binding.transport.sdk.run(binding.sessionName, (herdr) =>
    herdr.panes.sendText(herdr.ids.pane(binding.paneId), data)
  )
}

async function settleHerdrPaneSizePulse(binding: HerdrPtyBinding): Promise<void> {
  for (;;) {
    const pulse = sizePulses.get(binding)
    if (!pulse) {
      return
    }
    await pulse.done
  }
}

export function cancelHerdrPaneSizePulse(binding: HerdrPtyBinding): void {
  sizePulses.get(binding)?.abort()
}

export function applyHerdrPaneSize(binding: HerdrPtyBinding): void {
  if (binding.detached || binding.cols < 1 || binding.rows < 1) {
    return
  }
  if (!binding.transport.controlTerminal) {
    return
  }
  if (sizePulses.has(binding)) {
    return
  }
  const cols = binding.cols
  const rows = binding.rows
  const exclusive = binding.transport.controlTerminal(binding.sessionName, binding.paneId, {
    cols,
    rows
  })
  let settle!: () => void
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  let offFrame = (): void => {}
  let offClosed = (): void => {}
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finish = (reapply: boolean): void => {
    if (sizePulses.get(binding) !== pulse) {
      return
    }
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
    offFrame()
    offClosed()
    sizePulses.delete(binding)
    exclusiveAborts.delete(pulse.abort)
    exclusive.release()
    settle()
    if (reapply && !binding.detached && (binding.cols !== cols || binding.rows !== rows)) {
      applyHerdrPaneSize(binding)
    }
  }
  const pulse: HerdrPaneSizePulse = {
    exclusive,
    done,
    abort: () => finish(false)
  }
  sizePulses.set(binding, pulse)
  exclusiveAborts.add(pulse.abort)
  timeout = setTimeout(() => finish(true), 2_000)
  offFrame = exclusive.onFrame(() => {
    exclusive.resize(cols, rows)
    finish(true)
  })
  offClosed = exclusive.onClosed(() => {
    finish(true)
  })
}

export async function readExclusiveHerdrPaneBytes(
  binding: HerdrPtyBinding,
  maxChars: number
): Promise<string> {
  if (!binding.transport.controlTerminal || binding.detached || maxChars < 1) {
    return ''
  }
  await settleHerdrPaneSizePulse(binding)
  const exclusive = binding.transport.controlTerminal(binding.sessionName, binding.paneId, {
    cols: Math.max(1, binding.cols),
    rows: Math.max(1, binding.rows)
  })
  let bytes = ''
  let settle!: () => void
  const done = new Promise<void>((resolve) => {
    settle = resolve
  })
  const finish = (): void => {
    exclusiveAborts.delete(finish)
    offFrame()
    offClosed()
    exclusive.release()
    settle()
  }
  exclusiveAborts.add(finish)
  const offFrame = exclusive.onFrame((frame) => {
    const chunk = Buffer.from(frame.bytes, 'base64').toString('utf8')
    if (!chunk) {
      return
    }
    bytes += chunk
    if (bytes.length >= maxChars) {
      finish()
    }
  })
  const offClosed = exclusive.onClosed(() => {
    finish()
  })
  setTimeout(finish, 200)
  await done
  return bytes.slice(0, maxChars)
}
