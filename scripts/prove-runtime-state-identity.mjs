import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = resolve(import.meta.dirname, '..')

function main() {
  const worktree = process.argv[2]
  if (!worktree) {
    throw new Error('Usage: node scripts/prove-runtime-state-identity.mjs <worktree>')
  }
  const home = mkdtempSync(join(tmpdir(), 'horca-state-'))
  const xdgConfig = join(home, 'xdg-config')
  const xdgCache = join(home, 'xdg-cache')
  mkdirSync(xdgConfig)
  mkdirSync(xdgCache)

  const harness = join(home, 'run.mjs')
  writeFileSync(
    harness,
    `
import { homedir } from 'node:os'
import { getWorkspaceFilePath, ensureOrcaDir } from ${JSON.stringify(
      pathToFileURL(resolve(worktree, 'src/main/linear/linear-credential-paths.ts')).href
    )}

ensureOrcaDir()
const home = homedir()
const result = {
  home,
  workspaceFilePath: getWorkspaceFilePath()
}
console.log(JSON.stringify(result))
`
  )

  const run = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', harness],
    {
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: xdgConfig,
        XDG_CACHE_HOME: xdgCache
      },
      encoding: 'utf8'
    }
  )
  if (run.status !== 0) {
    rmSync(home, { recursive: true, force: true })
    throw new Error(`state harness failed: ${run.stderr || run.stdout}`)
  }
  const resolved = JSON.parse(run.stdout)
  const created = spawnSync('find', [home, '-mindepth', '1'], { encoding: 'utf8' })
    .stdout.split('\n')
    .filter(Boolean)
    .filter((p) => p !== harness)
  const orcaNamed = created.filter((p) => p.includes('.orca') || /(?:^|\/)orca(?:\/|$)/i.test(p))
  const horcaNamed = created.filter((p) => p.includes('.horca') || p.includes('/Horca'))

  const ok =
    resolved.workspaceFilePath.startsWith(join(home, '.horca')) &&
    !resolved.workspaceFilePath.includes('.orca') &&
    orcaNamed.length === 0 &&
    horcaNamed.some((p) => p === join(home, '.horca') || p.startsWith(join(home, '.horca')))

  const evidence = {
    resolver: {
      module: 'src/main/linear/linear-credential-paths.ts',
      functions: ['ensureOrcaDir', 'getWorkspaceFilePath']
    },
    env: { HOME: home, XDG_CONFIG_HOME: xdgConfig, XDG_CACHE_HOME: xdgCache },
    resolved,
    createdPaths: created,
    orcaNamedPathsCreated: orcaNamed,
    horcaNamedPathsCreated: horcaNamed,
    pass: ok
  }
  mkdirSync(resolve(ROOT, 'migration/evidence/pre-d'), { recursive: true })
  writeFileSync(
    resolve(ROOT, 'migration/evidence/pre-d/runtime-state-identity.json'),
    `${JSON.stringify(evidence, null, 2)}\n`
  )
  rmSync(home, { recursive: true, force: true })
  if (!ok) {
    console.error(JSON.stringify(evidence, null, 2))
    throw new Error('HORCA_RUNTIME_STATE_IDENTITY_FAILED')
  }
  console.log(JSON.stringify(evidence, null, 2))
}

main()
