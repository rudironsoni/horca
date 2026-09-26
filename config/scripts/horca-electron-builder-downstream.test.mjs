import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { applyDownstreamDistribution } = require('../electron-builder-downstream.cjs')
const previousDownstreamBuild = process.env.ORCA_DOWNSTREAM_BUILD

afterEach(() => {
  if (previousDownstreamBuild === undefined) {
    delete process.env.ORCA_DOWNSTREAM_BUILD
  } else {
    process.env.ORCA_DOWNSTREAM_BUILD = previousDownstreamBuild
  }
})

describe('Horca downstream packaging', () => {
  it('packages the managed Herdr binary on every desktop platform', () => {
    process.env.ORCA_DOWNSTREAM_BUILD = '1'
    const config = applyDownstreamDistribution({
      win: { extraResources: [] },
      mac: { extraResources: [] },
      linux: { extraResources: [] }
    })
    const expected = [{ from: 'out/horca-herdr/${arch}', to: 'herdr' }]

    expect(config.win.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.mac.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.linux.extraResources).toEqual(expect.arrayContaining(expected))
    expect(config.beforePack).toBeTypeOf('function')
  })

  it('packages the MAIN Ghostty addon on every desktop platform', () => {
    process.env.ORCA_DOWNSTREAM_BUILD = '1'
    const config = applyDownstreamDistribution({
      win: { extraResources: [] },
      mac: { extraResources: [] },
      linux: { extraResources: [] }
    })
    expect(config.mac.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          to: 'horca-ghostty',
          filter: expect.arrayContaining(['surface-pixels.js'])
        })
      ])
    )
    expect(config.win.extraResources).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: 'horca-ghostty' })])
    )
    expect(config.linux.extraResources).toEqual(
      expect.arrayContaining([expect.objectContaining({ to: 'horca-ghostty' })])
    )
  })

  it('overlay packager copies the pane size helper', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../overlay/manifest.json', import.meta.url), 'utf8')
    )
    const entry = manifest.overrides.find(
      (item) => item.id === 'd2-packaging-mac-horca-ghostty-extra-resources'
    )
    expect(entry.replace).toContain("'surface-pixels.js'")
  })
})
