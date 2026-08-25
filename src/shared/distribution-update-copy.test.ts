import { afterEach, describe, expect, it } from 'vitest'
import { downstreamUpdatesDisabledCopy } from './distribution-update-copy'

describe('downstreamUpdatesDisabledCopy', () => {
  afterEach(() => {
    delete (globalThis as { ORCA_DISTRIBUTION?: string }).ORCA_DISTRIBUTION
  })

  it('names the active distribution in every copy kind', () => {
    ;(globalThis as { ORCA_DISTRIBUTION?: string }).ORCA_DISTRIBUTION = 'horca'
    expect(downstreamUpdatesDisabledCopy('card')).toContain('Horca')
    expect(downstreamUpdatesDisabledCopy('settings')).toContain('Horca')
    expect(downstreamUpdatesDisabledCopy('aria')).toContain('Horca')
  })
})
