#!/usr/bin/env node
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'

function asarApi() {
  const candidates = [
    resolve(import.meta.dirname, '../../package.json'),
    process.env.WT ? resolve(process.env.WT, 'package.json') : null,
    resolve(process.cwd(), 'package.json')
  ].filter(Boolean)
  let last
  for (const pkg of candidates) {
    try {
      return createRequire(pkg)('@electron/asar')
    } catch (error) {
      last = error
    }
  }
  throw last ?? new Error('Cannot find module @electron/asar')
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

const XTERM_SIGNATURES = [
  'XtermHeadlessEmulator',
  'XtermPaneTerminal',
  'registerXtermPaneState',
  'xterm-headless-emulator',
  'xterm-renderer/'
]

function normalizeAsarEntry(entry) {
  return String(entry).replace(/^\//, '')
}

export function evaluateHorcaAsarContents({ shared, main, renderer, entries = [] }) {
  const bundled = [shared, main, renderer].join('\n')
  const xtermHits = XTERM_SIGNATURES.filter((sig) => bundled.includes(sig))
  const xtermPaths = entries.filter((entry) => {
    const path = normalizeAsarEntry(entry)
    return (
      /xterm/i.test(path) &&
      /headless|addon-serialize|addon-unicode11|addon-fit|addon-search|addon-webgl|addon-ligatures|xterm-renderer|@xterm/.test(
        path
      )
    )
  })
  const checks = [
    ['state root is .horca', bundled.includes('.horca')],
    ['Horca product copy is packaged', /Horca/.test(bundled)],
    [
      'Ghostty renderer path is packaged',
      bundled.includes('libghostty-vt WASM host is not primed') ||
        bundled.includes('GhosttyTerminal is not bound') ||
        bundled.includes('GhosttyPaneTerminal')
    ],
    [
      'Ghostty headless path is packaged',
      bundled.includes('GhosttyHeadlessEmulator') ||
        bundled.includes('HeadlessVtQueryParser') ||
        bundled.includes('ghostty-vt-node-host') ||
        bundled.includes('?61;4c')
    ],
    ['zero xterm runtime signatures', xtermHits.length === 0],
    ['zero xterm asar paths', xtermPaths.length === 0]
  ]
  return {
    checks: checks.map(([label]) => label),
    failures: checks.filter(([, passed]) => !passed).map(([label]) => label),
    xtermHits,
    xtermPaths
  }
}

export function evaluateGhosttyHeadless(main) {
  if (
    main.includes('GhosttyHeadlessEmulator') ||
    main.includes('HeadlessVtQueryParser') ||
    main.includes('ghostty-vt-node-host')
  ) {
    return 'present'
  }
  return 'absent'
}

export function verifyHorcaAsar(asarPath) {
  const entries = asarApi().listPackage(asarPath)
  const shared = readMatchingEntries(
    asarPath,
    (entry) => normalizeAsarEntry(entry).startsWith('out/shared/') && entry.endsWith('.js')
  )
  const main = readMatchingEntries(
    asarPath,
    (entry) => normalizeAsarEntry(entry).startsWith('out/main/') && entry.endsWith('.js')
  )
  const renderer = readMatchingEntries(
    asarPath,
    (entry) => normalizeAsarEntry(entry).startsWith('out/renderer/') && entry.endsWith('.js')
  )
  const { checks, failures, xtermHits, xtermPaths } = evaluateHorcaAsarContents({
    shared,
    main,
    renderer,
    entries
  })
  if (failures.length > 0) {
    const detail = [...xtermHits, ...xtermPaths].join(', ')
    throw new Error(
      `${basename(asarPath)} failed Horca checks: ${failures.join(', ')}${detail ? ` (${detail})` : ''}`
    )
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
