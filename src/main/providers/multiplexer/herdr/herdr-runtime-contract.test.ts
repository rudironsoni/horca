import { describe, expect, it } from 'vitest'
import { HERDR_SCHEMA_VERSION, SUPPORTED_HERDR_PROTOCOLS } from './herdr-runtime-contract'

describe('stock Herdr compatibility', () => {
  it('accepts protocol 22', () => {
    expect(SUPPORTED_HERDR_PROTOCOLS).toEqual([22])
    expect(HERDR_SCHEMA_VERSION).toBe(1)
  })
})
