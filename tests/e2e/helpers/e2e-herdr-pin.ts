import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const E2E_HERDR_BINARY_PATH_FILE_ENV = 'ORCA_E2E_HERDR_BINARY_PATH_FILE'

export const E2E_HERDR_BINARY_PATH_FILE =
  process.env[E2E_HERDR_BINARY_PATH_FILE_ENV] ??
  path.join(os.tmpdir(), `orca-e2e-herdr-binary-${randomUUID()}.txt`)

export function downloadPinnedHerdrBinary(): string {
  const explicit = process.env.ORCA_HERDR_BUNDLED_BINARY?.trim()
  if (explicit && existsSync(explicit)) {
    return explicit
  }
  const script = path.join(
    process.cwd(),
    'config',
    'horca',
    'scripts',
    'download-herdr-release.mjs'
  )
  const binary = execFileSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8'
  }).trim()
  if (!binary || !existsSync(binary)) {
    throw new Error(`Pinned Herdr download did not produce an executable: ${binary}`)
  }
  return binary
}

export function persistPinnedHerdrBinaryPath(binary: string): void {
  process.env[E2E_HERDR_BINARY_PATH_FILE_ENV] = E2E_HERDR_BINARY_PATH_FILE
  process.env.ORCA_HERDR_BUNDLED_BINARY = binary
  writeFileSync(E2E_HERDR_BINARY_PATH_FILE, `${binary}\n`)
}

export function resolvePinnedHerdrBinary(overlay?: NodeJS.ProcessEnv): string | undefined {
  const candidates = [
    overlay?.ORCA_HERDR_BUNDLED_BINARY,
    process.env.ORCA_HERDR_BUNDLED_BINARY,
    process.env.ORCA_E2E_HERDR_BINARY
  ]
  const pathFile =
    overlay?.[E2E_HERDR_BINARY_PATH_FILE_ENV] ?? process.env[E2E_HERDR_BINARY_PATH_FILE_ENV]
  if (pathFile && existsSync(pathFile)) {
    candidates.push(readFileSync(pathFile, 'utf8').trim())
  }
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value && existsSync(value)) {
      return value
    }
  }
  return undefined
}

/** Point unpackaged Electron at the SDK-compatible pin, not PATH herdr. */
export function applyPinnedHerdrToElectronHome(isolatedHome: string, env: NodeJS.ProcessEnv): void {
  const binary = resolvePinnedHerdrBinary(env)
  if (!binary) {
    return
  }
  env.ORCA_HERDR_BUNDLED_BINARY = binary
  const settingsPath = path.join(isolatedHome, '.horca', 'terminal-backends.json')
  if (existsSync(settingsPath)) {
    return
  }
  mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 })
  writeFileSync(
    settingsPath,
    `${JSON.stringify(
      {
        version: 2,
        terminalBackendDefault: 'herdr',
        herdr: { binarySource: { kind: 'custom', path: binary } }
      },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  )
}
