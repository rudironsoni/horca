import { describe, expect, it, vi } from 'vitest'
import { createLocalBackendPtyProvider } from './terminal-backend-composition'

vi.mock('./multiplexer/herdr/herdr-provider-factory', () => ({
  createLocalHerdrPtyProvider: (fallback: unknown) => ({
    kind: 'local',
    fallback,
    dispose: () => undefined,
    replaceFallback: () => undefined
  }),
  createSshHerdrPtyProvider: (fallback: unknown) => ({ kind: 'ssh', fallback })
}))

describe('terminal backend composition', () => {
  it('constructs the local backend through the Herdr factory', () => {
    const fallback = { spawn: vi.fn() }
    const store = {} as never
    expect(createLocalBackendPtyProvider(fallback as never, store)).toEqual({
      kind: 'local',
      fallback,
      dispose: expect.any(Function),
      replaceFallback: expect.any(Function)
    })
  })
})
