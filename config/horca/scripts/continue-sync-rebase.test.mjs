import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  PNPM_LOCKFILE_ONLY_ARGS,
  PNPM_LOCKFILE_ONLY_COMMAND,
  keepHorcaMobileIdentityWithUpstreamVersion,
  keepPaintContainmentInOverlayTerminalCss,
  mergeTerminalContainerGeometryTests,
  preferUpstreamTldtsInBundledMain,
  resolveOneSyncRebaseStop
} from './continue-sync-rebase.mjs'

const tempDirs = []

after(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo() {
  const root = mkdtempSync(join(tmpdir(), 'horca-continue-rebase-'))
  tempDirs.push(root)
  git(root, ['init', '--quiet', '-b', 'main'])
  git(root, ['config', 'user.name', 'Rudimar Ronsoni'])
  git(root, ['config', 'user.email', 'rudimar@outlook.com'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

describe('continue-sync-rebase', () => {
  it('keeps overlay Ghostty bundling and takes upstream tldts', () => {
    const source = [
      'const BUNDLED_MAIN_DEPENDENCIES = new Set([',
      "  'psl',",
      "  'zod',",
      "  '@herdr/sdk'",
      '])'
    ].join('\n')

    assert.equal(
      preferUpstreamTldtsInBundledMain(source),
      [
        'const BUNDLED_MAIN_DEPENDENCIES = new Set([',
        "  'tldts',",
        "  'zod',",
        "  '@herdr/sdk'",
        '])'
      ].join('\n')
    )
  })

  it('regenerates lockfiles through corepack pnpm', () => {
    assert.equal(PNPM_LOCKFILE_ONLY_COMMAND, 'corepack')
    assert.deepEqual(PNPM_LOCKFILE_ONLY_ARGS, [
      'pnpm',
      'install',
      '--lockfile-only',
      '--ignore-scripts'
    ])
  })

  it('keeps overlay deletions and retargets psl to tldts', () => {
    const root = initRepo()
    writeFileSync(join(root, 'keep.txt'), 'base\n')
    writeFileSync(join(root, 'drop.txt'), 'xterm\n')
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'psl'\n])\n"
    )
    git(root, ['add', 'keep.txt', 'drop.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'base'])

    git(root, ['checkout', '--quiet', '-b', 'overlay'])
    writeFileSync(join(root, 'keep.txt'), 'overlay\n')
    git(root, ['rm', '--quiet', 'drop.txt'])
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'psl',\n  '@herdr/sdk'\n])\n"
    )
    git(root, ['add', 'keep.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'overlay'])

    git(root, ['checkout', '--quiet', 'main'])
    writeFileSync(join(root, 'drop.txt'), 'upstream edited xterm\n')
    writeFileSync(
      join(root, 'electron.vite.config.ts'),
      "const BUNDLED_MAIN_DEPENDENCIES = new Set([\n  'tldts',\n  'zod'\n])\n"
    )
    git(root, ['add', 'drop.txt', 'electron.vite.config.ts'])
    git(root, ['commit', '--quiet', '-m', 'upstream'])

    const rebase = spawnSync('git', ['rebase', 'main', 'overlay'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(rebase.status, 0)
    assert.equal(resolveOneSyncRebaseStop(root), 'complete')
    const bundled = git(root, ['show', 'HEAD:electron.vite.config.ts'])
    assert.equal(bundled.includes("'tldts'"), true)
    assert.equal(bundled.includes('@herdr/sdk'), true)
    assert.equal(bundled.includes("'psl'"), false)
    const missing = spawnSync('git', ['show', 'HEAD:drop.txt'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(missing.status, 0)
  })

  it('unions Horca helper-textarea and upstream contain:paint geometry tests', () => {
    const tooltip = `  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.xterm-container/)
  })`
    const ours = `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
${tooltip}

  it('bounds cursor-blink repaints to the terminal surface (#10481)', () => {
    expect(terminalCss).toMatch(/\\.xterm-container\\s*{[^}]*contain:\\s*paint;/s)
  })
})
`
    const theirs = `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
${tooltip}

  it('hides the helper textarea as a sibling of the canvas', () => {
    expect(terminalCss).toMatch(/\\.xterm-container\\s*>\\s*\\.xterm-helper-textarea/)
  })
})
`
    const merged = mergeTerminalContainerGeometryTests(ours, theirs)
    assert.equal(merged.includes('#10481'), true)
    assert.equal(merged.includes('hides the helper textarea as a sibling of the canvas'), true)
    assert.equal(merged.includes('orca-terminal-container'), false)
  })

  it('retargets leftover xterm contain:paint after the Ghostty rename', () => {
    const ours = `describe('terminal container geometry', () => {
  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.xterm-container/)
  })

  it('bounds cursor-blink repaints to the terminal surface (#10481)', () => {
    expect(terminalCss).toMatch(/\\.xterm-container\\s*{[^}]*contain:\\s*paint;/s)
  })
})
`
    const theirs = `describe('terminal container geometry', () => {
  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.orca-terminal-container/)
  })

  it('hides the helper textarea as a sibling of the canvas', () => {
    expect(terminalCss).toMatch(/\\.orca-terminal-container\\s*>\\s*\\.orca-terminal-helper-textarea/)
  })
})
`
    const merged = mergeTerminalContainerGeometryTests(ours, theirs)
    assert.equal(merged.includes('#10481'), true)
    assert.equal(merged.includes('\\xterm-container'), false)
    assert.equal(merged.includes('orca-terminal-container'), true)
  })

  it('keeps overlay container rename and upstream paint containment', () => {
    const ours = `.xterm-container {
  box-sizing: border-box;
  width: calc(100% - var(--pane-padding-x, 4px));
  contain: paint;
}
`
    const theirs = `.orca-terminal-container {
  box-sizing: border-box;
  width: calc(100% - var(--pane-padding-x, 4px));
}
`
    const css = keepPaintContainmentInOverlayTerminalCss(ours, theirs)
    assert.equal(css.includes('.orca-terminal-container'), true)
    assert.equal(css.includes('contain: paint'), true)
    assert.equal(css.includes('#10481'), true)
  })

  it('keeps Horca mobile identity and takes the upstream version', () => {
    const ours = `{
  "expo": {
    "name": "Orca",
    "slug": "orca-mobile",
    "version": "0.0.50"
  }
}
`
    const theirs = `{
  "expo": {
    "name": "Horca",
    "slug": "horca-mobile",
    "version": "0.0.48"
  }
}
`
    const merged = keepHorcaMobileIdentityWithUpstreamVersion(ours, theirs)
    assert.equal(merged.includes('"name": "Horca"'), true)
    assert.equal(merged.includes('"slug": "horca-mobile"'), true)
    assert.equal(merged.includes('"version": "0.0.50"'), true)
    assert.equal(merged.includes('0.0.48'), false)
  })

  it('recovers the idle-paint geometry rebase stop', () => {
    const root = initRepo()
    const dir = join(root, 'src/renderer/src/assets')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'terminal-container-geometry.test.ts')
    const tooltip = `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.xterm-container/)
  })
})
`
    writeFileSync(path, tooltip)
    git(root, ['add', 'src/renderer/src/assets/terminal-container-geometry.test.ts'])
    git(root, ['commit', '--quiet', '-m', 'base'])

    git(root, ['checkout', '--quiet', '-b', 'overlay'])
    writeFileSync(
      path,
      `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.xterm-container/)
  })

  it('hides the helper textarea as a sibling of the canvas', () => {
    expect(terminalCss).toMatch(/\\.xterm-container\\s*>\\s*\\.xterm-helper-textarea/)
  })
})
`
    )
    git(root, ['add', 'src/renderer/src/assets/terminal-container-geometry.test.ts'])
    git(root, ['commit', '--quiet', '-m', 'overlay'])

    git(root, ['checkout', '--quiet', 'main'])
    writeFileSync(
      path,
      `import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const terminalCss = fs.readFileSync(new URL('./terminal.css', import.meta.url), 'utf8')

describe('terminal container geometry', () => {
  it('keeps the hidden link tooltip out of the fitted terminal height', () => {
    expect(terminalCss).toMatch(/\\.xterm-container/)
  })

  it('bounds cursor-blink repaints to the terminal surface (#10481)', () => {
    expect(terminalCss).toMatch(/\\.xterm-container\\s*{[^}]*contain:\\s*paint;/s)
  })
})
`
    )
    git(root, ['add', 'src/renderer/src/assets/terminal-container-geometry.test.ts'])
    git(root, ['commit', '--quiet', '-m', 'upstream'])

    const rebase = spawnSync('git', ['rebase', 'main', 'overlay'], { cwd: root, encoding: 'utf8' })
    assert.notEqual(rebase.status, 0)
    assert.equal(resolveOneSyncRebaseStop(root), 'complete')
    const resolved = git(root, [
      'show',
      'HEAD:src/renderer/src/assets/terminal-container-geometry.test.ts'
    ])
    assert.equal(resolved.includes('#10481'), true)
    assert.equal(resolved.includes('hides the helper textarea as a sibling of the canvas'), true)
  })
})
