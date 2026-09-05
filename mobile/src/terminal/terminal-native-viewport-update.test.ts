import { describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import type { RpcResponse } from '../transport/types'
import {
  isUsableTerminalViewport,
  TerminalNativeViewportUpdate
} from './terminal-native-viewport-update'

function makeClient(responses: RpcResponse[]): RpcClient {
  return {
    sendRequest: vi.fn(async () => responses.shift()!),
    subscribe: vi.fn(),
    updateTerminalSubscriptionViewport: vi.fn(),
    getState: vi.fn(() => 'connected'),
    getReconnectAttempt: vi.fn(() => 0),
    getLastConnectedAt: vi.fn(() => null),
    onStateChange: vi.fn(() => () => {}),
    notifyForeground: vi.fn(),
    close: vi.fn()
  }
}

const viewport = { cols: 72, rows: 36 }

describe('isUsableTerminalViewport', () => {
  it('rejects a half-laid-out grid so the PTY keeps the last good size', () => {
    expect(isUsableTerminalViewport({ cols: 19, rows: 24 })).toBe(false)
    expect(isUsableTerminalViewport({ cols: 40, rows: 7 })).toBe(false)
    expect(isUsableTerminalViewport({ cols: 20, rows: 8 })).toBe(true)
  })
})

describe('TerminalNativeViewportUpdate', () => {
  it('updates the existing mobile subscriber in place', async () => {
    const client = makeClient([
      { id: '1', ok: true, result: { updated: true }, _meta: { runtimeId: 'runtime' } }
    ])
    const update = new TerminalNativeViewportUpdate()

    await expect(update.request(client, 'term-1', 'phone-1', viewport)).resolves.toBe(true)
    expect(client.sendRequest).toHaveBeenCalledWith('terminal.updateViewport', {
      terminal: 'term-1',
      client: { id: 'phone-1', type: 'mobile' },
      viewport
    })
  })

  it('probes an older host only once before using the resubscribe fallback', async () => {
    const unsupported = {
      id: '1',
      ok: false,
      error: { code: 'method_not_found', message: 'Unknown method: terminal.updateViewport' },
      _meta: { runtimeId: 'runtime' }
    } satisfies RpcResponse
    const client = makeClient([unsupported])
    const update = new TerminalNativeViewportUpdate()

    await expect(update.request(client, 'term-1', 'phone-1', viewport)).resolves.toBe(false)
    await expect(update.request(client, 'term-1', 'phone-1', viewport)).resolves.toBe(false)
    expect(client.sendRequest).toHaveBeenCalledTimes(1)
  })

  it('retries after a transient failure', async () => {
    const transient = {
      id: '1',
      ok: false,
      error: { code: 'temporary_failure', message: 'retryable' },
      _meta: { runtimeId: 'runtime' }
    } satisfies RpcResponse
    const updated = {
      id: '2',
      ok: true,
      result: { updated: true },
      _meta: { runtimeId: 'runtime' }
    } satisfies RpcResponse
    const client = makeClient([transient, updated])
    const update = new TerminalNativeViewportUpdate()

    await expect(update.request(client, 'term-1', 'phone-1', viewport)).resolves.toBe(false)
    await expect(update.request(client, 'term-1', 'phone-1', viewport)).resolves.toBe(true)
    expect(client.sendRequest).toHaveBeenCalledTimes(2)
  })
})
