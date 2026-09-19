import { describe, expect, it, vi } from 'vitest'

const prime = vi.hoisted(() => {
  let release: (value: unknown) => void = () => undefined
  const pending = new Promise((resolve) => {
    release = resolve
  })
  return {
    release: () => release(undefined),
    pending,
    fn: vi.fn(() => pending)
  }
})

vi.mock('../lib/ghostty-vt-web-host', () => ({
  primeGhosttyVtHost: prime.fn
}))

import { bootGhosttyVtHostThen } from './boot-ghostty-vt-host'

describe('bootGhosttyVtHostThen', () => {
  it('does not construct the React tree until Ghostty VT host priming finishes', async () => {
    let rendered = false
    const done = bootGhosttyVtHostThen(() => {
      rendered = true
    })
    await Promise.resolve()
    expect(prime.fn).toHaveBeenCalledTimes(1)
    expect(rendered).toBe(false)
    prime.release()
    await done
    expect(rendered).toBe(true)
  })
})
