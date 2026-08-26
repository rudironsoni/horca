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
  const build = workflow('horca_build.yml')
  const release = workflow('horca_release.yml')
  const betaRelease = workflow('horca_beta_release.yml')
  const bumpCask = workflow('horca_bump_cask.yml')
  const checkSource = workflow('horca_check_source.yml')
  const tagMirror = workflow('horca_mirror_upstream_v_tags.yml')
  const prepareScript = read('config/scripts/horca-prepare-release.sh')
  const bumpScript = read('config/scripts/horca-bump-homebrew-cask.sh')
  const homebrewCask = read('config/horca-homebrew/Casks/horca.rb')
  const homebrewBetaCask = read('config/horca-homebrew/Casks/horca@beta.rb')
  const homebrewBump = read('config/horca-homebrew/.github/workflows/horca-bump-cask.yml')

  it('builds on dispatch or workflow_call, not on push to main', () => {
    expect(build.on.push).toBeUndefined()
    expect(build.on.workflow_dispatch).toBeDefined()
    expect(build.on.workflow_call).toBeDefined()
    expect(build.on.workflow_dispatch.inputs.version.required).toBe(false)
    expect(build.on.pull_request).toBeUndefined()
    expect(build.on.workflow_call.secrets.MAC_CERTS.required).toBe(false)
    expect(build.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': false
    })
    const validateRun = build.jobs.validate.steps.find((step) => step.id === 'check').run
    expect(validateRun).toContain('(-beta\\.[0-9]+)?')
    expect(validateRun).toContain('<core>-horca.<N>-beta.<M>')
  })

  it('releases on every push to main', () => {
    expect(release.on.push).toEqual({ branches: ['main'] })
    expect(release.on.workflow_dispatch).toBeDefined()
    expect(release.on.workflow_call).toBeDefined()
    expect(release.on.pull_request).toBeUndefined()
    expect(release.on.workflow_call.secrets.MAC_CERTS.required).toBe(false)
    expect(release.concurrency).toEqual({
      group: 'horca-release',
      'cancel-in-progress': false
    })
  })

  it('gates every Horca job to rudironsoni/orca', () => {
    for (const [name, job] of Object.entries({
      ...build.jobs,
      ...release.jobs,
      ...betaRelease.jobs,
      ...bumpCask.jobs,
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

  it('grants Actions token scopes for artifact upload and download', () => {
    expect(build.permissions).toEqual({ contents: 'read', actions: 'write' })
    expect(release.permissions).toEqual({ contents: 'write', actions: 'write' })
    expect(bumpCask.permissions).toEqual({ contents: 'read' })
  })

  it('uploads only the three Horca binaries from the build workflow', () => {
    const uploads = Object.values(build.jobs).flatMap((job) =>
      (job.steps ?? []).filter((step) => step.uses?.startsWith('actions/upload-artifact@'))
    )
    expect(uploads.map((step) => step.with.name).sort()).toEqual([
      'horca-macos-dmgs',
      'horca-windows-setup'
    ])
    const paths = uploads.flatMap((step) =>
      String(step.with.path)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    )
    expect(paths.sort()).toEqual([
      'dist/horca-macos-arm64.dmg',
      'dist/horca-macos-x64.dmg',
      'dist/horca-windows-x64-setup.exe'
    ])
  })

  it('does not treat Horca.exe as Orca.exe in the Windows protocol check', () => {
    const silentInstall = build.jobs['build-windows'].steps.find(
      (step) => step.name === 'Silent-install and verify OS registration'
    )
    expect(silentInstall.run).toContain("'*\\Horca.exe*'")
    expect(silentInstall.run).toContain("'*\\Orca.exe*'")
    expect(silentInstall.run).not.toMatch(/-like '\*Orca\.exe\*'/)
    expect(silentInstall.run).not.toMatch(/-notlike '\*Horca\.exe\*'/)
  })

  it('reuses named build artifacts in publish and never packages again', () => {
    const publish = release.jobs.publish
    const publishText = JSON.stringify(publish)
    expect(publishText).not.toMatch(/electron-builder/)
    expect(publishText).not.toMatch(/build:mac/)
    expect(publishText).not.toMatch(/build:release/)

    const downloads = publish.steps.filter((step) =>
      step.uses?.startsWith('actions/download-artifact@')
    )
    expect(downloads.map((step) => step.with.name).sort()).toEqual([
      'horca-macos-dmgs',
      'horca-windows-setup',
      'release-notes'
    ])
    expect(downloads.every((step) => step.with.path === 'artifacts')).toBe(true)
    expect(downloads.some((step) => step.with.name == null)).toBe(false)

    const notesUpload = release.jobs.prepare.steps.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@')
    )
    expect(notesUpload.with.name).toBe('release-notes')
  })

  it('publishes a Horca tag at the source commit and never updater feeds', () => {
    const publish = release.jobs.publish.steps.find((step) => step.name === 'Publish release')
    expect(publish.run).toContain('gh release create "$TAG"')
    expect(publish.run).toContain('--repo "$GITHUB_REPOSITORY"')
    expect(publish.run).toContain('horca-macos-arm64.dmg')
    expect(publish.run).toContain('horca-macos-x64.dmg')
    expect(publish.run).toContain('horca-windows-x64-setup.exe')
    expect(publish.run).toContain('--target "$SOURCE_SHA"')
    expect(publish.run).toContain('--draft')
    expect(publish.run).toContain(
      'gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false'
    )
    expect(publish.run).not.toContain('--prerelease')
    expect(release.jobs.prepare.steps.find((step) => step.id === 'meta').env.BUILDS_REPO).toBe(
      '${{ github.repository }}'
    )
    expect(
      release.jobs.publish.steps.find((step) => step.name === 'Verify the complete artifact set')
        .run
    ).toContain('updater feed files must never be released')
    expect(prepareScript).toMatch(/\/\^v\\d\+\\\.\\d\+\\\.\\d\+-horca\\\.\\d\+\$\//)
    expect(prepareScript).toContain('Source-Repo: rudironsoni/orca')
    expect(prepareScript).toContain('git fetch --no-tags https://github.com/stablyai/orca.git main')
    expect(prepareScript).toContain('HORCA_UPSTREAM_TIP_REF')
    expect(prepareScript).not.toContain('origin/upstream-main')
    expect(prepareScript).not.toContain('merge upstream-main into main before releasing')
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
    expect(checkSource.jobs.release.uses).toBe('./.github/workflows/horca_release.yml')
  })

  it('excludes Horca tags from the upstream desktop tag mirror', () => {
    const mirror = tagMirror.jobs.mirror.steps.find((step) => step.run?.includes('list_v_tags'))
    expect(mirror.run).toContain(' !~ /-horca\\./')
    expect(tagMirror.on.schedule).toEqual([{ cron: '19 * * * *' }])
  })

  it('waits on bump-horca-cask after the GitHub Release is published', () => {
    expect(release.jobs.build.uses).toBe('./.github/workflows/horca_build.yml')
    expect(release.jobs['bump-cask'].uses).toBe('./.github/workflows/horca_bump_cask.yml')
    expect(release.jobs['bump-cask'].needs).toEqual(['prepare', 'publish'])
    expect(release.jobs['bump-cask']['continue-on-error']).toBeUndefined()
    expect(release.jobs['bump-cask'].with.version).toBe('${{ needs.prepare.outputs.version }}')
    expect(release.jobs['bump-cask'].with.cask_token).toBe('horca')
    expect(release.jobs['bump-cask'].secrets.FORK_SYNC_PAT).toBe('${{ secrets.FORK_SYNC_PAT }}')

    expect(bumpCask.on.push).toBeUndefined()
    expect(bumpCask.on.workflow_call.inputs.version.required).toBe(true)
    expect(bumpCask.on.workflow_call.inputs.cask_token.default).toBe('horca')
    expect(bumpCask.on.workflow_call.secrets.FORK_SYNC_PAT.required).toBe(true)
    expect(bumpCask.concurrency).toEqual({
      group: "bump-horca-cask-${{ inputs.cask_token || 'horca' }}",
      'cancel-in-progress': false
    })
    const tapCheckout = checkoutSteps(bumpCask.jobs.bump).find(
      (step) => step.with?.repository === 'rudironsoni/homebrew-tap'
    )
    expect(tapCheckout.with.path).toBe('homebrew-tap')
    expect(tapCheckout.with.token).toBe('${{ secrets.FORK_SYNC_PAT }}')
    expect(bumpCask.jobs.bump.steps.find((step) => step.id === 'update').run).toContain(
      'config/scripts/horca-bump-homebrew-cask.sh'
    )
    expect(bumpScript).toContain('--repo rudironsoni/orca')
    expect(bumpScript).toContain('CASK_TOKEN=${CASK_TOKEN:-horca}')
    expect(bumpScript).toContain('horca@beta')
    expect(bumpScript).not.toContain('orca-builds')
    expect(bumpCask.jobs.bump.steps.find((step) => step.name === 'Commit and push').run).toContain(
      'Casks/${CASK_TOKEN}.rb'
    )
    expect(bumpCask.jobs.bump.steps.find((step) => step.name === 'Style and audit').run).toContain(
      'Casks/${CASK_TOKEN}.rb'
    )
    expect(homebrewBump).not.toContain('workflow_call:')
  })

  it('releases Horca betas from conventional branches as GitHub prereleases', () => {
    expect(betaRelease.on.push.branches).toEqual([
      'feature/**',
      'feat/**',
      'fix/**',
      'bugfix/**',
      'hotfix/**',
      'perf/**',
      'refactor/**'
    ])
    expect(betaRelease.on.push.branches).not.toContain('main')
    expect(betaRelease.on.push.branches.join('\n')).not.toMatch(/cursor|chore|docs|release/)
    expect(betaRelease.on.workflow_call).toBeUndefined()
    expect(betaRelease.on.pull_request).toBeUndefined()
    expect(betaRelease.concurrency).toEqual({
      group: 'horca-beta-release-${{ github.ref }}',
      'cancel-in-progress': true
    })
    expect(release.concurrency).toEqual({
      group: 'horca-release',
      'cancel-in-progress': false
    })

    const skipGate = betaRelease.jobs.prepare.if
    expect(skipGate).toContain(horcaRepoGate)
    expect(skipGate).toContain('[skip horca-beta]')
    expect(skipGate).toContain('[skip horca-release]')

    const meta = betaRelease.jobs.prepare.steps.find((step) => step.id === 'meta')
    expect(meta.env.HORCA_CHANNEL).toBe('beta')
    expect(meta.env.HORCA_BRANCH).toBe('${{ github.ref_name }}')
    expect(betaRelease.jobs.build.uses).toBe('./.github/workflows/horca_build.yml')
    expect(betaRelease.jobs.build.secrets).toBe('inherit')
    expect(betaRelease.jobs['bump-cask'].uses).toBe('./.github/workflows/horca_bump_cask.yml')
    expect(betaRelease.jobs['bump-cask'].needs).toEqual(['prepare', 'publish'])
    expect(betaRelease.jobs['bump-cask'].with.cask_token).toBe('horca@beta')
    expect(betaRelease.jobs['bump-cask'].with.version).toBe('${{ needs.prepare.outputs.version }}')

    const publish = betaRelease.jobs.publish.steps.find(
      (step) => step.name === 'Publish prerelease'
    )
    expect(publish.run).toContain('--prerelease')
    expect(publish.run).toContain('--target "$SOURCE_SHA"')
    expect(publish.run).toContain('--draft')
    expect(publish.run).toContain('horca-macos-arm64.dmg')
    expect(publish.run).toContain('Horca $VERSION (beta)')
    expect(
      betaRelease.jobs.publish.steps.find(
        (step) => step.name === 'Verify the complete artifact set'
      ).run
    ).toContain('Channel: beta')
    expect(prepareScript).toContain('HORCA_CHANNEL')
    expect(prepareScript).toMatch(/\/\^v\\d\+\\\.\\d\+\\\.\\d\+-horca\\\.\\d\+\$\//)
  })

  it('points Homebrew staging at Horca releases on this repository', () => {
    expect(homebrewCask).toContain('depends_on macos: :big_sur')
    expect(homebrewCask).not.toContain('depends_on macos: ">=')
    expect(homebrewCask).toContain(
      'https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg'
    )
    expect(homebrewCask).toContain('regex(/^v(\\d+(?:\\.\\d+)+-horca\\.\\d+)$/i)')
    expect(homebrewCask).not.toContain('orca-builds')
    expect(homebrewCask).not.toContain('0.0.0-horca.0')
    expect(homebrewCask).not.toContain('REPLACE_WITH')
    expect(homebrewCask).toContain('version "1.4.178-horca.1"')
    expect(homebrewCask).toContain(
      '9ce7f01743ef39bec28d3fe2bd5088fb82285f04082e6e987a557913ab9188b0'
    )
    expect(homebrewCask).toContain(
      '6d81181bfbb99f51f91c64329c3df871539fb68cddf6bc5f967337f6e472d0bc'
    )
    expect(homebrewBump).toContain('repos/rudironsoni/orca/releases')
    expect(homebrewBump).toContain(horcaTagJqTest)
    expect(homebrewBump).toContain(
      'test("^v[0-9]+\\\\.[0-9]+\\\\.[0-9]+-horca\\\\.[0-9]+-beta\\\\.[0-9]+$")'
    )
    expect(homebrewBump).toContain('select(.prerelease)')
    expect(homebrewBump).toContain('Casks/horca@beta.rb')
    expect(homebrewBump).toContain('--repo rudironsoni/orca')
    expect(homebrewBump).not.toContain('orca-builds')
    expect(homebrewBump).not.toMatch(/\/releases\/latest/)

    expect(homebrewBetaCask).toContain('cask "horca@beta"')
    expect(homebrewBetaCask).toContain('conflicts_with cask: "horca"')
    expect(homebrewBetaCask).not.toMatch(/^\s*auto_updates\b/m)
    expect(homebrewBetaCask).toContain('strategy :github_releases')
    expect(homebrewBetaCask).toContain('next unless release["prerelease"]')
    expect(homebrewBetaCask).toContain('regex(/^v(\\d+(?:\\.\\d+)+-horca\\.\\d+-beta\\.\\d+)$/i)')
    expect(homebrewBetaCask).not.toContain('strategy :github_latest')
    expect(homebrewBetaCask).toContain(
      'https://github.com/rudironsoni/orca/releases/download/v#{version}/horca-macos-#{arch}.dmg'
    )
    expect(homebrewBetaCask).toContain('depends_on macos: :big_sur')
  })
})
