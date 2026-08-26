import type {
  IPtyProvider,
  PtyProcessInfo,
  PtyProviderBufferSnapshot,
  PtyBackgroundStreamEvent
} from '../../types'
import { applyHerdrPaneSize, writeSharedHerdrInput } from './herdr-pty-attach'
import type {
  HerdrPtyBinding,
  HerdrPaneMoveDestination,
  HerdrPaneSwapOptions
} from './herdr-pty-types'
import {
  clearHerdrBindingBuffer,
  getHerdrBindingBufferSnapshot,
  getHerdrBindingCwd,
  getHerdrBindingForegroundProcess,
  herdrBindingHasChildProcesses,
  herdrBindingProcessSnapshot,
  maybeNotifyBlocked,
  moveHerdrBinding,
  resizeHerdrBinding,
  swapHerdrBinding,
  zoomHerdrBinding
} from './herdr-pty-binding-queries'
import type { TerminalLogicalInput } from '../../../../shared/terminal-logical-key'
import {
  bytesFromTerminalLogicalKey,
  terminalLogicalInputFromBytes
} from '../../../../shared/terminal-logical-key'
import { isOrcaFallbackId } from './herdr-pty-orca-fallback'
import { sendHerdrNamedKey } from './herdr-pty-provider-runtime'

export class HerdrPtyProviderIo {
  protected readonly bindings = new Map<string, HerdrPtyBinding>()
  protected fallback?: IPtyProvider
  protected readonly writeQueues = new Map<string, Promise<void>>()
  protected readonly writeUnavailableListeners = new Set<(payload: { id: string }) => void>()
  protected readonly backgroundStreamListeners = new Set<
    (payload: PtyBackgroundStreamEvent) => void
  >()

  write(id: string, data: string): void {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      this.fallback.write(id, data)
      return
    }
    this.writeLogical(id, terminalLogicalInputFromBytes(data))
  }

  writeLogical(id: string, input: TerminalLogicalInput): boolean {
    const binding = this.bindings.get(id)
    if (!binding) {
      const result = this.fallback?.writeLogical?.(id, input)
      return this.fallback?.writeLogical != null && result !== false
    }
    if (input.kind === 'bytes') {
      void this.sendInput(id, () => writeSharedHerdrInput(binding, input.data))
      return true
    }
    const bytes =
      input.name === 'ctrl+c' || input.name === 'ctrl+\\'
        ? null
        : bytesFromTerminalLogicalKey(input.name)
    if (bytes !== null) {
      void this.sendInput(id, () => writeSharedHerdrInput(binding, bytes))
      return true
    }
    void this.sendInput(id, () => sendHerdrNamedKey(binding, input.name))
    return true
  }

  resize(id: string, cols: number, rows: number): void {
    const binding = this.bindings.get(id)
    if (!binding) {
      this.fallback?.resize(id, cols, rows)
      return
    }
    binding.cols = cols
    binding.rows = rows
    binding.controller.resize(cols, rows)
    applyHerdrPaneSize(binding)
  }

  pauseProducer(_id: string): void {}

  resumeProducer(_id: string): void {}

  setPtyBackgrounded(_id: string, _background: boolean): void {}

  onBackgroundStreamEvent(callback: (payload: PtyBackgroundStreamEvent) => void): () => void {
    this.backgroundStreamListeners.add(callback)
    return () => this.backgroundStreamListeners.delete(callback)
  }

  onWriteUnavailable(callback: (payload: { id: string }) => void): () => void {
    this.writeUnavailableListeners.add(callback)
    return () => this.writeUnavailableListeners.delete(callback)
  }

  async getAppliedSize(id: string): Promise<{ cols: number; rows: number } | null> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return { cols: binding.cols, rows: binding.rows }
  }

  async getCwd(id: string): Promise<string> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return ''
    }
    try {
      return await getHerdrBindingCwd(binding)
    } catch {
      return binding.cwd
    }
  }

  async getInitialCwd(id: string): Promise<string> {
    return this.getCwd(id)
  }

  async clearBuffer(id: string): Promise<void> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return
    }
    await clearHerdrBindingBuffer(binding)
  }

  acknowledgeDataEvent(_id: string, _charCount: number): void {}

  async hasChildProcesses(id: string): Promise<boolean> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return false
    }
    return herdrBindingHasChildProcesses(binding)
  }

  async getForegroundProcess(id: string): Promise<string | null> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return getHerdrBindingForegroundProcess(binding)
  }

  async listProcesses(opts?: { deadlineMs?: number }): Promise<PtyProcessInfo[]> {
    const herdr = [...this.bindings.values()].map(herdrBindingProcessSnapshot)
    const fallback = this.fallback ? await this.fallback.listProcesses(opts) : []
    return [...herdr, ...fallback]
  }

  async getBufferSnapshot(
    id: string,
    opts?: { scrollbackRows?: number }
  ): Promise<PtyProviderBufferSnapshot | null> {
    const binding = this.bindings.get(id)
    if (!binding) {
      return null
    }
    return getHerdrBindingBufferSnapshot(binding, opts?.scrollbackRows)
  }

  async zoomPane(id: string, mode: 'toggle' | 'on' | 'off' = 'toggle') {
    const binding = this.bindings.get(id)
    return binding ? zoomHerdrBinding(binding, mode) : null
  }

  async swapPane(id: string, params: HerdrPaneSwapOptions) {
    const binding = this.bindings.get(id)
    return binding ? swapHerdrBinding(binding, params) : null
  }

  async movePane(id: string, destination: HerdrPaneMoveDestination, focus?: boolean) {
    const binding = this.bindings.get(id)
    return binding ? moveHerdrBinding(binding, { destination, focus }) : null
  }

  async resizePane(id: string, direction: 'left' | 'right' | 'up' | 'down', amount?: number) {
    const binding = this.bindings.get(id)
    return binding ? resizeHerdrBinding(binding, direction, amount) : null
  }

  async notifyBlocked(
    id: string,
    agent: string,
    state: 'idle' | 'working' | 'blocked' | 'done' | 'unknown'
  ): Promise<void> {
    const binding = this.bindings.get(id)
    if (binding) {
      await maybeNotifyBlocked(binding, agent, state)
    }
  }

  canProvideAuthoritativeBufferSnapshot(id: string): boolean {
    return this.bindings.has(id)
  }

  async getDefaultShell(): Promise<string> {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  async getProfiles(): Promise<{ name: string; path: string }[]> {
    return []
  }

  serialize(_ids: string[]): Promise<string> {
    return Promise.resolve('')
  }

  revive(_state: string): Promise<void> {
    return Promise.resolve()
  }

  async sendSignal(id: string, signal: string): Promise<void> {
    if (isOrcaFallbackId(this.bindings, id, this.fallback)) {
      await this.fallback.sendSignal(id, signal)
      return
    }
    const binding = this.bindings.get(id)
    if (!binding) {
      throw new Error(`Herdr PTY not found: ${id}`)
    }
    const key = signal === 'SIGINT' ? 'ctrl+c' : signal === 'SIGQUIT' ? 'ctrl+\\' : null
    if (!key) {
      throw new Error(`Herdr does not support signal ${signal}`)
    }
    await this.sendInput(id, () => sendHerdrNamedKey(binding, key))
  }

  protected sendInput(id: string, write: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(id) ?? Promise.resolve()
    const pending = previous.catch(() => undefined).then(write)
    this.writeQueues.set(id, pending)
    void pending
      .catch((error: unknown) => {
        console.warn(`[herdr] Failed to write to ${id}:`, error)
        if (!isHerdrWriteEndpointGone(error)) {
          return
        }
        for (const listener of this.writeUnavailableListeners) {
          listener({ id })
        }
      })
      .finally(() => {
        if (this.writeQueues.get(id) === pending) {
          this.writeQueues.delete(id)
        }
      })
    return pending
  }
}

function isHerdrWriteEndpointGone(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /closed before response|not initialized|EPIPE|ECONNRESET|ECONNREFUSED|transport gone/i.test(
    message
  )
}
