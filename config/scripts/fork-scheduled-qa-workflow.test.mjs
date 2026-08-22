import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = (name) =>
  parse(readFileSync(join(projectDir, '.github', 'workflows', name), 'utf8'))
const scheduleGate = "github.event_name != 'schedule' || github.repository == 'stablyai/orca'"

describe('fork scheduled QA workflow gates', () => {
  it.each([
    ['e2e.yml', 'build'],
    ['terminal-perf.yml', 'terminal-perf'],
    ['terminal-ime-e2e.yml', 'linux-x11']
  ])('keeps %s schedules on the canonical repository', (file, job) => {
    const parsed = workflow(file)

    expect(parsed.jobs[job].if).toBe(scheduleGate)
    expect(parsed.on.workflow_dispatch).toBeDefined()
  })

  it('keeps manual computer-use E2E available on forks', () => {
    const parsed = workflow('computer-e2e.yml')

    expect(parsed.on.workflow_dispatch).toBeNull()
    for (const job of ['mac', 'linux', 'windows']) {
      expect(parsed.jobs[job].if).toContain(scheduleGate)
      expect(parsed.jobs[job].if).toContain("github.event_name != 'pull_request'")
    }
  })
})
