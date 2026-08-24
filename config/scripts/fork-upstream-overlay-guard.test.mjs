import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  ALLOWED_OVERLAY_PATHS,
  allowlistIntegrityErrors,
  classifyForkPath,
  DENIED_OVERLAY_PREFIXES,
  formatForkOverlayFailures,
  FORK_ONLY_PATHS,
  inspectForkOverlay,
  isDeniedOverlayPath
} from './fork-upstream-overlay-guard.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const syncWorkflow = parse(
  readFileSync(join(projectDir, '.github/workflows/sync-upstream-main.yml'), 'utf8')
)

describe('fork upstream overlay guard', () => {
  it('keeps the allowlist internally consistent', () => {
    expect(allowlistIntegrityErrors()).toEqual([])
  })

  it('denies dual-tree patches under tests/e2e', () => {
    expect(DENIED_OVERLAY_PREFIXES).toEqual(['tests/e2e/'])
    expect(isDeniedOverlayPath('tests/e2e/helpers/startup-exec-readiness-oracle.ts')).toBe(true)
    expect(classifyForkPath('tests/e2e/helpers/startup-exec-readiness-oracle.ts', 'overlay')).toBe(
      'denied'
    )
    expect(classifyForkPath('tests/e2e/ssh-startup-exec-readiness.spec.ts', 'overlay')).toBe(
      'denied'
    )
    expect(classifyForkPath('src/main/runtime/orca-runtime.ts', 'overlay')).toBe('allowed')
  })

  it('rejects unknown overlays and stale allowlist entries', () => {
    expect(classifyForkPath('src/main/unlisted-overlay.ts', 'overlay')).toBe('unexpected')
    expect(classifyForkPath('docs/new-horca-note.md', 'fork-only')).toBe('unexpected')
    expect(
      formatForkOverlayFailures([
        { filePath: 'tests/e2e/helpers/startup-exec-readiness-oracle.ts', kind: 'overlay', status: 'denied' },
        { filePath: 'docs/FORK_MAINTENANCE.md', kind: 'fork-only', status: 'allowed' }
      ])
    ).toEqual(['denied overlay: tests/e2e/helpers/startup-exec-readiness-oracle.ts'])
  })

  it('runs the live tree comparison when the upstream mirror ref exists', () => {
    let findings
    try {
      findings = inspectForkOverlay('HEAD', 'origin/upstream-main')
    } catch (error) {
      if (String(error).includes('origin/upstream-main')) {
        return
      }
      throw error
    }

    expect(formatForkOverlayFailures(findings)).toEqual([])
    expect(ALLOWED_OVERLAY_PATHS.size).toBeGreaterThan(0)
    expect(FORK_ONLY_PATHS.has('config/scripts/fork-upstream-overlay-guard.mjs')).toBe(true)
  })

  it('runs the overlay guard during hourly upstream sync', () => {
    const step = syncWorkflow.jobs.sync.steps.find(
      (candidate) => candidate.name === 'Guard fork overlays against high-churn upstream files'
    )
    expect(step.run).toContain('config/scripts/fork-upstream-overlay-guard.mjs')
    expect(step.run).toContain('--ours origin/main')
    expect(step.run).toContain('--theirs origin/upstream-main')
  })
})
