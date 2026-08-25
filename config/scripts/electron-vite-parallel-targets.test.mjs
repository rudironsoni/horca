import { describe, expect, it } from 'vitest'
import { runElectronViteTargets } from './run-electron-vite-targets-in-parallel.mjs'

async function measureConcurrency(platform) {
  let active = 0
  let maxActive = 0
  const targets = []
  const results = await runElectronViteTargets({
    platform,
    runTarget: async (target) => {
      targets.push(target)
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
    }
  })
  return { maxActive, results, targets }
}

describe('Electron Vite parallel target runner', () => {
  it('isolates config loading on Windows', async () => {
    const result = await measureConcurrency('win32')

    expect(result.maxActive).toBe(1)
    expect(result.targets).toEqual(['main', 'preload', 'renderer'])
    expect(result.results.every((entry) => entry.status === 'fulfilled')).toBe(true)
  })

  it('retains parallel target builds on other platforms', async () => {
    const result = await measureConcurrency('linux')

    expect(result.maxActive).toBe(3)
  })
})
