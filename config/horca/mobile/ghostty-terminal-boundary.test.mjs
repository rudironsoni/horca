import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const mobileRoot = resolve(repoRoot, 'mobile')

const terminalPane = readFileSync(
  resolve(mobileRoot, 'src', 'session', 'TerminalPaneView.tsx'),
  'utf8'
)
const terminalView = readFileSync(
  resolve(mobileRoot, 'src', 'terminal', 'TerminalWebView.tsx'),
  'utf8'
)
const surfaceProps = readFileSync(
  resolve(mobileRoot, 'src', 'terminal', 'expo-libghostty-surface-props.ts'),
  'utf8'
)
const sessionResize = readFileSync(
  resolve(mobileRoot, 'src', 'session', 'use-mobile-session-terminal-webview.ts'),
  'utf8'
)
const packageJson = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'))

test('consumes expo-libghostty as the native terminal view', () => {
  assert.equal(typeof packageJson.dependencies?.['expo-libghostty'], 'string')
  assert.match(terminalView, /from 'expo-libghostty'/)
  assert.doesNotMatch(terminalView, /@orca\/libghostty-terminal/)
})

test('hides inactive Ghostty panes without opacity', () => {
  assert.match(terminalPane, /surfaceVisible=\{active\}/)
  assert.doesNotMatch(terminalPane, /opacity:\s*0/)
})

test('uses a mobile-sized default terminal font', () => {
  assert.match(terminalView, /fontSize=\{8 \* textScale\}/)
  assert.doesNotMatch(terminalView, /fontSize=\{(?:10|14) \* textScale\}/)
})

test('disables the native software keyboard so the RN accessory owns IME', () => {
  assert.match(surfaceProps, /keyboardEnabled: false/)
  assert.match(terminalView, /expoLibghosttySurfaceProps\(surfaceVisible\)/)
})

test('never paints terminal cells with a React Native Canvas', () => {
  assert.doesNotMatch(terminalView, /from 'react-native'/)
  assert.doesNotMatch(terminalPane, /from 'react-native-canvas'/)
  assert.match(terminalView, /ExpoLibghosttyPaneView/)
})

test('updates the live subscriber before falling back to snapshot replay', () => {
  const resizeStart = sessionResize.indexOf('const handleTerminalNativeResize = useCallback(')
  const resizeEnd = sessionResize.indexOf('\n\n  useEffect(', resizeStart)
  const resizeImplementation = sessionResize.slice(resizeStart, resizeEnd)
  const requestIndex = resizeImplementation.indexOf('.request(client, handle, deviceToken')
  const cacheIndex = resizeImplementation.indexOf(
    'client.updateTerminalSubscriptionViewport(handle, { cols, rows })'
  )
  const fallbackIndex = resizeImplementation.indexOf('unsubscribeTerminal(handle)')

  assert.notEqual(resizeStart, -1)
  assert.notEqual(resizeEnd, -1)
  assert.notEqual(requestIndex, -1)
  assert.ok(cacheIndex > requestIndex)
  assert.ok(fallbackIndex > cacheIndex)
})
