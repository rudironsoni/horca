import { describe, expect, it } from 'vitest'
import { applyHorcaViteDistributionEnv } from './horca-vite-distribution'

describe('applyHorcaViteDistributionEnv', () => {
  it('defaults an unset flag to Horca so local vite builds own ~/.horca', () => {
    const env: NodeJS.ProcessEnv = {}
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('1')
  })

  it('leaves an explicit official opt-out alone', () => {
    const env: NodeJS.ProcessEnv = { ORCA_DOWNSTREAM_BUILD: '0' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('0')
  })

  it('leaves packaging Horca builds alone', () => {
    const env: NodeJS.ProcessEnv = { ORCA_DOWNSTREAM_BUILD: '1' }
    applyHorcaViteDistributionEnv(env)
    expect(env.ORCA_DOWNSTREAM_BUILD).toBe('1')
  })
})
