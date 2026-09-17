import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

// Proof that Orca has not crept back into the Horca repository.
//
// The class of forbidden paths is derived from the pre-C0 inventory: every path
// that exists in the pinned upstream revision (UPSTREAM_EMBEDDED) must stay
// absent from the Horca tracked tree. Explicit allowances cover the small,
// declared things Horca legitimately owns: the lock file, the license, the
// overlay manifest, migration probes/evidence, and Horca-owned scripts/config.
//
// Usage: node scripts/verify-no-upstream-embedding.mjs

const ROOT = resolve(import.meta.dirname, '..')
const INVENTORY = resolve(ROOT, 'migration/evidence/c0/pre-cutover-inventory.json')

const ALLOWED_EXACT = new Set([
  'upstream.lock.json',
  'LICENSE',
  '.gitignore',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml'
])
const ALLOWED_PREFIXES = ['overlay/', 'scripts/', 'migration/']

function isAllowed(path) {
  if (ALLOWED_EXACT.has(path)) return true
  return ALLOWED_PREFIXES.some((p) => path.startsWith(p))
}

function main() {
  if (!existsSync(INVENTORY)) {
    console.error(`[verify-no-embedding] FAIL: inventory missing at ${INVENTORY}`)
    process.exit(1)
  }
  const inventory = JSON.parse(readFileSync(INVENTORY, 'utf8'))
  const forbidden = new Set(
    inventory.entries.filter((e) => e.classification === 'UPSTREAM_EMBEDDED').map((e) => e.path)
  )

  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

  const violations = []
  for (const path of tracked) {
    if (isAllowed(path)) continue
    if (forbidden.has(path)) violations.push(path)
  }

  // A tracked upstream lockfile/package manifest is a copy of Orca metadata
  // masquerading as Horca metadata, even if the path was not in the inventory.
  for (const path of tracked) {
    if (path === 'package.json' || path === 'pnpm-lock.yaml' || path === 'pnpm-workspace.yaml') continue
    if (/(^|\/)pnpm-lock\.yaml$/.test(path)) {
      // nested lockfiles are allowed only inside migration evidence/probes
      if (!path.startsWith('migration/')) violations.push(`${path} (nested upstream-style lockfile)`)
    }
  }

  if (violations.length > 0) {
    console.error('[verify-no-embedding] FAIL: upstream-owned paths re-embedded in Horca:')
    for (const v of violations.slice(0, 50)) console.error(`  ${v}`)
    if (violations.length > 50) console.error(`  ... and ${violations.length - 50} more`)
    process.exit(1)
  }

  console.log(
    `[verify-no-embedding] PASS: no upstream-owned path re-embedded (${tracked.length} tracked files checked against ${forbidden.size} forbidden upstream paths)`
  )
}

main()
