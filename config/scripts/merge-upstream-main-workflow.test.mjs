import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const workflow = parse(
  readFileSync(join(projectDir, '.github/workflows/merge-upstream-main.yml'), 'utf8')
)
const mergeJob = workflow.jobs.merge
const mergeRun = mergeJob.steps[0].run

describe('upstream sync auto-merge workflow', () => {
  it('runs after PR Checks and periodically reconciles already-green PRs', () => {
    expect(workflow.on.workflow_run).toEqual({
      workflows: ['PR Checks'],
      types: ['completed']
    })
    expect(workflow.on.schedule).toEqual([{ cron: '37 * * * *' }])
    expect(workflow.on.workflow_dispatch).toBeNull()
    expect(workflow.concurrency).toEqual({
      group: 'merge-upstream-main',
      'cancel-in-progress': false
    })
  })

  it('keeps the default Actions token read-only and requires the sync PAT', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(mergeJob.env.GH_TOKEN).toBe('${{ secrets.UPSTREAM_SYNC_TOKEN }}')
    expect(mergeJob.env.GH_TOKEN).not.toContain('github.token')
    expect(mergeRun).toContain('if [ -z "$GH_TOKEN" ]')
  })

  it('limits workflow-run merges to successful checks for the mirror branch', () => {
    expect(mergeJob.if).toContain("github.repository == 'rudironsoni/orca'")
    expect(mergeJob.if).toContain("github.event.workflow_run.event == 'pull_request'")
    expect(mergeJob.if).toContain("github.event.workflow_run.conclusion == 'success'")
    expect(mergeJob.if).toContain("github.event.workflow_run.head_branch == 'upstream-main'")
    expect(mergeJob.env.RUN_HEAD_SHA).toBe('${{ github.event.workflow_run.head_sha }}')
    expect(mergeJob.env.RUN_PR_NUMBER).toBe(
      '${{ github.event.workflow_run.pull_requests[0].number }}'
    )
  })

  it('revalidates the trusted PR, exact head, CI result, and mergeability', () => {
    expect(mergeRun).toContain('.isCrossRepository == false')
    expect(mergeRun).toContain('.baseRefName == "main"')
    expect(mergeRun).toContain('.headRefName == "upstream-main"')
    expect(mergeRun).toContain('.headRefOid == $expected_head')
    expect(mergeRun).toContain('.name == "verify" and .workflowName == "PR Checks"')
    expect(mergeRun).toContain('if [ "$verify_conclusion" != "SUCCESS" ]')
    expect(mergeRun).toContain(`if [ "$(jq -r '.mergeable' <<<"$pr")" != "MERGEABLE" ]`)
  })

  it('uses only a head-pinned merge commit', () => {
    expect(mergeRun).toContain('gh pr merge "$pr_number"')
    expect(mergeRun).toContain('--merge')
    expect(mergeRun).toContain('--match-head-commit "$expected_head"')
    expect(mergeRun).not.toContain('--auto')
    expect(mergeRun).not.toContain('--squash')
    expect(mergeRun).not.toContain('--rebase')
  })
})
