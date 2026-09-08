import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { deletedPathsFromPatch } from './ghostty-port-patch.mjs'

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
})

test('treats Ghostty WebView removals as path deletes, not content hunks', () => {
  const deleted = new Set(deletedPathsFromPatch(patch))
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-theme-injected.ts'), true)
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-theme-injected.test.ts'), true)
  assert.equal(deleted.has('mobile/src/terminal/terminal-webview-payload-hash.test.ts'), true)
  assert.equal(deleted.has('mobile/pnpm-lock.yaml'), false)
})
