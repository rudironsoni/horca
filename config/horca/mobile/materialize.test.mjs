import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { deletedPathsFromPatch } from './ghostty-port-patch.mjs'
import {
  HORCA_MOBILE_ANDROID_PACKAGE,
  retargetGoogleServicesPackage
} from './retarget-google-services-package.mjs'

const dir = import.meta.dirname
const patch = readFileSync(resolve(dir, 'ghostty-port.patch'), 'utf8')
const lockfile = resolve(dir, 'pnpm-lock.yaml')

test('does not git-apply the Horca mobile lockfile against upstream', () => {
  assert.equal(patch.includes('diff --git a/mobile/pnpm-lock.yaml b/mobile/pnpm-lock.yaml'), false)
  assert.equal(existsSync(lockfile), true)
  const lockfileText = readFileSync(lockfile, 'utf8')
  assert.match(lockfileText, /react-native@0\.86\.3/)
  assert.match(lockfileText, /expo@57\.0\.18/)
  assert.equal(lockfileText.includes('@xmldom/xmldom@0.8.13'), false)
  assert.equal(lockfileText.includes('@xmldom/xmldom@0.9.10'), false)
  const packageJson = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'))
  assert.equal(packageJson.name, 'horca-mobile')
  assert.equal(
    packageJson.dependencies['@orca/libghostty-terminal'],
    'file:./packages/libghostty-terminal'
  )
})

test('rewrites google-services android package_name to Horca', () => {
  const source = readFileSync(
    resolve(dir, '..', '..', '..', 'mobile', 'google-services.json'),
    'utf8'
  )
  assert.equal(
    JSON.parse(source).client[0].client_info.android_client_info.package_name,
    'com.stably.orca.mobile'
  )
  const tempDir = mkdtempSync(join(tmpdir(), 'horca-google-services-'))
  const filePath = join(tempDir, 'google-services.json')
  writeFileSync(filePath, source)
  const packages = retargetGoogleServicesPackage(filePath)
  assert.deepEqual(packages, [HORCA_MOBILE_ANDROID_PACKAGE])
  const rewritten = JSON.parse(readFileSync(filePath, 'utf8'))
  assert.equal(
    rewritten.client[0].client_info.android_client_info.package_name,
    HORCA_MOBILE_ANDROID_PACKAGE
  )
  assert.equal(JSON.stringify(rewritten).includes('com.stably.orca.mobile'), false)
})

test('rejects google-services files with no android client', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'horca-google-services-'))
  const filePath = join(tempDir, 'google-services.json')
  writeFileSync(filePath, JSON.stringify({ project_info: {}, client: [] }))
  assert.throws(
    () => retargetGoogleServicesPackage(filePath),
    /No android client package_name found/
  )
})

test('treats Ghostty WebView removals as path deletes, not content hunks', () => {
  const deleted = new Set(deletedPathsFromPatch(patch))
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-theme-injected.ts'), true)
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-theme-injected.test.ts'), true)
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-payload-hash.test.ts'), true)
  assert.equal(deleted.has('mobile/pnpm-lock.yaml'), false)
})
