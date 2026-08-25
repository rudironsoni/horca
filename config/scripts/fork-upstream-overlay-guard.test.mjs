import { execFileSync } from 'node:child_process'
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
  GIT_LIST_MAX_BUFFER,
  inspectForkOverlay,
  isDeniedOverlayPath
} from './fork-upstream-overlay-guard.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const shepherdWorkflow = parse(
  readFileSync(join(projectDir, '.github', 'workflows', 'horca_shepherd.yml'), 'utf8')
)
const overlayWorkflow = parse(
  readFileSync(join(projectDir, '.github', 'workflows', 'horca_overlay_guard.yml'), 'utf8')
)

describe('fork upstream overlay guard', () => {
  const horcaReleaseForkOnlyPaths = [
    '.github/workflows/horca_bump_cask.yml',
    '.github/workflows/horca_beta_release.yml',
    '.github/workflows/horca_build.yml',
    '.github/workflows/horca_check_source.yml',
    '.github/workflows/horca_release.yml',
    'config/horca-homebrew/.github/workflows/horca-bump-cask.yml',
    'config/horca-homebrew/Casks/horca.rb',
    'config/horca-homebrew/Casks/horca@beta.rb',
    'config/horca-homebrew/README-horca.md',
    'config/scripts/horca-bump-homebrew-cask.sh',
    'config/scripts/horca-bump-homebrew-cask.test.mjs',
    'config/scripts/horca-prepare-release.sh',
    'config/scripts/horca-prepare-release.test.mjs',
    'config/scripts/horca-release-workflows.test.mjs'
  ]

  it('keeps the allowlist internally consistent', () => {
    expect(allowlistIntegrityErrors()).toEqual([])
  })

  it('names fork-only GitHub workflows horca_*.yml with Horca: titles', () => {
    const workflowPaths = [...FORK_ONLY_PATHS]
      .filter((relativePath) => relativePath.startsWith('.github/workflows/'))
      .sort()
    expect(workflowPaths.length).toBeGreaterThan(0)
    for (const relativePath of workflowPaths) {
      expect(relativePath).toMatch(/^\.github\/workflows\/horca_[a-z0-9_]+\.ya?ml$/)
      const parsed = parse(readFileSync(join(projectDir, relativePath), 'utf8'))
      expect(parsed.name, relativePath).toMatch(/^Horca: /)
    }
  })

  it('lists in-repo Horca release files as fork-only', () => {
    for (const relativePath of horcaReleaseForkOnlyPaths) {
      expect(FORK_ONLY_PATHS.has(relativePath)).toBe(true)
      expect(classifyForkPath(relativePath, 'fork-only')).toBe('allowed')
    }
    expect(FORK_ONLY_PATHS.has('.github/workflows/horca_repo_admin.yml')).toBe(true)
  })

  it('denies dual-tree patches under tests/e2e and locale JSON catalogs', () => {
    expect(DENIED_OVERLAY_PREFIXES).toEqual(['tests/e2e/', 'src/renderer/src/i18n/locales/'])
    expect(isDeniedOverlayPath('tests/e2e/helpers/startup-exec-readiness-oracle.ts')).toBe(true)
    expect(classifyForkPath('tests/e2e/helpers/startup-exec-readiness-oracle.ts', 'overlay')).toBe(
      'denied'
    )
    expect(isDeniedOverlayPath('src/renderer/src/i18n/locales/en.json')).toBe(true)
    expect(classifyForkPath('src/renderer/src/i18n/locales/en.json', 'overlay')).toBe('denied')
    expect(classifyForkPath('src/main/runtime/orca-runtime.ts', 'overlay')).toBe('unexpected')
    expect(classifyForkPath('src/shared/pairing.ts', 'overlay')).toBe('allowed')
    expect(classifyForkPath('src/renderer/src/web/web-pairing.ts', 'overlay')).toBe('allowed')
  })

  it('rejects unknown overlays and stale allowlist entries', () => {
    expect(classifyForkPath('src/main/unlisted-overlay.ts', 'overlay')).toBe('unexpected')
    expect(classifyForkPath('docs/new-horca-note.md', 'fork-only')).toBe('unexpected')
    expect(
      formatForkOverlayFailures([
        {
          filePath: 'tests/e2e/helpers/startup-exec-readiness-oracle.ts',
          kind: 'overlay',
          status: 'denied'
        },
        { filePath: 'docs/FORK_MAINTENANCE.md', kind: 'fork-only', status: 'allowed' }
      ])
    ).toEqual(['denied overlay: tests/e2e/helpers/startup-exec-readiness-oracle.ts'])
  })

  it('matches the allowlist against the Horca commit parent', () => {
    const tokens = execFileSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], {
      encoding: 'utf8'
    })
      .trim()
      .split(' ')
    // Merge commits are Shepherd catching main up; overlay-guard.yml is the live check.
    if (tokens.length !== 2) {
      return
    }
    const parentFiles = execFileSync('git', ['ls-tree', '-r', '--name-only', tokens[1]], {
      encoding: 'utf8',
      maxBuffer: GIT_LIST_MAX_BUFFER
    })
    // Squash commits on already-Horca main are not the original overlay vs upstream.
    if (parentFiles.includes('docs/FORK_MAINTENANCE.md')) {
      return
    }
    expect(formatForkOverlayFailures(inspectForkOverlay('HEAD', tokens[1]))).toEqual([])
    expect(ALLOWED_OVERLAY_PATHS.size).toBeGreaterThan(0)
    expect(FORK_ONLY_PATHS.has('config/scripts/fork-upstream-overlay-guard.mjs')).toBe(true)
  })

  it('lists the whole tree without Node spawnSync ENOBUFS', () => {
    expect(GIT_LIST_MAX_BUFFER).toBeGreaterThan(1024 * 1024)
    expect(() => inspectForkOverlay('HEAD', 'HEAD')).not.toThrow()
  })

  it('runs the overlay guard after scheduled Fork Shepherd syncs against stablyai/orca', () => {
    const step = shepherdWorkflow.jobs.shepherd.steps.find(
      (candidate) => candidate.name === 'Guard fork overlays against high-churn upstream files'
    )
    expect(step.run).toContain('config/scripts/fork-upstream-overlay-guard.mjs')
    expect(step.run).toContain('--ours origin/main')
    expect(step.run).toContain('https://github.com/stablyai/orca.git')
    expect(step.run).not.toContain('origin/upstream-main')
  })

  it('runs the overlay guard on pull requests against fetched upstream main', () => {
    expect(overlayWorkflow.on.pull_request).toBeDefined()
    const compare = overlayWorkflow.jobs.guard.steps.at(-1)
    expect(compare.run).toContain('--theirs FETCH_HEAD')
    expect(compare.if).toContain("github.event.pull_request.base.ref == 'main'")
  })
})
