import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  evaluateGhosttyHeadless,
  evaluateHorcaAsarContents,
  verifyHorcaResources
} from '../horca/verify-packaged-distribution.mjs'

const roots = []

test.afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const passing = {
  shared: "stateRootDirName: '.horca'\nproductName: 'Horca'",
  main: "join(homedir(), '.horca')\nGhosttyHeadlessEmulator\nHeadlessVtQueryParser",
  renderer: 'GhosttyTerminal is not bound\nHorca'
}

test('accepts Horca identity and Ghostty renderer markers', () => {
  assert.deepEqual(evaluateHorcaAsarContents(passing).failures, [])
})

test('rejects a package without Ghostty renderer markers', () => {
  assert.deepEqual(
    evaluateHorcaAsarContents({
      ...passing,
      renderer: 'Horca'
    }).failures,
    ['Ghostty renderer path is packaged']
  )
})

test('rejects a package that still owns .orca state', () => {
  assert.ok(
    evaluateHorcaAsarContents({
      shared: "stateRootDirName: '.orca'",
      main: 'Orca',
      renderer: 'GhosttyTerminal is not bound'
    }).failures.includes('state root is .horca')
  )
})

test('requires Ghostty headless after FINAL_D1', () => {
  assert.equal(evaluateGhosttyHeadless('HeadlessEmulator from xterm'), 'absent')
  assert.equal(evaluateGhosttyHeadless('class GhosttyHeadlessEmulator {}'), 'present')
  assert.deepEqual(
    evaluateHorcaAsarContents({
      ...passing,
      main: "join(homedir(), '.horca')"
    }).failures,
    ['Ghostty headless path is packaged']
  )
})

test('rejects packaged xterm renderer or headless signatures', () => {
  assert.deepEqual(
    evaluateHorcaAsarContents({
      ...passing,
      main: `${passing.main}\nXtermHeadlessEmulator`
    }).failures,
    ['zero xterm runtime signatures']
  )
})

test('requires the public Horca CLI and rejects Herdr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
  roots.push(root)
  await mkdir(join(root, 'bin'), { recursive: true })
  await writeFile(join(root, 'bin', 'horca'), '')

  assert.deepEqual(verifyHorcaResources(join(root, 'app.asar')), [
    'public Horca CLI is packaged',
    'Herdr is not packaged'
  ])
})

test('rejects a package without the Horca CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
  roots.push(root)
  assert.throws(() => verifyHorcaResources(join(root, 'app.asar')), /public Horca CLI is packaged/)
})

test('rejects a package that still bundles Herdr', async () => {
  const root = await mkdtemp(join(tmpdir(), 'horca-package-'))
  roots.push(root)
  await mkdir(join(root, 'bin'), { recursive: true })
  await mkdir(join(root, 'herdr'), { recursive: true })
  await writeFile(join(root, 'bin', 'horca'), '')
  await writeFile(join(root, 'herdr', 'herdr'), '')
  assert.throws(() => verifyHorcaResources(join(root, 'app.asar')), /Herdr is not packaged/)
})
