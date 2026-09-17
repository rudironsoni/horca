import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const SCHEMA = 'schema-4'
const RULES_FILE = resolve(ROOT, 'config/horca/production-inputs.json')

function sha12(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

function sha16(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

function loadRules() {
  return JSON.parse(readFileSync(RULES_FILE, 'utf8'))
}

function classify(relPath, rules) {
  if (rules.independentFiles.includes(relPath)) return 'independent'
  if (rules.nonProductionFiles.includes(relPath)) return 'non-production'
  if (rules.nonProductionPrefixes.some((p) => relPath.startsWith(p))) return 'non-production'
  if (rules.nonProductionSuffixes.some((s) => relPath.endsWith(s))) return 'non-production'
  if (rules.nonProductionPathParts.some((p) => relPath.includes(p))) return 'non-production'
  if (rules.productionFiles.includes(relPath)) return 'production'
  if (rules.productionPrefixes.some((p) => relPath.startsWith(p))) return 'production'
  return 'unclassified'
}

function listTrackedFiles(root) {
  return execSync('git ls-files -z', { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
}

export function computeProductionSourceDigest(root = ROOT) {
  const rules = loadRules()
  const tracked = listTrackedFiles(root)
  const unclassified = []
  const production = []
  for (const relPath of tracked) {
    const kind = classify(relPath, rules)
    if (kind === 'unclassified') unclassified.push(relPath)
    else if (kind === 'production') production.push(relPath)
  }
  if (unclassified.length > 0) {
    throw new Error(
      `HORCA_BUILD_IDENTITY_UNCLASSIFIED: ${unclassified.join(', ')}`
    )
  }
  production.sort()
  const h = createHash('sha256')
  for (const relPath of production) {
    h.update(relPath)
    h.update('\0')
    h.update(readFileSync(resolve(root, relPath)))
    h.update('\n')
  }
  return sha12(h.digest())
}

export function computeOverlayDigest(root = ROOT) {
  const manifest = process.env.HORCA_OVERLAY_MANIFEST
    ? resolve(process.env.HORCA_OVERLAY_MANIFEST)
    : resolve(root, 'overlay', 'manifest.json')
  return sha12(readFileSync(manifest))
}

export function computeHorcaDependencyLockDigest(root = ROOT) {
  const depLock = process.env.HORCA_DEPENDENCY_LOCK
    ? resolve(process.env.HORCA_DEPENDENCY_LOCK)
    : resolve(root, 'pnpm-lock.yaml')
  if (!existsSync(depLock)) return 'none'
  return sha12(readFileSync(depLock))
}

export function computeProductDigest(root = ROOT) {
  const productFile = process.env.HORCA_PRODUCT_JSON
    ? resolve(process.env.HORCA_PRODUCT_JSON)
    : resolve(root, 'product.json')
  if (!existsSync(productFile)) return 'none'
  return sha12(readFileSync(productFile))
}

export function computeBuildIdentityRecord(root = ROOT) {
  const lockFile = resolve(root, 'upstream.lock.json')
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'))
  const upstreamSha = lock.commit
  if (!upstreamSha || upstreamSha.length !== 40) {
    throw new Error(`Invalid commit in upstream.lock.json: ${upstreamSha}`)
  }
  const overlayDigest = computeOverlayDigest(root)
  const depLockDigest = computeHorcaDependencyLockDigest(root)
  const productDigest = computeProductDigest(root)
  const productionDigest = computeProductionSourceDigest(root)
  const buildIdentity = sha16(
    [upstreamSha.slice(0, 12), overlayDigest, SCHEMA, depLockDigest, productDigest, productionDigest].join('+')
  )
  return {
    schema: SCHEMA,
    upstreamSha,
    overlayDigest,
    depLockDigest,
    productDigest,
    productionDigest,
    buildIdentity
  }
}

function prove() {
  const before = computeBuildIdentityRecord()
  const ghostty = resolve(ROOT, 'src/ghostty-vt/revision.ts')
  const original = readFileSync(ghostty, 'utf8')
  writeFileSync(ghostty, original.replace('wasm32-freestanding', 'wasm32-freestanding '))
  const afterSource = computeBuildIdentityRecord()
  writeFileSync(ghostty, original)
  const restored = computeBuildIdentityRecord()

  const evidence = resolve(ROOT, 'migration/evidence/pre-d/_probe-must-not-hash.json')
  mkdirSync(resolve(ROOT, 'migration/evidence/pre-d'), { recursive: true })
  writeFileSync(evidence, JSON.stringify({ probe: Date.now() }))
  const afterEvidence = computeBuildIdentityRecord()
  rmSync(evidence, { force: true })

  const product = resolve(ROOT, 'product.json')
  const productOrig = readFileSync(product, 'utf8')
  const productJson = JSON.parse(productOrig)
  productJson.name = `${productJson.name}X`
  writeFileSync(product, `${JSON.stringify(productJson, null, 2)}\n`)
  const afterProduct = computeBuildIdentityRecord()
  writeFileSync(product, productOrig)

  const lockFile = resolve(ROOT, 'pnpm-lock.yaml')
  const lockOrig = readFileSync(lockFile)
  writeFileSync(lockFile, Buffer.concat([lockOrig, Buffer.from('\n')]))
  const afterLock = computeBuildIdentityRecord()
  writeFileSync(lockFile, lockOrig)

  const cwdIdentity = computeBuildIdentityRecord(process.cwd())
  const absIdentity = computeBuildIdentityRecord(ROOT)

  const report = {
    before: before.buildIdentity,
    changeProductionSource: afterSource.buildIdentity,
    restoreProductionSource: restored.buildIdentity,
    changeMigrationEvidence: afterEvidence.buildIdentity,
    changeProductJson: afterProduct.buildIdentity,
    changeDependencyLock: afterLock.buildIdentity,
    cwdEqualsRoot: cwdIdentity.buildIdentity === absIdentity.buildIdentity,
    sourceChanged: before.buildIdentity !== afterSource.buildIdentity,
    sourceRestored: before.buildIdentity === restored.buildIdentity,
    evidenceUnchanged: before.buildIdentity === afterEvidence.buildIdentity,
    productChanged: before.buildIdentity !== afterProduct.buildIdentity,
    lockChanged: before.buildIdentity !== afterLock.buildIdentity,
    record: before
  }
  const failed = !(
    report.sourceChanged &&
    report.sourceRestored &&
    report.evidenceUnchanged &&
    report.productChanged &&
    report.lockChanged &&
    report.cwdEqualsRoot
  )
  if (failed) {
    console.error(JSON.stringify(report, null, 2))
    throw new Error('HORCA_BUILD_IDENTITY_PROVE_FAILED')
  }
  return report
}

function main() {
  const proveFlag = process.argv.includes('--prove')
  if (proveFlag) {
    const report = prove()
    console.log(JSON.stringify(report, null, 2))
    return
  }
  console.log(JSON.stringify(computeBuildIdentityRecord(), null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
