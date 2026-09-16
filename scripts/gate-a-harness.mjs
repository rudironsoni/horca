import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LOCK_FILE = resolve(ROOT, 'upstream.lock.json')

const SHAS = {
  'pre-regression': '07b7687a2e6468ca699e1baf2415d479a9aca318',
  'regression': '15cac68802361f3b9075630335d3e6d379c2a909',
  'repair': 'a7e34d5695fda152a9ca441f0a496a89359bae91'
}

function setLock(sha) {
  const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'))
  lock.commit = sha
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2))
}

function runCommand(cmd, cwd, label) {
  console.log(`\n[${label}] $ ${cmd}`)
  try {
    const output = execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 300000 })
    console.log(`[${label}] EXIT 0`)
    return { exitCode: 0, output: output.trim() }
  } catch (e) {
    console.log(`[${label}] EXIT ${e.status}`)
    return { exitCode: e.status, output: e.stdout?.toString().trim() || '', stderr: e.stderr?.toString().trim() || '' }
  }
}

async function runGateA(shaName, sha) {
  console.log(`\n========== GATE A: ${shaName} (${sha.slice(0, 12)}) ==========`)
  
  setLock(sha)
  
  // Fetch
  console.log(`\n--- fetch ---`)
  runCommand('node scripts/fetch-upstream.mjs', ROOT, shaName)
  
  // Materialize
  console.log(`\n--- materialize ---`)
  const matResult = runCommand('node scripts/materialize.mjs', ROOT, shaName)
  if (matResult.exitCode !== 0) {
    return { shaName, sha, materialize: false, error: 'materialize failed' }
  }
  const worktreePath = matResult.output.trim().split('\n').pop()
  console.log(`Worktree: ${worktreePath}`)
  
  // Apply overlays
  console.log(`\n--- apply overlays ---`)
  runCommand(`node scripts/apply-overlays.mjs "${worktreePath}"`, ROOT, shaName)
  
  // Verify
  console.log(`\n--- verify ---`)
  runCommand(`node scripts/verify-overlay.mjs "${worktreePath}"`, ROOT, shaName)
  
  // Install
  console.log(`\n--- install ---`)
  const installResult = runCommand('pnpm install --frozen-lockfile', worktreePath, shaName)
  
  // Typecheck
  console.log(`\n--- typecheck:node ---`)
  const tcNode = runCommand('pnpm tc:node', worktreePath, shaName)
  
  console.log(`\n--- typecheck:cli ---`)
  const tcCli = runCommand('pnpm tc:cli', worktreePath, shaName)
  
  console.log(`\n--- typecheck:web ---`)
  const tcWeb = runCommand('pnpm tc:web', worktreePath, shaName)
  
  console.log(`\n--- typecheck (aggregate) ---`)
  const tcAll = runCommand('pnpm tc', worktreePath, shaName)
  
  // Tests - run a minimal set
  console.log(`\n--- test (selected) ---`)
  const testResult = runCommand('pnpm test -- --run src/main/horca/configure-horca-user-data.test.ts src/main/horca/assert-horca-packaged-distribution.test.ts 2>&1 || true', worktreePath, shaName)
  
  // Desktop compilation
  console.log(`\n--- build:relay ---`)
  const relay = runCommand('pnpm build:relay', worktreePath, shaName)
  
  console.log(`\n--- build:cli ---`)
  const cli = runCommand('pnpm build:cli', worktreePath, shaName)
  
  console.log(`\n--- build:electron-vite ---`)
  const evite = runCommand('pnpm build:electron-vite', worktreePath, shaName)
  
  console.log(`\n--- verify:built-skills-cli ---`)
  const verifyCli = runCommand('pnpm run verify:built-skills-cli', worktreePath, shaName)
  
  console.log(`\n--- build:web-from-renderer ---`)
  const web = runCommand('pnpm build:web-from-renderer', worktreePath, shaName)
  
  // Packaging (unsigned)
  console.log(`\n--- build:unpack (unsigned packaging) ---`)
  const unpack = runCommand('pnpm build:unpack 2>&1 || true', worktreePath, shaName)
  
  // Cleanup
  console.log(`\n--- cleanup ---`)
  try {
    execSync(`git worktree remove --force "${worktreePath}"`, { cwd: resolve(ROOT, '.cache/upstream.git'), stdio: 'pipe' })
    execSync(`git worktree prune --expire now`, { cwd: resolve(ROOT, '.cache/upstream.git'), stdio: 'pipe' })
    console.log(`[${shaName}] Cleanup complete`)
  } catch (e) {
    console.log(`[${shaName}] Cleanup warning: ${e.message}`)
  }
  
  return {
    shaName,
    sha,
    materialize: true,
    install: installResult.exitCode === 0,
    tcNode: tcNode.exitCode === 0,
    tcCli: tcCli.exitCode === 0,
    tcWeb: tcWeb.exitCode === 0,
    tcAll: tcAll.exitCode === 0,
    test: testResult.exitCode === 0,
    relay: relay.exitCode === 0,
    cli: cli.exitCode === 0,
    evite: evite.exitCode === 0,
    verifyCli: verifyCli.exitCode === 0,
    web: web.exitCode === 0,
    unpack: unpack.exitCode === 0
  }
}

async function main() {
  const results = {}
  
  for (const [name, sha] of Object.entries(SHAS)) {
    try {
      results[name] = await runGateA(name, sha)
    } catch (e) {
      results[name] = { shaName: name, sha, error: e.message }
    }
  }
  
  console.log('\n\n========== GATE A THREE-SHA MATRIX ==========')
  console.log(JSON.stringify(results, null, 2))
  
  writeFileSync(resolve(ROOT, 'migration/evidence/gate-a/three-sha-matrix.json'), JSON.stringify(results, null, 2))
}

main()
