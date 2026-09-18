#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'

function asarApi() {
  const require = createRequire(resolve(process.cwd(), 'package.json'))
  return require('@electron/asar')
}

function findAppAsars(directory) {
  const matches = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      matches.push(...findAppAsars(path))
    } else if (entry.isFile() && entry.name === 'app.asar') {
      matches.push(path)
    }
  }
  return matches
}

function readEntry(asarPath, entry) {
  return asarApi()
    .extractFile(asarPath, entry.replace(/^\//, ''))
    .toString('utf8')
}

function readMatchingEntries(asarPath, predicate) {
  return asarApi()
    .listPackage(asarPath)
    .filter(predicate)
    .map((entry) => readEntry(asarPath, entry))
    .join('\n')
}

export function evaluateHorcaAsarContents({ shared, main, renderer }) {
  const bundled = [shared, main, renderer].join('\n')
  const checks = [
    ['state root is .horca', bundled.includes('.horca')],
    ['Horca product copy is packaged', /Horca/.test(bundled)],
    [
      'Ghostty renderer path is packaged',
      bundled.includes('libghostty-vt WASM host is not primed') ||
        bundled.includes('GhosttyTerminal is not bound') ||
        bundled.includes('GhosttyPaneTerminal')
    ]
  ]
  return {
    checks: checks.map(([label]) => label),
    failures: checks.filter(([, passed]) => !passed).map(([label]) => label)
  }
}

export function evaluateGhosttyHeadless(main) {
  if (
    main.includes('ghostty-vt-node-host') ||
    main.includes('GhosttyVtNodeHost') ||
    main.includes('headless-vt-query-parser')
  ) {
    return 'present'
  }
  return 'absent'
}

export function verifyHorcaAsar(asarPath) {
  const shared = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/shared/') && entry.endsWith('.js')
  )
  const main = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/main/') && entry.endsWith('.js')
  )
  const renderer = readMatchingEntries(
    asarPath,
    (entry) => entry.startsWith('/out/renderer/') && entry.endsWith('.js')
  )
  const { checks, failures } = evaluateHorcaAsarContents({ shared, main, renderer })
  if (failures.length > 0) {
    throw new Error(`${basename(asarPath)} failed Horca checks: ${failures.join(', ')}`)
  }
  const headless = evaluateGhosttyHeadless(main)
  if (headless === 'present') {
    checks.push('Ghostty headless path is packaged')
  }
  return checks
}

export function verifyHorcaResources(asarPath) {
  const resourcesDir = dirname(asarPath)
  const cliNames = ['horca', 'horca.cmd', 'horca.exe']
  const hasCli = cliNames.some((name) => existsSync(join(resourcesDir, 'bin', name)))
  const herdrDirectory = join(resourcesDir, 'herdr')
  const checks = [
    ['public Horca CLI is packaged', hasCli],
    ['Herdr is not packaged', !existsSync(herdrDirectory)]
  ]
  const failures = checks.filter(([, passed]) => !passed).map(([label]) => label)
  if (failures.length > 0) {
    throw new Error(`${basename(asarPath)} failed Horca resource checks: ${failures.join(', ')}`)
  }
  return checks.map(([label]) => label)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const distributionDirectory = resolve(process.argv[2] ?? 'dist')
  if (!existsSync(distributionDirectory)) {
    throw new Error(`Distribution directory does not exist: ${distributionDirectory}`)
  }
  const asars = findAppAsars(distributionDirectory)
  if (asars.length === 0) {
    throw new Error(`No app.asar found under ${distributionDirectory}`)
  }
  for (const asarPath of asars) {
    const checks = [...verifyHorcaAsar(asarPath), ...verifyHorcaResources(asarPath)]
    console.log(`Verified ${asarPath}: ${checks.join(', ')}`)
  }
}
