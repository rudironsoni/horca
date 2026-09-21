import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, cpSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const LOCK = JSON.parse(readFileSync(join(ROOT, 'native/horca-ghostty/GHOSTTY.lock.json'), 'utf8'))
const PIN = LOCK.ghosttyRevision
const VENDOR = join(ROOT, 'native/horca-ghostty/vendor/ghostty')
const PATCH_DIR = join(ROOT, 'native/horca-ghostty/patches')
const ADDON = join(ROOT, 'native/horca-ghostty/adopted/electron-ghostty')
const ADDON_OUT = join(ADDON, 'build/Release/ghostty_renderer.node')
const ELECTRON_TARGET = process.env.HORCA_ELECTRON_TARGET || '43.7.0'
const ZIG_VERSION = '0.15.2'
const ARCHES = (process.env.HORCA_GHOSTTY_ARCHS || 'arm64,x64')
  .split(',')
  .map((arch) => arch.trim())
  .filter(Boolean)

const TARGET = {
  arm64: 'aarch64-macos',
  x64: 'x86_64-macos'
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options })
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function readMagic(file) {
  const fd = openSync(file, 'r')
  const bytes = Buffer.alloc(4)
  readSync(fd, bytes, 0, 4, 0)
  closeSync(fd)
  return bytes
}

export function isMachO(file) {
  if (!existsSync(file)) {
    return false
  }
  const magic = readMagic(file)
  const le = magic.readUInt32LE(0)
  const be = magic.readUInt32BE(0)
  return le === 0xfeedfacf || le === 0xfeedface || be === 0xcafebabe || be === 0xbebafeca
}

function lipoInfo(file) {
  return capture('lipo', ['-info', file])
}

function hasArch(file, arch) {
  if (!existsSync(file)) {
    return false
  }
  return lipoInfo(file).includes(arch === 'x64' ? 'x86_64' : 'arm64')
}

function addonReady() {
  if (!isMachO(ADDON_OUT)) {
    return false
  }
  return ARCHES.every((arch) => hasArch(ADDON_OUT, arch))
}

function zigBin() {
  const cached = join(ROOT, '.cache', `zig-${ZIG_VERSION}`, 'zig')
  if (existsSync(cached)) {
    return cached
  }
  try {
    if (capture('zig', ['version']) === ZIG_VERSION) {
      return 'zig'
    }
  } catch {
    // download below
  }
  const archive = join(ROOT, '.cache', `zig-aarch64-macos-${ZIG_VERSION}.tar.xz`)
  const dest = join(ROOT, '.cache', `zig-${ZIG_VERSION}`)
  mkdirSync(dirname(archive), { recursive: true })
  if (!existsSync(archive)) {
    run('curl', [
      '-fsSL',
      '-o',
      archive,
      `https://ziglang.org/download/${ZIG_VERSION}/zig-aarch64-macos-${ZIG_VERSION}.tar.xz`
    ])
  }
  run('tar', ['-xJf', archive, '-C', join(ROOT, '.cache')])
  const extracted = join(ROOT, '.cache', `zig-aarch64-macos-${ZIG_VERSION}`)
  if (existsSync(extracted) && !existsSync(dest)) {
    run('mv', [extracted, dest])
  }
  if (!existsSync(cached)) {
    throw new Error(`zig ${ZIG_VERSION} was not extracted to ${cached}`)
  }
  return cached
}

function patchApplied(patch) {
  try {
    execFileSync('git', ['-C', VENDOR, 'apply', '--reverse', '--check', patch], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function ensureGhosttySource() {
  if (!existsSync(join(VENDOR, 'build.zig'))) {
    mkdirSync(dirname(VENDOR), { recursive: true })
    run('git', ['clone', '--filter=blob:none', 'https://github.com/ghostty-org/ghostty', VENDOR])
    run('git', ['-C', VENDOR, 'fetch', '--depth', '1', 'origin', PIN])
    run('git', ['-C', VENDOR, 'checkout', '--detach', 'FETCH_HEAD'])
  }
  const head = capture('git', ['-C', VENDOR, 'rev-parse', 'HEAD'])
  if (head !== PIN) {
    throw new Error(`Ghostty vendor HEAD ${head} is not pin ${PIN}`)
  }
  const buildZig = readFileSync(join(VENDOR, 'build.zig'), 'utf8')
  if (buildZig.includes('libghostty_step') && existsSync(join(VENDOR, 'src/termio/Passthru.zig'))) {
    return
  }
  for (const name of LOCK.patches) {
    const patch = join(ROOT, 'native/horca-ghostty', name)
    if (patchApplied(patch)) {
      continue
    }
    run('git', ['-C', VENDOR, 'apply', '--whitespace=nowarn', patch])
  }
  if (!existsSync(join(PATCH_DIR, '0004-build-libghostty-static-step.patch'))) {
    throw new Error('Ghostty patch 0004 is missing')
  }
}

function buildStaticLib(zig, arch) {
  const prefix = join(VENDOR, `zig-out-${TARGET[arch]}`)
  const archive = join(prefix, 'lib', 'libghostty.a')
  const legacy = join(VENDOR, 'zig-out', 'lib', 'libghostty.a')
  if (!existsSync(archive) && existsSync(legacy) && hasArch(legacy, arch)) {
    mkdirSync(dirname(archive), { recursive: true })
    cpSync(legacy, archive)
  }
  if (existsSync(archive) && hasArch(archive, arch)) {
    return archive
  }
  run(
    zig,
    ['build', 'libghostty', '-Doptimize=ReleaseFast', `-Dtarget=${TARGET[arch]}`, '-p', prefix],
    { cwd: VENDOR }
  )
  if (!existsSync(archive)) {
    throw new Error(`libghostty.a missing for ${arch}`)
  }
  return archive
}

function rebuildAddon(arch, archive) {
  const linkDir = join(VENDOR, 'zig-out', 'lib')
  mkdirSync(linkDir, { recursive: true })
  cpSync(archive, join(linkDir, 'libghostty.a'))
  rmSync(join(ADDON, 'build'), { recursive: true, force: true })
  run('npx', ['--yes', 'node-gyp@11', 'rebuild', '--release'], {
    cwd: ADDON,
    env: {
      ...process.env,
      npm_config_runtime: 'electron',
      npm_config_target: ELECTRON_TARGET,
      npm_config_arch: arch,
      npm_config_target_arch: arch,
      npm_config_disturl: 'https://electronjs.org/headers',
      npm_config_build_from_source: 'true'
    }
  })
  if (!isMachO(ADDON_OUT) || !hasArch(ADDON_OUT, arch)) {
    throw new Error(`ghostty_renderer.node is not a ${arch} Mach-O`)
  }
}

function main() {
  for (const arch of ARCHES) {
    if (!TARGET[arch]) {
      throw new Error(`Unsupported Ghostty addon arch: ${arch}`)
    }
  }
  if (addonReady()) {
    console.log(`[ghostty-addon] ${lipoInfo(ADDON_OUT)}`)
    return
  }
  ensureGhosttySource()
  const zig = zigBin()
  const slices = []
  for (const arch of ARCHES) {
    const slice = join(ADDON, 'build', `ghostty_renderer-${arch}.node`)
    if (!existsSync(slice) && existsSync(ADDON_OUT) && hasArch(ADDON_OUT, arch) && isMachO(ADDON_OUT)) {
      mkdirSync(dirname(slice), { recursive: true })
      cpSync(ADDON_OUT, slice)
    }
    if (existsSync(slice) && hasArch(slice, arch)) {
      slices.push(slice)
      continue
    }
    const archive = buildStaticLib(zig, arch)
    rebuildAddon(arch, archive)
    mkdirSync(dirname(slice), { recursive: true })
    cpSync(ADDON_OUT, slice)
    slices.push(slice)
  }
  mkdirSync(dirname(ADDON_OUT), { recursive: true })
  if (slices.length === 1) {
    cpSync(slices[0], ADDON_OUT)
  } else {
    run('lipo', ['-create', ...slices, '-output', ADDON_OUT])
  }
  if (!addonReady()) {
    throw new Error(`ghostty_renderer.node is missing arches: ${lipoInfo(ADDON_OUT)}`)
  }
  console.log(`[ghostty-addon] ${lipoInfo(ADDON_OUT)}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
