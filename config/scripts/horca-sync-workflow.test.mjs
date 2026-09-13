import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  HORCA_COAUTHOR_TRAILER,
  HORCA_COMMIT_AUTHOR_EMAIL,
  HORCA_COMMIT_AUTHOR_NAME,
  ensureHorcaCoauthorTrailer,
  rewriteHeadHorcaCommitIdentity
} from '../horca/scripts/ensure-horca-commit-identity.mjs'
import {
  CASTING_SCAN_LABEL,
  HORCA_SKIP_CASTING_SCAN_ENV,
  OXLINT_SCANS,
  oxlintScansForGate,
  shouldSkipCastingScan
} from './check-changed-code-quality.mjs'

const workflow = parse(readFileSync('.github/workflows/horca_sync.yml', 'utf8'))
const ciWorkflow = parse(readFileSync('.github/workflows/horca_ci.yml', 'utf8'))
const tempDirs = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('Horca sync workflow', () => {
  it('accepts a pre-resolved maintenance candidate', () => {
    const candidateInput = workflow.on.workflow_dispatch.inputs.candidate_ref
    const inspectStep = workflow.jobs.candidate.steps.find(
      (step) => step.name === 'Inspect patch stack'
    )

    expect(candidateInput.required).toBe(false)
    expect(candidateInput.type).toBe('string')
    expect(inspectStep.env.CANDIDATE_REF).toBe('${{ inputs.candidate_ref }}')
    expect(inspectStep.run).toContain('git check-ref-format --branch "$CANDIDATE_REF"')
    expect(inspectStep.run).toContain('git merge-base --is-ancestor upstream/main "$candidate_sha"')
  })

  it('continues known lockfile, deletion, and tldts rebase stops', () => {
    const rebaseStep = workflow.jobs.candidate.steps.find(
      (step) => step.name === 'Rebase patch stack'
    )

    expect(rebaseStep.run).toContain(
      'cp config/horca/scripts/continue-sync-rebase.mjs "$continue_script"'
    )
    expect(rebaseStep.run).toContain(
      'while [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; do'
    )
    expect(rebaseStep.run).toContain('if ! node "$continue_script"; then')
    expect(rebaseStep.run).not.toContain('corepack enable')
  })

  it('uses the maintenance App for branches that contain workflow changes', () => {
    const candidateJob = workflow.jobs.candidate
    const tokenStep = candidateJob.steps.find((step) => step.name === 'Create maintenance token')
    const checkoutStep = candidateJob.steps.find((step) =>
      step.uses?.startsWith('actions/checkout@')
    )

    expect(candidateJob.environment).toBe('horca-maintenance')
    expect(tokenStep.with['app-id']).toBe('${{ secrets.HORCA_APP_ID }}')
    expect(checkoutStep.with.token).toBe('${{ steps.app.outputs.token }}')
  })

  it('rebases overlay commits as Rudimar Ronsoni with a Horca Maintenance co-author', () => {
    const rebaseStep = workflow.jobs.candidate.steps.find(
      (step) => step.name === 'Rebase patch stack'
    )

    expect(rebaseStep.run).toContain("git config user.name 'Rudimar Ronsoni'")
    expect(rebaseStep.run).toContain("git config user.email 'rudimar@outlook.com'")
    expect(rebaseStep.run).toContain(
      'cp config/horca/scripts/ensure-horca-commit-identity.mjs "$identity_script"'
    )
    expect(rebaseStep.run).toContain('--exec "node $identity_script"')
    expect(rebaseStep.run).not.toContain("git config user.name 'Horca Maintenance'")
    expect(rebaseStep.run).not.toContain(
      "git config user.email 'horca-maintenance@users.noreply.github.com'"
    )
  })
})

describe('Horca release workflow', () => {
  it('installs both mac CPU variants before packaging DMGs', () => {
    const release = parse(readFileSync('.github/workflows/horca_release.yml', 'utf8'))
    const macosInstall = release.jobs.macos.steps.find(
      (step) => typeof step.run === 'string' && step.run.includes('pnpm install')
    )

    expect(macosInstall.run).toBe('pnpm install:release')
  })
})

describe('Horca changed-code quality gate', () => {
  it('skips the upstream type-assertion scan against the overlay', () => {
    const lintStep = ciWorkflow.jobs.verify.steps.find((step) => step.name === 'Lint changed code')
    const boundaryStep = ciWorkflow.jobs.verify.steps.find(
      (step) => step.name === 'Test Horca boundaries'
    )

    expect(lintStep.env[HORCA_SKIP_CASTING_SCAN_ENV]).toBe('1')
    expect(lintStep.run).toContain('check:code-quality:changed')
    expect(boundaryStep.run).toContain('config/scripts/horca-sync-workflow.test.mjs')
  })

  it('keeps the casting scan exported and omits it from the Horca gate', () => {
    expect(OXLINT_SCANS.some((scan) => scan.label === CASTING_SCAN_LABEL)).toBe(true)
    expect(shouldSkipCastingScan({})).toBe(true)
    expect(shouldSkipCastingScan({ [HORCA_SKIP_CASTING_SCAN_ENV]: '0' })).toBe(false)
    expect(shouldSkipCastingScan({ [HORCA_SKIP_CASTING_SCAN_ENV]: '1' })).toBe(true)
    expect(oxlintScansForGate({}).some((scan) => scan.label === CASTING_SCAN_LABEL)).toBe(false)
    expect(
      oxlintScansForGate({ [HORCA_SKIP_CASTING_SCAN_ENV]: '0' }).some(
        (scan) => scan.label === CASTING_SCAN_LABEL
      )
    ).toBe(true)
  })
})

describe('Horca overlay commit identity', () => {
  it('adds the maintenance co-author trailer once', () => {
    const withExisting = ensureHorcaCoauthorTrailer(
      'fix(horca): example\n\nBody.\n\nCo-authored-by: Rudimar Ronsoni <rudimar@outlook.com>\n'
    )
    const withTrailer = ensureHorcaCoauthorTrailer(
      `fix(horca): example\n\n${HORCA_COAUTHOR_TRAILER}\n`
    )

    expect(withExisting).toContain('Co-authored-by: Rudimar Ronsoni <rudimar@outlook.com>')
    expect(withExisting.split(HORCA_COAUTHOR_TRAILER).length - 1).toBe(1)
    expect(withTrailer.split(HORCA_COAUTHOR_TRAILER).length - 1).toBe(1)
  })

  it('rewrites author and committer without duplicating the trailer', () => {
    const root = mkdtempSync(join(tmpdir(), 'horca-commit-identity-'))
    tempDirs.push(root)
    git(root, ['init', '--quiet'])
    git(root, ['config', 'user.name', 'Horca Maintenance'])
    git(root, ['config', 'user.email', 'horca-maintenance@users.noreply.github.com'])
    git(root, ['config', 'commit.gpgsign', 'false'])
    writeFileSync(join(root, 'README'), 'overlay\n')
    git(root, ['add', 'README'])
    git(root, ['commit', '--quiet', '-m', 'fix(horca): example\n'])

    expect(rewriteHeadHorcaCommitIdentity(root)).toBe(true)
    expect(rewriteHeadHorcaCommitIdentity(root)).toBe(false)

    expect(git(root, ['log', '-1', '--format=%an'])).toBe(HORCA_COMMIT_AUTHOR_NAME)
    expect(git(root, ['log', '-1', '--format=%ae'])).toBe(HORCA_COMMIT_AUTHOR_EMAIL)
    expect(git(root, ['log', '-1', '--format=%cn'])).toBe(HORCA_COMMIT_AUTHOR_NAME)
    expect(git(root, ['log', '-1', '--format=%ce'])).toBe(HORCA_COMMIT_AUTHOR_EMAIL)
    expect(git(root, ['log', '-1', '--format=%B'])).toContain(HORCA_COAUTHOR_TRAILER)
    expect(git(root, ['log', '-1', '--format=%B']).split(HORCA_COAUTHOR_TRAILER).length - 1).toBe(1)
  })
})
