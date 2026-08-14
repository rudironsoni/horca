#!/usr/bin/env node
// Why: download the pinned stock herdr release for the current host so the
// stock-runtime e2e can run against a real, version-pinned binary instead of
// building from source. Prints the resolved binary path to stdout for
// `ORCA_HERDR_TEST_BINARY=$(node config/scripts/download-herdr-release.mjs)`.
//
// The version/protocol/schema pin lives in config/herdr-version.json and is
// cross-checked against the runtime contract by herdr-version-pin.test.ts.
import { execFileSync } from 'node:child_process'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const HERDR_RELEASE_REPO = 'herdrdev/herdr'

function repoRoot() {
  return join(import.meta.dirname, '..', '..')
}

function loadPin() {
  const raw = readFileSync(join(repoRoot(), 'config', 'herdr-version.json'), 'utf8')
  return JSON.parse(raw)
}

function osNameForHost() {
  const platform = process.platform
  if (platform === 'darwin') {
    return 'macos'
  }
  if (platform === 'linux') {
    return 'linux'
  }
  if (platform === 'win32') {
    return 'windows'
  }
  return null
}

function archNameForHost() {
  const arch = process.arch
  return arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null
}

function assetNameForHost(version) {
  const osName = osNameForHost()
  const archName = archNameForHost()
  if (!osName || !archName) {
    throw new Error(`No herdr ${version} asset for ${process.platform}/${process.arch}`)
  }
  if (osName === 'windows') {
    // Why: stable releases ship no Windows archive; the Windows binary lives in
    // the preview build pinned by config/herdr-version.json#windowsTag.
    return 'herdr-windows-x86_64.zip'
  }
  return `herdr-${osName}-${archName}`
}

async function download(url, destPath) {
  mkdirSync(dirname(destPath), { recursive: true })
  if (existsSync(destPath)) {
    return destPath
  }
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath))
  if (process.platform !== 'win32') {
    chmodSync(destPath, 0o755)
  }
  return destPath
}

// Why: the Windows preview archive bundles herdr.exe with an app-local ConPTY
// runtime. Extract it with the host's built-in tar (bsdtar handles zip on
// Windows 10+ and macOS) so no zip dependency is introduced.
function extractWindowsZip(zipPath, outDir) {
  const herdrExe = join(outDir, 'herdr.exe')
  if (existsSync(herdrExe)) {
    return herdrExe
  }
  mkdirSync(outDir, { recursive: true })
  execFileSync('tar', ['-xf', zipPath, '-C', outDir], { stdio: 'pipe' })
  if (!existsSync(herdrExe)) {
    throw new Error(`Extracted ${zipPath} but did not find herdr.exe`)
  }
  return herdrExe
}

async function main() {
  const pin = loadPin()
  const asset = assetNameForHost(pin.version)
  const cacheRoot =
    process.env.ORCA_HERDR_BINARY_CACHE ?? join(homedir(), '.cache', 'orca', 'herdr')

  if (osNameForHost() === 'windows') {
    if (!pin.windowsTag) {
      throw new Error('config/herdr-version.json is missing windowsTag for the Windows asset')
    }
    const zipPath = join(cacheRoot, pin.windowsTag, asset)
    const url = `https://github.com/${HERDR_RELEASE_REPO}/releases/download/${pin.windowsTag}/${asset}`
    await download(url, zipPath)
    const resolved = extractWindowsZip(zipPath, join(cacheRoot, pin.windowsTag, 'extracted'))
    process.stdout.write(`${resolved}\n`)
    return
  }

  const destPath = join(cacheRoot, pin.version, asset)
  const url = `https://github.com/${HERDR_RELEASE_REPO}/releases/download/v${pin.version}/${asset}`
  const resolved = await download(url, destPath)
  process.stdout.write(`${resolved}\n`)
}

main().catch((error) => {
  console.error(`[herdr-release] ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
