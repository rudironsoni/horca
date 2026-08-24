import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const distributionIdentities = require('../../src/shared/distribution-identity.json')

const MUTABLE_BUILD_ENV = [
  'ORCA_DOWNSTREAM_BUILD',
  'ORCA_MAC_HOURLY',
  'ORCA_MAC_DAILY',
  'ORCA_MAC_ADHOC',
  'ORCA_MAC_RELEASE',
  'ORCA_WIN_HOURLY',
  'ORCA_WIN_DAILY',
  'ORCA_WIN_ADHOC',
  'ORCA_HOURLY_BUILD_VERSION',
  'ORCA_DAILY_BUILD_VERSION',
  'ORCA_ADHOC_BUILD_VERSION',
  'ORCA_LOCAL_BUILD_VERSION'
]

/** Re-requires the config under a temporary env, then restores env and module cache. */
function withEnv(env, assert) {
  const configPath = require.resolve('../electron-builder.config.cjs')
  const original = Object.fromEntries(MUTABLE_BUILD_ENV.map((key) => [key, process.env[key]]))
  try {
    for (const key of MUTABLE_BUILD_ENV) {
      delete process.env[key]
    }
    Object.assign(process.env, env)
    delete require.cache[configPath]
    assert(require('../electron-builder.config.cjs'))
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
    delete require.cache[configPath]
    require('../electron-builder.config.cjs')
  }
}

const withOfficialEnv = (assert) => withEnv({}, assert)
const withDownstreamEnv = (extraEnv, assert) =>
  typeof extraEnv === 'function'
    ? withEnv({ ORCA_DOWNSTREAM_BUILD: '1' }, extraEnv)
    : withEnv({ ORCA_DOWNSTREAM_BUILD: '1', ...extraEnv }, assert)

describe('electron-builder downstream distribution config', () => {
  // Why: when ORCA_DOWNSTREAM_BUILD is absent the generated configuration must
  // stay the official one — identifiers, protocol, publish destination, and
  // Windows publisher identity all unchanged.
  it('produces the official configuration when the downstream flag is absent', () => {
    withOfficialEnv((config) => {
      expect(config.appId).toBe('com.stablyai.orca')
      expect(config.productName).toBe('Orca')
      expect(config.protocols).toEqual([{ name: 'Orca', schemes: ['orca'] }])
      expect(config.win.executableName).toBe('Orca')
      expect(config.win.signtoolOptions).toEqual({ publisherName: 'SignPath Foundation' })
      expect(config.nsis.artifactName).toBe('orca-windows-setup.${ext}')
      expect(config.nsis.include.endsWith('daemon-host-uninstall.nsh')).toBe(true)
      expect(config.dmg.artifactName).toBe('orca-macos-${arch}.${ext}')
      expect(config.publish).toMatchObject({ owner: 'stablyai', repo: 'orca' })
      expect(JSON.stringify(config.mac.extraResources)).toContain('"to":"bin/orca"')
      expect(JSON.stringify(config.win.extraResources)).toContain('"to":"bin/orca.cmd"')
      expect(JSON.stringify(config.win.extraResources)).toContain('"to":"bin/orca.exe"')
    })
  })

  it('applies the downstream identity to macOS and Windows packaging', () => {
    withDownstreamEnv((config) => {
      expect(config.appId).toBe('com.rudironsoni.horca')
      expect(config.productName).toBe('Horca')
      expect(config.protocols).toEqual([{ name: 'Horca', schemes: ['horca'] }])
      expect(config.win.executableName).toBe('Horca')
      expect(config.nsis.artifactName).toBe('horca-windows-x64-setup.${ext}')
      expect(config.dmg.artifactName).toBe('horca-macos-${arch}.${ext}')
      expect(JSON.stringify(config.mac.extraResources)).toContain('"to":"bin/horca"')
      expect(JSON.stringify(config.win.extraResources)).toContain('"to":"bin/horca.cmd"')
      expect(JSON.stringify(config.win.extraResources)).toContain('"to":"bin/horca.exe"')
    })
  })

  // Why: downstream artifacts must never claim official Stably identity or
  // reach official Stably release destinations, even if a caller forgets
  // --publish never.
  it('drops the official publisher identity and disables publishing downstream', () => {
    withDownstreamEnv((config) => {
      expect(config.publish).toBeNull()
      expect(config.win.verifyUpdateCodeSignature).toBe(false)
      expect(JSON.stringify(config.win)).not.toContain('SignPath')
    })
  })

  // Why: official ORCA_MAC_RELEASE builds take their version from package.json
  // (release-cut owns it) and must keep discarding ORCA_LOCAL_BUILD_VERSION,
  // while downstream releases are versioned <upstream-core>-horca.<N> via
  // that same variable.
  it('honors ORCA_LOCAL_BUILD_VERSION for downstream release builds only', () => {
    withDownstreamEnv(
      { ORCA_MAC_RELEASE: '1', ORCA_LOCAL_BUILD_VERSION: '1.4.178-horca.1' },
      (config) => {
        expect(config.extraMetadata).toEqual({ version: '1.4.178-horca.1' })
        expect(config.mac.hardenedRuntime).toBe(true)
        expect(config.mac.notarize).toBe(true)
        expect(config.forceCodeSigning).toBe(true)
      }
    )
    withEnv({ ORCA_MAC_RELEASE: '1', ORCA_LOCAL_BUILD_VERSION: '1.4.178-horca.1' }, (config) => {
      expect(config.extraMetadata).toBeUndefined()
    })
  })

  // Why a per-distribution NSIS include: an uninstaller must only ever kill and
  // remove its own distribution's relocated terminal daemon. Sharing one
  // include would make uninstalling one app destroy the other's live daemon.
  it('gives each distribution an uninstaller that only touches its own daemon host', () => {
    withDownstreamEnv((config) => {
      expect(config.nsis.include.endsWith('daemon-host-uninstall-horca.nsh')).toBe(true)
    })
    const officialInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall.nsh'),
      'utf8'
    )
    const horcaInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall-horca.nsh'),
      'utf8'
    )
    const official = distributionIdentities.official
    const horca = distributionIdentities.horca
    expect(officialInclude).toContain(`taskkill /F /IM ${official.windowsTerminalDaemonImageName}`)
    expect(officialInclude).toContain(
      `$LOCALAPPDATA\\${official.windowsDaemonHostRootName}\\daemon-host`
    )
    expect(horcaInclude).toContain(`taskkill /F /IM ${horca.windowsTerminalDaemonImageName}`)
    expect(horcaInclude).toContain(`$LOCALAPPDATA\\${horca.windowsDaemonHostRootName}\\daemon-host`)
    expect(horcaInclude).not.toContain(`taskkill /F /IM ${official.windowsTerminalDaemonImageName}`)
    expect(horcaInclude).not.toContain(
      `"$LOCALAPPDATA\\${official.windowsDaemonHostRootName}\\daemon-host"`
    )
  })

  // Why: oneClick NSIS names the per-user folder from package.json `name`
  // (`orca`). Horca must re-pin APP_FILENAME or it installs on top of Orca.
  it('pins the Horca per-user install folder away from official Orca', () => {
    const officialInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall.nsh'),
      'utf8'
    )
    const horcaInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall-horca.nsh'),
      'utf8'
    )
    expect(officialInclude).not.toContain('!define /redef APP_FILENAME')
    expect(horcaInclude).toContain('!define /redef APP_FILENAME "${PRODUCT_FILENAME}"')
  })

  // Why: electron-builder NSIS never consumes `protocols`. Horca must write
  // horca: itself and must not register orca: (official Orca's scheme).
  it('registers the Horca URL protocol from the NSIS include', () => {
    const officialInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall.nsh'),
      'utf8'
    )
    const horcaInclude = readFileSync(
      join(process.cwd(), 'config', 'nsis', 'daemon-host-uninstall-horca.nsh'),
      'utf8'
    )
    expect(officialInclude).not.toContain('!macro customInstall')
    expect(officialInclude).not.toContain('Software\\Classes\\horca')
    expect(horcaInclude).toContain('!macro customInstall')
    expect(horcaInclude).toContain('Software\\Classes\\horca')
    expect(horcaInclude).toContain('URL Protocol')
    expect(horcaInclude).toContain('"$appExe" "%1"')
    expect(horcaInclude).toContain('DeleteRegKey SHELL_CONTEXT "Software\\Classes\\horca"')
    expect(horcaInclude).not.toContain('Software\\Classes\\orca')
  })
})
