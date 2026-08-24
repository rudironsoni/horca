import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectDir = resolve(import.meta.dirname, '../..')
const read = (relativePath) => readFileSync(join(projectDir, relativePath), 'utf8')
const workflow = (name) => parse(read(join('.github', 'workflows', name)))
const horcaRepoGate = "github.repository == 'rudironsoni/orca'"
// jq string literals escape dots as \\. — this is the source form in the workflows.
const horcaTagJqTest = 'test("^v[0-9]+\\\\.[0-9]+\\\\.[0-9]+-horca\\\\.[0-9]+$")'

function checkoutSteps(job) {
  return (job.steps ?? []).filter((step) => step.uses?.startsWith('actions/checkout@'))
}

describe('in-repo Horca release workflows', () => {
  const build = workflow('horca-build.yml')
  const release = workflow('horca-release.yml')
  const checkSource = workflow('horca-check-source.yml')
  const sync = workflow('sync-upstream-main.yml')
  const prepareScript = read('config/scripts/horca-prepare-release.sh')
  const homebrewCask = read('config/horca-homebrew/Casks/horca.rb')
  const homebrewBump = read('config/horca-homebrew/.github/workflows/bump-horca-cask.yml')

  it('builds only from dispatch or workflow_call, never push or pull_request', () => {
    expect(build.on.workflow_dispatch).toBeDefined()
    expect(build.on.workflow_call).toBeDefined()
    expect(build.on.workflow_dispatch.inputs.version.required).toBe(true)
    expect(build.on.push).toBeUndefined()
    expect(build.on.pull_request).toBeUndefined()
  })

  it('gates every Horca job to rudironsoni/orca', () => {
    for (const [name, job] of Object.entries({
      ...build.jobs,
      ...release.jobs,
      ...checkSource.jobs
    })) {
      expect(job.if, name).toContain(horcaRepoGate)
    }
  })

  it('checks out this repository at the requested SHA', () => {
    for (const job of Object.values(build.jobs)) {
      for (const step of checkoutSteps(job)) {
        expect(step.with?.repository).toBeUndefined()
        expect(step.with.ref).toMatch(/inputs\.sha|needs\.validate\.outputs\.sha/)
      }
    }
    for (const step of checkoutSteps(release.jobs.prepare)) {
      expect(step.with?.repository).toBeUndefined()
    }
  })

  it('publishes a Horca tag at the source commit and never updater feeds', () => {
    const publish = release.jobs.publish.steps.find((step) => step.name === 'Publish release')
    expect(publish.run).toContain('gh release create "$TAG"')
    expect(publish.run).toContain('--target "$SOURCE_SHA"')
    expect(publish.run).toContain('--draft')
    expect(publish.run).toContain(
      'gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false'
    )
    expect(release.jobs.prepare.steps.find((step) => step.id === 'meta').env.BUILDS_REPO).toBe(
      '${{ github.repository }}'
    )
    expect(
      release.jobs.publish.steps.find((step) => step.name === 'Verify the complete artifact set')
        .run
    ).toContain('updater feed files must never be released')
    expect(prepareScript).toMatch(/\/\^v\\d\+\\\.\\d\+\\\.\\d\+-horca\\\.\\d\+\$\//)
    expect(prepareScript).toContain('Source-Repo: rudironsoni/orca')
  })

  it('detects source changes from Horca tags only and refuses to bootstrap', () => {
    expect(checkSource.on.schedule).toEqual([{ cron: '17 */6 * * *' }])
    expect(checkSource.on.push).toBeUndefined()
    const compare = checkSource.jobs.detect.steps.find((step) => step.id === 'compare')
    expect(compare.run).toContain(horcaTagJqTest)
    expect(compare.run).not.toMatch(/gh api .*\/releases\/latest/)
    expect(compare.run).toContain('/releases" --paginate')
    expect(compare.run).toContain('the first release must be cut manually')
    expect(compare.run).toContain('changed=false')
    expect(checkSource.jobs.release.if).toContain("needs.detect.outputs.changed == 'true'")
    expect(checkSource.jobs.release.uses).toBe('./.github/workflows/horca-release.yml')
  })

  it('excludes Horca tags from the upstream desktop tag mirror', () => {
    const mirror = sync.jobs.sync.steps.find((step) => step.run?.includes('list_v_tags'))
    expect(mirror.run).toContain('$2 !~ /-horca\\./')
  })

  it('points Homebrew staging at Horca releases on this repository', () => {
    expect(homebrewCask).toContain(
      'https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg'
    )
    expect(homebrewCask).toContain('regex(/^v(\\d+(?:\\.\\d+)+-horca\\.\\d+)$/i)')
    expect(homebrewBump).toContain('repos/rudironsoni/orca/releases')
    expect(homebrewBump).toContain(horcaTagJqTest)
    expect(homebrewBump).toContain('--repo rudironsoni/orca')
    expect(homebrewBump).not.toContain('orca-builds')
  })
})
