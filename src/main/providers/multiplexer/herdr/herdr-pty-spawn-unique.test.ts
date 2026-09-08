import { describe, expect, it, vi } from 'vitest'
import { Buffer } from 'node:buffer'
import type {
  HerdrHostTransport,
  HerdrTerminalController,
  HerdrTerminalFrame
} from './herdr-runtime-contract'
import { decodeHerdrPtyId, HerdrPtyProvider } from './herdr-pty-provider'
import { graph, project, stockTransport } from './herdr-runtime-manager-test-fixtures'

function withObserve(host: ReturnType<typeof stockTransport>) {
  const transport: HerdrHostTransport = host.transport
  transport.controlTerminal = vi.fn((_session, _pane, options) => {
    const frameListeners = new Set<(frame: HerdrTerminalFrame) => void>()
    const observe: HerdrTerminalController = {
      write: vi.fn(),
      resize: vi.fn(),
      release: vi.fn(),
      onFrame: (listener) => {
        frameListeners.add(listener)
        return () => frameListeners.delete(listener)
      },
      onClosed: () => () => undefined
    }
    setTimeout(() => {
      for (const listener of frameListeners) {
        listener({
          type: 'terminal.frame',
          seq: 1,
          encoding: 'ansi',
          width: options?.cols ?? 80,
          height: options?.rows ?? 24,
          full: true,
          bytes: Buffer.from('prompt$ ', 'utf8').toString('base64')
        })
      }
    }, 0)
    return observe
  })
  return host
}

describe('Herdr split spawn', () => {
  it('gives each split leaf its own Herdr pane id', async () => {
    const host = withObserve(stockTransport())
    const splitGraph = graph()
    const provider = new HerdrPtyProvider(
      () => host.transport,
      async (opts) => ({
        project: project(),
        graph: splitGraph,
        identity: {
          version: 2,
          hostId: 'local',
          projectId: 'project-1',
          worktreeId: 'worktree-1',
          tabId: opts.tabId ?? 'tab-1',
          leafId: opts.paneKey?.slice(opts.paneKey.indexOf(':') + 1) ?? 'leaf-1'
        }
      })
    )
    const first = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-1'
    })
    const second = await provider.spawn({
      cols: 80,
      rows: 24,
      cwd: '/repo',
      worktreeId: 'worktree-1',
      tabId: 'tab-1',
      paneKey: 'tab-1:leaf-2'
    })
    expect(decodeHerdrPtyId(first.id)?.paneId).toBeTruthy()
    expect(decodeHerdrPtyId(second.id)?.paneId).toBeTruthy()
    expect(decodeHerdrPtyId(first.id)?.paneId).not.toBe(decodeHerdrPtyId(second.id)?.paneId)
  })
})
