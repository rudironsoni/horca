import { join } from 'node:path'
import { expect, it } from 'vitest'

export function describeNativeAddonPackaging({
  packageJson,
  pnpmWorkspace,
  packageTargets,
  windowsAddonsInstalled,
  readProject
}) {
  const rebuildScript = readProject('config/scripts/rebuild-native-deps.mjs')
  const ensureScript = readProject('config/scripts/ensure-native-runtime.mjs')

  it('keeps the native Windows registry addon optional and platform-gated', () => {
    expect(packageJson.optionalDependencies['@orca/windows-registry']).toBe('workspace:*')
    // Why: allowBuilds stops pnpm running node-gyp at install time -- the root
    // Windows-only rebuild owns this addon so it is built against the right runtime ABI.
    expect(pnpmWorkspace.allowBuilds['@orca/windows-registry']).toBe(false)
    // Why assert the guard and the member separately: the list now carries more
    // than one addon, so pinning the whole literal only tested its formatting.
    expect(rebuildScript).toContain("rebuildPlatform === 'win32'")
    expect(rebuildScript).toContain("'@orca/windows-registry'")
    expect(ensureScript).toContain("process.platform === 'win32'")
    expect(ensureScript).toContain("'@orca/windows-registry'")
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-registry') }),
          expect.objectContaining({ to: join('node_modules', 'node-addon-api') })
        ])
      )
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'windows-registry') })
        ])
      )
    }
  })

  it('packages the Horca Ghostty GPU surface on every Electron host', () => {
    expect(packageJson.optionalDependencies['@orca/ghostty-surface']).toBe('workspace:*')
    expect(pnpmWorkspace.allowBuilds['@orca/ghostty-surface']).toBe(false)
    expect(pnpmWorkspace.packages).toEqual(expect.arrayContaining(['native/ghostty-surface']))
    expect(rebuildScript).toContain("'@orca/ghostty-surface'")
    expect(ensureScript).toContain("'@orca/ghostty-surface'")
    for (const platform of ['darwin', 'linux', 'win32']) {
      if (platform === 'win32' && !windowsAddonsInstalled) {
        continue
      }
      expect(packageTargets[platform]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@orca', 'ghostty-surface') })
        ])
      )
    }
  })

  it('keeps the native Windows process-table addon optional and platform-gated', () => {
    expect(packageJson.optionalDependencies['@vscode/windows-process-tree']).toBe('0.8.0')
    // Why: same rule as the registry addon -- allowBuilds stops pnpm running node-gyp at
    // install time so the Windows-only rebuild owns it with the right runtime ABI.
    expect(pnpmWorkspace.allowBuilds['@vscode/windows-process-tree']).toBe(false)
    expect(rebuildScript).toContain("'@vscode/windows-process-tree'")
    expect(ensureScript).toContain("'@vscode/windows-process-tree'")
    // Why pin the patch: the upstream binding.gyp requires Spectre-mitigated
    // libraries our build agents do not carry, and the enumeration stops after
    // 1024 processes -- on a busy host that silently hides the very descendants
    // teardown is looking for.
    expect(pnpmWorkspace.patchedDependencies['@vscode/windows-process-tree@0.8.0']).toBe(
      'config/patches/@vscode__windows-process-tree@0.8.0.patch'
    )
    if (windowsAddonsInstalled) {
      expect(packageTargets.win32).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@vscode', 'windows-process-tree') })
        ])
      )
    }
    for (const platform of ['darwin', 'linux']) {
      expect(packageTargets[platform]).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ to: join('node_modules', '@vscode', 'windows-process-tree') })
        ])
      )
    }
  })
}
