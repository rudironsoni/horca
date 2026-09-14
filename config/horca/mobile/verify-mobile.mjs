#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const mobileRoot = resolve(repoRoot, 'mobile')
const packageJson = JSON.parse(readFileSync(resolve(mobileRoot, 'package.json'), 'utf8'))
const appJson = JSON.parse(readFileSync(resolve(mobileRoot, 'app.json'), 'utf8'))
const expoConfig = appJson.expo

if (packageJson.name !== 'horca-mobile') {
  throw new Error('Horca mobile package name is incorrect')
}
if (packageJson.dependencies?.['expo-libghostty'] == null) {
  throw new Error('Horca mobile must depend on expo-libghostty')
}
if (packageJson.dependencies?.['@orca/libghostty-terminal'] != null) {
  throw new Error('Horca mobile must not alias expo-libghostty as @orca/libghostty-terminal')
}
if (
  expoConfig?.name !== 'Horca' ||
  expoConfig?.slug !== 'horca-mobile' ||
  expoConfig?.scheme !== 'horca' ||
  expoConfig?.ios?.bundleIdentifier !== 'com.rudironsoni.horca.mobile' ||
  expoConfig?.android?.package !== 'com.rudironsoni.horca.mobile'
) {
  throw new Error('Horca mobile app identity is incorrect')
}
if (!expoConfig.plugins?.includes('./plugins/ios-scene-lifecycle.js')) {
  throw new Error('Horca mobile does not enable the iOS scene lifecycle')
}
if (!existsSync(resolve(mobileRoot, 'plugins/ios-scene-lifecycle.js'))) {
  throw new Error('Missing iOS scene lifecycle plugin')
}
const googleServices = JSON.parse(readFileSync(resolve(mobileRoot, 'google-services.json'), 'utf8'))
const googleServicesPackages = (googleServices.client ?? []).map(
  (client) => client?.client_info?.android_client_info?.package_name
)
if (!googleServicesPackages.includes(expoConfig.android.package)) {
  throw new Error(`google-services.json has no client for ${expoConfig.android.package}`)
}
const releaseAppfile = readFileSync(resolve(mobileRoot, 'fastlane/Appfile'), 'utf8')
const releaseFastfile = readFileSync(resolve(mobileRoot, 'fastlane/Fastfile'), 'utf8')
if (
  !releaseAppfile.includes('com.rudironsoni.horca.mobile') ||
  !releaseFastfile.includes('Horca.xcworkspace') ||
  !releaseFastfile.includes('BUNDLE_ID = "com.rudironsoni.horca.mobile"')
) {
  throw new Error('Horca mobile release identity is incorrect')
}

console.log('Horca mobile identity verified')
