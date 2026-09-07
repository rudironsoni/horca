import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'

// Darwin sun_path is 104 bytes including NUL.
const HERDR_SUN_PATH_BYTES = 103

export function herdrSessionSocketPath(configHome: string, sessionName: string): string {
  if (!configHome.startsWith('/') || /[\n\r]/.test(configHome)) {
    throw new Error(`Herdr config home is not an absolute POSIX path: ${configHome}`)
  }
  if (sessionName.length === 0 || /[\\/\0]/.test(sessionName)) {
    throw new Error(`Herdr session name is not a single path segment: ${sessionName}`)
  }
  return posix.join(configHome, 'herdr', 'sessions', sessionName, 'herdr.sock')
}

export function herdrConfigHomeForSession(
  sessionName: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const home = env.HOME || env.USERPROFILE || ''
  const preferred =
    env.XDG_CONFIG_HOME || (home ? posix.join(home.replace(/\\/g, '/'), '.config') : '')
  const clientSock = preferred.startsWith('/')
    ? posix.join(preferred, 'herdr', 'sessions', sessionName, 'herdr-client.sock')
    : ''
  if (preferred.startsWith('/') && Buffer.byteLength(clientSock, 'utf8') <= HERDR_SUN_PATH_BYTES) {
    return preferred
  }
  const uid = process.getuid?.() ?? 0
  const tag = preferred.startsWith('/')
    ? createHash('sha256').update(preferred).digest('hex').slice(0, 8)
    : '0'
  return `/tmp/.horca-h-${uid}-${tag}`
}

export function ensureHerdrConfigHome(configHome: string): string {
  mkdirSync(configHome, { recursive: true, mode: 0o700 })
  return configHome
}

export function herdrLocalRelayEndpoint(
  label: string,
  platform: NodeJS.Platform = process.platform
): { directory: string; listenPath: string } {
  const directory = mkdtempSync(join(tmpdir(), 'horca-herdr-'))
  const safe = label.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
  if (platform === 'win32') {
    return { directory, listenPath: `\\\\.\\pipe\\horca-herdr-${process.pid}-${safe}` }
  }
  return { directory, listenPath: join(directory, 'herdr.sock') }
}
