import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const registry = JSON.parse(
  readFileSync(resolve(ROOT, 'config/horca/branding-user-visible.json'), 'utf8')
)

const allow = new Set(
  (registry.allowlist ?? []).flatMap((entry) => {
    const paths = []
    if (entry.path) {
      paths.push(entry.path)
    }
    if (Array.isArray(entry.paths)) {
      paths.push(...entry.paths)
    }
    return paths
  })
)

const out = execSync(
  "git grep -nE '\\bOrca\\b' -- src/renderer/src/horca src/shared/horca src/shared/distribution-product-copy.ts src/shared/horca-product-copy.ts config/horca overlay/d1-r overlay/d0-r overlay/d1-h || true",
  { cwd: ROOT, encoding: 'utf8' }
)

const leaks = []
for (const line of out.split('\n').filter(Boolean)) {
  const file = line.split(':', 1)[0]
  if (allow.has(file)) {
    continue
  }
  if (line.includes("value: 'orca'") || line.includes('value: "orca"')) {
    continue
  }
  if (file.endsWith('.test.ts') || file.endsWith('.test.tsx') || file.endsWith('.test.mjs')) {
    continue
  }
  leaks.push(line)
}

if (leaks.length > 0) {
  console.log('FAIL user-visible Orca:')
  for (const leak of leaks) {
    console.log(`  ${leak}`)
  }
  process.exit(1)
}

console.log('PASS BRANDING_USER_VISIBLE_ORCA=0')
