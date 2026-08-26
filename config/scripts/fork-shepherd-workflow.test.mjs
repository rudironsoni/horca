import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = (name) =>
  parse(readFileSync(join(projectDir, '.github', 'workflows', name), 'utf8'))

describe('fork-shepherd workflow', () => {
  const parsed = workflow('horca_shepherd.yml')
  const job = parsed.jobs.shepherd
  const shepherd = job.steps.find((step) => step.uses?.startsWith('FasterApiWeb/fork-shepherd@'))
  const overlay = job.steps.find(
    (step) => step.name === 'Guard fork overlays against high-churn upstream files'
  )

  it('covers branch sync, backport, cleanup, and sync-bot; PR monitor stays off', () => {
    expect(parsed.on.schedule).toEqual([{ cron: '17 * * * *' }])
    expect(parsed.on.workflow_dispatch).toBeDefined()
    expect(parsed.on.push).toEqual({ branches: ['main'] })
    expect(parsed.on.pull_request_target.types).toEqual(['opened', 'labeled', 'closed'])
    expect(job.if).toContain("github.repository == 'rudironsoni/orca'")
    expect(shepherd.uses).toBe('FasterApiWeb/fork-shepherd@v1')
    expect(shepherd.with.upstream_repo).toBe('stablyai/orca')
    expect(shepherd.with.sync_branches).toBe('main')
    expect(shepherd.with.monitor_all_prs).toBe('false')
    expect(shepherd.with.enable_branch_sync).toBe('true')
    expect(shepherd.with.enable_pr_monitor).toBe('false')
    expect(shepherd.with.enable_backport).toBe('true')
    expect(shepherd.with.enable_cleanup).toBe('true')
    expect(shepherd.with.bot_name).toBe('sync-bot')
    expect(shepherd.with.pr_label).toBe('sync-bot')
    expect(shepherd.with.merge_strategy).toBe('merge')
    expect(shepherd.with.conflict_label).toBe('sync-conflict')
  })

  it('authenticates checkout and the action with the same PAT', () => {
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'))
    expect(checkout.with.token).toBe('${{ secrets.FORK_SYNC_PAT }}')
    expect(checkout.with['persist-credentials']).toBe(false)
    expect(shepherd.with.github_token).toBe('${{ secrets.FORK_SYNC_PAT }}')
  })

  it('re-runs the overlay ratchet after scheduled syncs against stablyai/orca main', () => {
    expect(overlay.if).toContain("github.event_name == 'schedule'")
    expect(overlay.run).toContain('https://github.com/stablyai/orca.git')
    expect(overlay.run).toContain('fork-upstream-overlay-guard.mjs')
    expect(overlay.run).toContain('--ours origin/main')
    expect(overlay.run).not.toContain('origin/upstream-main')
  })
})

describe('fork overlay guard workflow', () => {
  const parsed = workflow('horca_overlay_guard.yml')

  it('runs on pull requests without pull_request_target', () => {
    expect(parsed.on.pull_request).toBeDefined()
    expect(parsed.on.pull_request_target).toBeUndefined()
    expect(parsed.jobs.guard.if).toContain("github.repository == 'rudironsoni/orca'")
    const compare = parsed.jobs.guard.steps.at(-1)
    expect(compare.run).toContain('--theirs FETCH_HEAD')
    expect(compare.if).toContain("github.event.pull_request.base.ref == 'main'")
  })
})
