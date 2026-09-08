import { describe, expect, it } from 'vitest'
import { resolveHerdrSpawnLayout } from './herdr-pty-layout-resolve'

describe('resolveHerdrSpawnLayout', () => {
  it('keeps a named split that already contains the leaf', () => {
    const split = {
      root: {
        type: 'split' as const,
        direction: 'vertical' as const,
        first: { type: 'leaf' as const, leafId: 'l1' },
        second: { type: 'leaf' as const, leafId: 'l2' }
      },
      activeLeafId: 'l2',
      expandedLeafId: null
    }
    expect(resolveHerdrSpawnLayout('l2', undefined, split)).toBe(split)
  })

  it('splits the host layout when the spawn leaf is not named yet', () => {
    const host = {
      root: { type: 'leaf' as const, leafId: 'l1' },
      activeLeafId: 'l1',
      expandedLeafId: null
    }
    expect(resolveHerdrSpawnLayout('l2', host, host)).toEqual({
      root: {
        type: 'split',
        direction: 'vertical',
        ratio: 0.5,
        first: host.root,
        second: { type: 'leaf', leafId: 'l2' }
      },
      activeLeafId: 'l2',
      expandedLeafId: null
    })
  })

  it('uses a single leaf when no host layout exists', () => {
    expect(resolveHerdrSpawnLayout('l1', undefined, undefined)).toEqual({
      root: { type: 'leaf', leafId: 'l1' },
      activeLeafId: 'l1',
      expandedLeafId: null
    })
  })
})
