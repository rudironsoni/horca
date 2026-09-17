import { readFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Gate C product identity verifier.
//
// Derives every expectation from the canonical `product.json` contract and
// validates the generated/package outputs plus Horca-owned tracked files.
// Scoped deliberately: migration evidence may quote historical Orca values and
// the immutable upstream materialization may contain Orca internals.
//
// Usage:
//   node scripts/verify-product-identity.mjs [--app <path-to-.app>]

const require = createRequire(import.meta.url)
const ROOT = resolve(import.meta.dirname, '..')

const args = process.argv.slice(2)
let appPath
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--app') appPath = args[i + 1]
}

const failures = []
function check(label, condition, detail = '') {
  if (condition) console.log(`  PASS  ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail ? ` (${detail})` : ''}`)
    failures.push(label)
  }
}

// --- 1. Canonical contract -------------------------------------------------
const product = JSON.parse(readFileSync(resolve(ROOT, 'product.json'), 'utf8'))
const required = ['name', 'packageName', 'appId', 'protocol', 'cli', 'stateDirectory', 'linuxExecutable']
check('product.json parses', true)
for (const key of required) check(`product.json has ${key}`, typeof product[key] === 'string' && product[key].length > 0)

// --- 2. Identity module agrees with the contract ---------------------------
const identity = require(resolve(ROOT, 'config/horca/product-identity.cjs'))
check('identity module name matches product.json', identity.name === product.name)
check('identity module appId matches product.json', identity.appId === product.appId)
check('identity module protocol matches product.json', identity.protocol === product.protocol)
check('identity module cli matches product.json', identity.cli === product.cli)
check('identity module stateDirectory matches product.json', identity.stateDirectory === product.stateDirectory)

// --- 3. Overlay does not hardcode public identity --------------------------
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'overlay/manifest.json'), 'utf8'))
const hardcoded = []
for (const o of manifest.overrides) {
  const payload = `${o.find ?? ''}${o.replace ?? ''}`
  for (const lit of ['com.stablyai.orca', "productName: 'Orca'", 'schemes: [\'orca\']']) {
    if (o.mode === 'substitute' && (o.replace ?? '').includes(lit)) hardcoded.push(`${o.id}:${lit}`)
  }
}
check('overlay output does not hardcode public identity', hardcoded.length === 0, hardcoded.join(', '))

// --- 4. Packaged application metadata --------------------------------------
if (appPath) {
  const plist = resolve(appPath, 'Contents', 'Info.plist')
  if (!existsSync(plist)) {
    check('packaged Info.plist exists', false, plist)
  } else {
    const json = execSync(`plutil -convert json -o - ${JSON.stringify(plist)}`, { encoding: 'utf8' })
    const p = JSON.parse(json)
    check('CFBundleIdentifier matches appId', p.CFBundleIdentifier === product.appId, p.CFBundleIdentifier)
    check('CFBundleName matches name', p.CFBundleName === product.name, p.CFBundleName)
    check('CFBundleDisplayName matches name', !p.CFBundleDisplayName || p.CFBundleDisplayName === product.name, p.CFBundleDisplayName)
    check('CFBundleExecutable matches name', p.CFBundleExecutable === product.name, p.CFBundleExecutable)
    const schemes = (p.CFBundleURLTypes ?? []).flatMap((d) => d.CFBundleURLSchemes ?? [])
    check('registered URL scheme matches protocol', schemes.includes(product.protocol) && !schemes.includes('orca'), JSON.stringify(schemes))
    check('app bundle directory is Horca.app', appPath.endsWith(`${product.name}.app`), appPath)
  }
}

// --- 5. Horca-owned tracked files ------------------------------------------
const registry = JSON.parse(readFileSync(resolve(ROOT, 'config/horca/identity-dispositions.json'), 'utf8'))
const patterns = registry.patterns
let matches = []
try {
  const out = execSync(
    `git grep -lE ${JSON.stringify(patterns.join('|'))} -- . ${"':!migration'"} ${"':!LICENSE'"} ${"':!package.json'"}`,
    { cwd: ROOT, encoding: 'utf8' }
  )
  matches = out.split('\n').filter(Boolean)
} catch {
  matches = []
}
const undeclared = matches.filter((f) => !(f in registry.dispositions))
check('no unexplained identity literal in Horca-owned files', undeclared.length === 0, undeclared.join(', '))

console.log(`\n[verify-product-identity] ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`}`)
process.exit(failures.length === 0 ? 0 : 1)
