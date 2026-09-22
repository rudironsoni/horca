#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const executablePath = resolve(process.argv[2] ?? '')
if (!existsSync(executablePath)) {
  throw new Error(`Packaged Horca executable does not exist: ${executablePath}`)
}

const resourcesPath =
  process.platform === 'darwin'
    ? resolve(dirname(executablePath), '..', 'Resources')
    : join(dirname(executablePath), 'resources')
const publicCli = join(
  resourcesPath,
  'bin',
  process.platform === 'win32' ? 'horca.cmd' : 'horca'
)
if (!existsSync(publicCli)) {
  throw new Error(`Packaged Horca CLI does not exist: ${publicCli}`)
}
if (existsSync(join(resourcesPath, 'herdr'))) {
  throw new Error(`Packaged Horca includes Herdr at ${join(resourcesPath, 'herdr')}`)
}

const smokeTmpRoot = process.platform === 'darwin' ? '/tmp' : tmpdir()
const root = mkdtempSync(join(smokeTmpRoot, 'hs-'))
const home = join(root, 'home')
const userData = join(root, 'user-data')
mkdirSync(home, { recursive: true, mode: 0o700 })
mkdirSync(userData, { recursive: true, mode: 0o700 })
const workspace = join(home, 'smoke-workspace')
mkdirSync(workspace, { recursive: true, mode: 0o700 })
execFileSync('git', ['-C', workspace, 'init', '-b', 'main'])
execFileSync('git', ['-C', workspace, '-c', 'user.email=smoke@horca.local', '-c', 'user.name=Horca Smoke', 'commit', '--allow-empty', '-m', 'smoke'])
writeFileSync(
  join(userData, 'orca-data.json'),
  JSON.stringify({
    settings: { telemetry: { optedIn: true, installId: '00000000-0000-4000-8000-000000000000' } },
    onboarding: { flowVersion: 4, closedAt: 1, outcome: 'completed', lastCompletedStep: 5 },
    ui: {
      featureTipsSeenIds: ['voice-dictation', 'orca-cli', 'cmd-j-palette'],
      contextualToursSeenIds: [
        'workspace-board',
        'browser',
        'tasks',
        'automations',
        'workspace-creation'
      ],
      contextualToursAutoEligible: false,
      projectOrderManualDefaultNoticeDismissed: true,
      usagePercentageDisplayChangeNoticeDismissed: true
    }
  })
)

const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, NODE_OPTIONS: _nodeOptions, ...inheritedEnvironment } =
  process.env
void _electronRunAsNode
void _nodeOptions
const launchEnvironment = {
  ...inheritedEnvironment,
  HOME: home,
  USERPROFILE: home,
  ORCA_E2E_HOME_DIR: home,
  ORCA_E2E_USER_DATA_DIR: userData,
  ORCA_USER_DATA_PATH: userData,
  ORCA_E2E_HEADLESS: '1'
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`)
  }
  return response.json()
}

async function waitForTargets(port) {
  const deadline = Date.now() + 20_000
  let last = []
  while (Date.now() < deadline) {
    try {
      last = await fetchJson(`http://127.0.0.1:${port}/json/list`, 1_000)
      const hit = last.find(
        (target) =>
          target.type === 'page' &&
          target.webSocketDebuggerUrl &&
          (target.title === 'Horca' ||
            target.title === 'Orca' ||
            /index\.html/i.test(target.title) ||
            /index\.html/i.test(target.url ?? ''))
      )
      if (hit) {
        return hit
      }
    } catch {
      // Horca may still be opening windows.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  const titles = last.map((target) => `${target.type}:${target.title}`).join(', ')
  throw new Error(`Packaged Horca did not create its main renderer page (targets: ${titles})`)
}

function openCdp(wsUrl) {
  let nextId = 1
  const pending = new Map()
  const ws = new WebSocket(wsUrl)
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP websocket open timed out')), 10_000)
    ws.addEventListener('open', () => {
      clearTimeout(timer)
      resolve()
    })
    ws.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('CDP websocket error'))
    })
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    const waiter = pending.get(message.id)
    if (!waiter) {
      return
    }
    pending.delete(message.id)
    if (message.error) {
      waiter.reject(new Error(JSON.stringify(message.error)))
      return
    }
    waiter.resolve(message.result)
  })
  return {
    async call(method, params, timeoutMs) {
      await opened
      const id = nextId
      nextId += 1
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`CDP ${method} timed out`))
        }, timeoutMs)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          }
        })
      })
      ws.send(JSON.stringify({ id, method, params }))
      return result
    },
    close() {
      ws.close()
    }
  }
}

function smokeKeyOnMarkerLine(text) {
  try {
    const tail = JSON.parse(text)?.result?.terminal?.tail
    if (!Array.isArray(tail)) {
      return false
    }
    return tail.some((line) => {
      const value = String(line)
      return value.includes('HORCA_D1_SMOKE') && /q/.test(value)
    })
  } catch {
    return false
  }
}

async function readScreen(handle) {
  try {
    return JSON.stringify(runCli(['terminal', 'read', '--terminal', handle, '--screen', '--json']))
  } catch (error) {
    return String(error && error.stdout ? error.stdout : error)
  }
}

async function readOutput(handle) {
  try {
    return JSON.stringify(runCli(['terminal', 'read', '--terminal', handle, '--json']))
  } catch (error) {
    return String(error && error.stdout ? error.stdout : error)
  }
}

async function sendKey(session, event) {
  await session.call('Input.dispatchKeyEvent', { type: 'keyDown', ...event }, 5_000)
  await session.call(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: event.key, code: event.code, modifiers: event.modifiers, windowsVirtualKeyCode: event.windowsVirtualKeyCode, nativeVirtualKeyCode: event.nativeVirtualKeyCode },
    5_000
  )
}

const PROBE_SOURCE = `import os, sys, termios, tty, select, time
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)
sys.stdout.buffer.write(b"PROBE_READY\\r\\n")
sys.stdout.flush()

def burst():
    parts = [os.read(fd, 64)]
    deadline = time.monotonic() + 0.08
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.02)
        if not ready:
            continue
        parts.append(os.read(fd, 64))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    for _ in range(11):
        sys.stdout.buffer.write(b"HEX " + burst().hex().encode() + b"\\r\\n")
        sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"PROBE_DONE\\r\\n")
    sys.stdout.flush()
`
const MOUSE_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"\\x1b[?1000hMOUSE_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = [os.read(fd, 64)]
    deadline = time.monotonic() + 0.15
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        parts.append(os.read(fd, 64))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    sys.stdout.buffer.write(b"MOUSEHEX " + burst().hex().encode() + b"\\r\\n")
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"\\x1b[?1000lMOUSE_DONE\\r\\n")
    sys.stdout.flush()
`
const PASTE_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"\\x1b[?2004hPASTE_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = []
    close = bytes.fromhex("1b5b3230317e")
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            if parts and close in b"".join(parts):
                break
            continue
        parts.append(os.read(fd, 256))
        blob = b"".join(parts)
        if close in blob:
            time.sleep(0.05)
            while select.select([fd], [], [], 0)[0]:
                parts.append(os.read(fd, 256))
            break
    return b"".join(parts)

try:
    sys.stdout.buffer.write(b"PASTEHEX " + burst().hex().encode() + b"\\r\\n")
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"\\x1b[?2004lPASTE_DONE\\r\\n")
    sys.stdout.flush()
`
const SCREEN_SOURCE = `import sys, time
sys.stdout.buffer.write(b"\\x1b[?1049hALTSCREEN_HORCA\\r\\n")
sys.stdout.flush()
time.sleep(0.8)
sys.stdout.buffer.write("\\x1b[?1049lPRIMARY_HORCA é 你 e\\u0301 ┌\\r\\n".encode())
sys.stdout.flush()
`

async function sendLine(session, text) {
  for (const char of text) {
    if (char === ' ') {
      await sendKey(session, { key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 })
      continue
    }
    if (/[0-9]/.test(char)) {
      const digitCode = { 0: 29, 1: 18, 2: 19, 3: 20, 4: 21, 5: 23, 6: 22, 7: 26, 8: 28, 9: 25 }
      await sendKey(session, {
        key: char,
        code: `Digit${char}`,
        text: char,
        unmodifiedText: char,
        windowsVirtualKeyCode: char.charCodeAt(0),
        nativeVirtualKeyCode: digitCode[char]
      })
      continue
    }
    if (!/[a-z]/.test(char)) {
      throw new Error(`smoke sendLine only sends letters, digits, and spaces: ${char}`)
    }
    await sendKey(session, {
      key: char,
      code: `Key${char.toUpperCase()}`,
      text: char,
      unmodifiedText: char,
      windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
      nativeVirtualKeyCode: 0
    })
  }
  await sendKey(session, { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 })
}

function runCli(args) {
  let stdout = ''
  try {
    stdout = execFileSync(publicCli, args, {
      env: launchEnvironment,
      encoding: 'utf8',
      timeout: 60_000
    })
  } catch (error) {
    stdout = String(error && error.stdout ? error.stdout : '')
    if (!stdout) {
      throw error
    }
  }
  const parsed = JSON.parse(stdout)
  if (parsed && parsed.ok === false) {
    throw new Error(`horca ${args.join(' ')}: ${JSON.stringify(parsed.error ?? parsed)}`)
  }
  return parsed
}

async function waitForRuntime() {
  const metadataPath = join(userData, 'orca-runtime.json')
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(metadataPath)) {
      return
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  throw new Error(`Packaged Horca did not write runtime metadata at ${metadataPath}`)
}

function liveHorcaApp() {
  try {
    return execFileSync(
      'python3',
      [
        '-c',
        `import os, subprocess
out = subprocess.check_output(['lsappinfo', 'list'], text=True, errors='replace')
for b in out.split('\\nASN:'):
    if 'com.rudironsoni.horca' not in b: continue
    pid=path=None
    for line in b.splitlines():
        s=line.strip()
        if s.startswith('pid = '): pid=s.split('=',1)[1].strip().split()[0]
        if s.startswith('bundle path='): path=s.split('=',1)[1].strip().strip('"')
    if pid and pid.isdigit():
        try:
            os.kill(int(pid), 0)
            print(pid+'\\t'+(path or ''))
            raise SystemExit(0)
        except OSError:
            pass
raise SystemExit(1)`
      ],
      { encoding: 'utf8' }
    ).trim()
  } catch {
    return ''
  }
}

async function evaluate(session, expression, timeoutMs) {
  const result = await session.call(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    timeoutMs
  )
  if (result?.exceptionDetails) {
    throw new Error(`CDP evaluate failed: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result?.result?.value
}

const assignedPort = await reservePort()
const app = spawn(
  executablePath,
  [
    '--use-mock-keychain',
    `--remote-debugging-port=${assignedPort}`,
    '--remote-allow-origins=*'
  ],
  {
    env: launchEnvironment,
    stdio: ['ignore', 'ignore', 'pipe']
  }
)

try {
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error('Packaged Horca did not publish a CDP endpoint')),
      20_000
    )
    app.once('exit', (code) => {
      clearTimeout(timeout)
      rejectReady(new Error(`Packaged Horca exited before CDP was ready: ${code}`))
    })
    app.stderr.setEncoding('utf8')
    app.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      if (/DevTools listening on ws:\/\/\S+/.test(chunk)) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
  })
  const page = await waitForTargets(assignedPort)
  if (!page.webSocketDebuggerUrl) {
    throw new Error('Packaged Horca page has no CDP websocket')
  }
  const session = openCdp(page.webSocketDebuggerUrl)
  await session.call('Runtime.enable', {}, 10_000)
  console.log('CDP Runtime.enable ok')
  const titleDeadline = Date.now() + 20_000
  let title = ''
  while (Date.now() < titleDeadline) {
    title = await evaluate(session, 'document.title', 5_000)
    console.log(`CDP document.title=${title}`)
    if (title === 'Horca') {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (title !== 'Horca') {
    throw new Error(`Packaged renderer title is not Horca: ${title}`)
  }
  await waitForRuntime()
  const live = liveHorcaApp()
  console.log(`GUI_APP ${live || 'missing'}`)
  if (!live.includes('/Applications/Horca.app') && !live.includes('Horca.app')) {
    console.log('GUI_APP_NOTE lsappinfo did not resolve live bundle; continuing via CDP')
  }
  const added = runCli(['repo', 'add', '--path', workspace, '--json'])
  console.log(`REPO ${added.result?.repo?.id ?? ''} ${added.result?.repo?.path ?? ''}`)
  const created = runCli([
    'worktree',
    'create',
    '--repo',
    `id:${added.result.repo.id}`,
    '--name',
    'smoke',
    '--no-parent',
    '--activate',
    '--json'
  ])
  console.log(`WORKTREE ${JSON.stringify(created.result ?? created)}`)
  const worktreeSelector = created.result?.worktree?.id
    ? `id:${created.result.worktree.id}`
    : `path:${created.result.worktree.path}`
  let terminal = null
  try {
    terminal = runCli([
      'terminal',
      'create',
      '--worktree',
      worktreeSelector,
      '--command',
      'printf HORCA_D1_SMOKE; cat',
      '--focus',
      '--json'
    ])
    console.log(`TERMINAL ${JSON.stringify(terminal.result ?? terminal)}`)
  } catch (error) {
    console.log(`TERMINAL_CREATE_FAILED ${error instanceof Error ? error.message : error}`)
  }
  const workbenchDeadline = Date.now() + 20_000
  let workbench = { canvas: 0, primedError: false, reactError: false, body: '', painted: false }
  while (Date.now() < workbenchDeadline) {
    workbench = await evaluate(
      session,
      `(() => {
        const canvases = [...document.querySelectorAll('.orca-terminal-canvas')]
        let painted = false
        for (const canvas of canvases) {
          if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 2 || canvas.height < 2) continue
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            painted = canvas.width > 2 && canvas.height > 2
            continue
          }
          const sample = ctx.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data
          for (let i = 3; i < sample.length; i += 4) {
            if (sample[i] !== 0) {
              painted = true
              break
            }
          }
        }
        const body = document.body.innerText
        const sizes = canvases.slice(0, 4).map((canvas) => ({
          w: canvas.width,
          h: canvas.height,
          slot: canvas.getAttribute('data-ghostty')
        }))
        return {
          canvas: canvases.length,
          sizes,
          painted,
          primedError: body.includes('libghostty-vt WASM host is not primed'),
          reactError: body.includes('React render error') || body.includes('terminal.workbench'),
          body: body.slice(0, 800)
        }
      })()`,
      5_000
    )
    console.log(
      `CDP workbench canvas=${workbench.canvas} painted=${workbench.painted} primedError=${workbench.primedError} reactError=${workbench.reactError}`
    )
    if (workbench.primedError || workbench.reactError) {
      throw new Error(`Terminal workbench React error: ${workbench.body}`)
    }
    if (workbench.canvas > 0 && workbench.painted) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (workbench.canvas < 1 || !workbench.painted) {
    throw new Error(
      `Packaged terminal workbench has no painted Ghostty canvas: canvas=${workbench.canvas} painted=${workbench.painted} sizes=${JSON.stringify(workbench.sizes ?? [])} ${workbench.body}`
    )
  }
  const wasmEntries = await evaluate(
    session,
    `performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /wasm/i.test(name))`,
    5_000
  )
  console.log(`WASM_RESOURCES ${JSON.stringify(wasmEntries)}`)
  const handle = terminal?.result?.terminal?.handle
  if (!handle) {
    throw new Error('Packaged terminal create did not return a visible handle')
  }
  const markerDeadline = Date.now() + 15_000
  let preview = ''
  while (Date.now() < markerDeadline) {
    try {
      preview = JSON.stringify(
        runCli(['terminal', 'read', '--terminal', handle, '--screen', '--json'])
      )
    } catch (error) {
      preview = String(error && error.stdout ? error.stdout : error)
    }
    if (String(preview).includes('HORCA_D1_SMOKE')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  }
  if (!String(preview).includes('HORCA_D1_SMOKE')) {
    throw new Error(`Ghostty terminal surface did not show HORCA_D1_SMOKE: ${String(preview).slice(0, 800)}`)
  }
  console.log(`PTY_MARKER HORCA_D1_SMOKE`)
  const canvasDeadline = Date.now() + 8_000
  let canvas = null
  while (Date.now() < canvasDeadline) {
    canvas = await evaluate(
      session,
      `(() => {
        const nodes = [...document.querySelectorAll('canvas')]
        const described = nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            slot: node.getAttribute('data-ghostty'),
            cls: node.className
          }
        })
        const hit = described.find((item) => item.slot !== null && item.width > 2 && item.height > 2)
          ?? described.find((item) => item.width > 2 && item.height > 2)
        if (hit && hit.slot !== null) {
          const node = document.querySelector('canvas[data-ghostty="' + hit.slot + '"]')
          node?.focus()
        }
        return { hit, described }
      })()`,
      5_000
    )
    if (canvas?.hit && canvas.hit.width > 2 && canvas.hit.height > 2) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!canvas?.hit || canvas.hit.width < 2 || canvas.hit.height < 2) {
    throw new Error(`Packaged Ghostty canvas is not hittable: ${JSON.stringify(canvas)}`)
  }
  canvas = canvas.hit
  if (canvas.slot === null) {
    throw new Error(`Painted canvas has no Ghostty slot: ${JSON.stringify(canvas)}`)
  }
  const clickX = canvas.x + 12
  const clickY = canvas.y + 12
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1 },
    5_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1 },
    5_000
  )
  await session.call(
    'Input.dispatchKeyEvent',
    {
      type: 'keyDown',
      key: 'q',
      code: 'KeyQ',
      text: 'q',
      unmodifiedText: 'q',
      windowsVirtualKeyCode: 81,
      nativeVirtualKeyCode: 12
    },
    5_000
  )
  await session.call(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: 'q',
      code: 'KeyQ',
      windowsVirtualKeyCode: 81,
      nativeVirtualKeyCode: 12
    },
    5_000
  )
  const keyDeadline = Date.now() + 8_000
  let keyScreen = preview
  while (Date.now() < keyDeadline) {
    try {
      keyScreen = JSON.stringify(
        runCli(['terminal', 'read', '--terminal', handle, '--screen', '--json'])
      )
    } catch (error) {
      keyScreen = String(error && error.stdout ? error.stdout : error)
    }
    if (smokeKeyOnMarkerLine(keyScreen)) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!smokeKeyOnMarkerLine(keyScreen)) {
    throw new Error(`Ghostty key q did not reach the PTY: ${String(keyScreen).slice(0, 800)}`)
  }
  console.log('KEY_OUTPUT q')
  let selected = ''
  for (const rowOffset of [8, 28, 48, 68, 88, 108]) {
    const dragY = canvas.y + rowOffset
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: canvas.x + 4, y: dragY, button: 'left', clickCount: 1 },
      5_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: canvas.x + 140, y: dragY, button: 'left' },
      5_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: canvas.x + 140, y: dragY, button: 'left', clickCount: 1 },
      5_000
    )
    selected = await evaluate(
      session,
      `(() => {
        const api = window.api && window.api.horcaGhosttyPassthru
        if (!api || typeof api.readSelection !== 'function') return ''
        return String(api.readSelection(${JSON.stringify(canvas.slot)}))
      })()`,
      5_000
    )
    if (String(selected).includes('HORCA')) {
      break
    }
  }
  if (!String(selected).includes('HORCA')) {
    throw new Error(`Ghostty mouse selection did not include HORCA: ${JSON.stringify(selected)}`)
  }
  console.log(`SELECTION_OUTPUT ${JSON.stringify(selected)}`)
  await sendKey(session, {
    key: 'c',
    code: 'KeyC',
    modifiers: 2,
    windowsVirtualKeyCode: 67,
    nativeVirtualKeyCode: 8
  })
  const modifierDeadline = Date.now() + 8_000
  let modifierScreen = ''
  while (Date.now() < modifierDeadline) {
    modifierScreen = await readScreen(handle)
    if (modifierScreen.includes('^C')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!modifierScreen.includes('^C')) {
    throw new Error(`Ctrl+C did not reach the terminal: ${modifierScreen.slice(0, 800)}`)
  }
  console.log('MODIFIER_OUTPUT ^C')
  const worktreePath = created.result?.worktree?.path
  if (!worktreePath) {
    throw new Error('Workbench worktree path is missing')
  }
  writeFileSync(join(worktreePath, 'probe'), PROBE_SOURCE)
  writeFileSync(join(worktreePath, 'mouseprobe'), MOUSE_SOURCE)
  writeFileSync(join(worktreePath, 'pasteprobe'), PASTE_SOURCE)
  writeFileSync(join(worktreePath, 'screenprobe'), SCREEN_SOURCE)
  const focusedSlot = await evaluate(
    session,
    `document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-ghostty')`,
    5_000
  )
  if (focusedSlot !== canvas.slot) {
    throw new Error(`Ghostty canvas is not focused: ${JSON.stringify(focusedSlot)} slot=${canvas.slot}`)
  }
  console.log(`FOCUS_OUTPUT ${focusedSlot}`)
  await sendLine(session, 'python3 probe')
  const readyDeadline = Date.now() + 8_000
  let probeScreen = ''
  while (Date.now() < readyDeadline) {
    probeScreen = await readScreen(handle)
    if (probeScreen.includes('PROBE_READY')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!probeScreen.includes('PROBE_READY')) {
    throw new Error(`Key probe did not start: ${probeScreen.slice(0, 800)}`)
  }
  const hexLines = (text) => [...String(text).matchAll(/HEX ([0-9a-f]+)/g)].map((match) => match[1])
  let seenHex = 0
  const oneKey = async (label, event, accept) => {
    await sendKey(session, event)
    const deadline = Date.now() + 6_000
    let screen = ''
    while (Date.now() < deadline) {
      screen = await readScreen(handle)
      const lines = hexLines(screen)
      if (lines.length > seenHex) {
        const hex = lines[lines.length - 1]
        if (!accept(hex)) {
          throw new Error(`${label} bytes ${hex} are not the expected terminal sequence`)
        }
        console.log(`${label} ${hex}`)
        seenHex = lines.length
        return
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
    }
    throw new Error(`${label} did not reach the PTY: ${screen.slice(0, 800)}`)
  }
  await oneKey('ENTER_OUTPUT', { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 }, (hex) => hex === '0d')
  await oneKey('BACKSPACE_OUTPUT', { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51 }, (hex) => hex === '7f')
  await oneKey('TAB_OUTPUT', { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 48 }, (hex) => hex === '09')
  await oneKey('ARROW_OUTPUT', { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 126 }, (hex) => hex === '1b5b41')
  await oneKey('HOME_OUTPUT', { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 115 }, (hex) => hex.startsWith('1b'))
  await oneKey('PAGE_OUTPUT', { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 121 }, (hex) => hex.startsWith('1b'))
  await oneKey('FUNCTION_OUTPUT', { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116, nativeVirtualKeyCode: 96 }, (hex) => hex.startsWith('1b'))
  await oneKey('END_OUTPUT', { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 119 }, (hex) => hex.startsWith('1b'))
  await oneKey('PAGEUP_OUTPUT', { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 116 }, (hex) => hex.startsWith('1b'))
  await oneKey(
    'ALT_OUTPUT',
    { key: 'q', code: 'KeyQ', modifiers: 1, windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 12 },
    (hex) => hex === '1b71' || hex.startsWith('1b5b')
  )
  await oneKey(
    'UNICODE_OUTPUT',
    { key: 'é', code: 'Unidentified', text: 'é', unmodifiedText: 'é', windowsVirtualKeyCode: 0, nativeVirtualKeyCode: 0 },
    (hex) => hex === 'c3a9'
  )
  const probeDoneDeadline = Date.now() + 6_000
  while (Date.now() < probeDoneDeadline) {
    probeScreen = await readScreen(handle)
    if (probeScreen.includes('PROBE_DONE')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!probeScreen.includes('PROBE_DONE')) {
    throw new Error(`Key probe did not restore the terminal: ${probeScreen.slice(0, 800)}`)
  }
  await sendLine(session, 'python3 mouseprobe')
  const mouseReadyDeadline = Date.now() + 8_000
  let mouseScreen = ''
  while (Date.now() < mouseReadyDeadline) {
    mouseScreen = await readScreen(handle)
    if (mouseScreen.includes('MOUSE_READY')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!mouseScreen.includes('MOUSE_READY')) {
    throw new Error(`Mouse probe did not start: ${mouseScreen.slice(0, 800)}`)
  }
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: canvas.x + 24, y: canvas.y + 24, button: 'left', clickCount: 1 },
    5_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: canvas.x + 24, y: canvas.y + 24, button: 'left', clickCount: 1 },
    5_000
  )
  const mouseDeadline = Date.now() + 6_000
  let mouseHex = ''
  while (Date.now() < mouseDeadline) {
    mouseScreen = await readScreen(handle)
    const match = String(mouseScreen).match(/MOUSEHEX ([0-9a-f]+)/)
    if (match) {
      mouseHex = match[1]
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!mouseHex.startsWith('1b5b4d') && !mouseHex.startsWith('1b5b3c')) {
    throw new Error(`Mouse click did not report: ${mouseHex || mouseScreen.slice(0, 800)}`)
  }
  console.log(`MOUSE_OUTPUT ${mouseHex}`)
  execFileSync('pbcopy', { input: 'PASTE_HORCA' })
  await sendLine(session, 'python3 pasteprobe')
  const pasteReadyDeadline = Date.now() + 8_000
  let pasteScreen = ''
  while (Date.now() < pasteReadyDeadline) {
    pasteScreen = await readScreen(handle)
    if (pasteScreen.includes('PASTE_READY')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!pasteScreen.includes('PASTE_READY')) {
    throw new Error(`Paste probe did not start: ${pasteScreen.slice(0, 800)}`)
  }
  await sendKey(session, {
    key: 'v',
    code: 'KeyV',
    modifiers: 4,
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 9
  })
  const pasteDeadline = Date.now() + 6_000
  let pasteHex = ''
  while (Date.now() < pasteDeadline) {
    pasteScreen = await readScreen(handle)
    const match = String(pasteScreen).match(/PASTEHEX ([0-9a-f]+)/)
    if (match) {
      pasteHex = match[1]
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (
    !pasteHex.includes('1b5b3230307e50415354455f484f524341') ||
    !pasteHex.includes('1b5b3230317e')
  ) {
    throw new Error(`Paste did not reach the PTY as bracketed text: ${pasteHex || pasteScreen.slice(0, 800)}`)
  }
  console.log(`PASTE_OUTPUT ${pasteHex}`)
  await sendLine(session, 'python3 screenprobe')
  const altDeadline = Date.now() + 8_000
  let sawAlt = false
  let sawPrimary = false
  let screenProbe = ''
  while (Date.now() < altDeadline) {
    screenProbe = await readScreen(handle)
    if (screenProbe.includes('ALTSCREEN_HORCA')) {
      sawAlt = true
    }
    if (
      screenProbe.includes('PRIMARY_HORCA') &&
      screenProbe.includes('é') &&
      screenProbe.includes('你') &&
      screenProbe.includes('́') &&
      screenProbe.includes('┌')
    ) {
      sawPrimary = true
    }
    if (sawAlt && sawPrimary) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawAlt || !sawPrimary) {
    throw new Error(`Screen probe failed alt=${sawAlt} primary=${sawPrimary}: ${screenProbe.slice(0, 800)}`)
  }
  console.log('SCREEN_OUTPUT alt primary unicode wide combining box')
  const readSttyCols = (text) => {
    const found = []
    for (const match of String(text).matchAll(/stty size[^0-9]{0,80}(\d+) (\d+)/g)) {
      found.push({ index: match.index ?? 0, cols: Number(match[2]) })
    }
    for (const match of String(text).matchAll(/"(\d+) (\d+)"/g)) {
      found.push({ index: match.index ?? 0, cols: Number(match[2]) })
    }
    if (found.length === 0) {
      return null
    }
    found.sort((a, b) => a.index - b.index)
    return found[found.length - 1].cols
  }
  const maxTailLength = (text) => {
    try {
      const tail = JSON.parse(text)?.result?.terminal?.tail
      if (!Array.isArray(tail) || tail.length === 0) {
        return 0
      }
      return Math.max(...tail.map((line) => String(line).length))
    } catch {
      return 0
    }
  }
  await sendLine(session, 'stty size')
  const beforeDeadline = Date.now() + 8_000
  let beforeSize = ''
  let beforeCols = null
  while (Date.now() < beforeDeadline) {
    beforeSize = await readScreen(handle)
    beforeCols = readSttyCols(beforeSize)
    if (beforeCols) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!beforeCols) {
    throw new Error(`stty size did not print a grid: ${beforeSize.slice(0, 800)}`)
  }
  const beforeTail = maxTailLength(beforeSize)
  const shrunkWidth = await evaluate(
    session,
    `(() => {
      const node = document.querySelector('canvas[data-ghostty="${canvas.slot}"]')
      if (!node) return 0
      node.style.width = '80px'
      node.style.height = '400px'
      node.style.maxWidth = '80px'
      node.style.flex = '0 0 80px'
      return node.getBoundingClientRect().width
    })()`,
    5_000
  )
  console.log(`RESIZE_CSS_WIDTH ${shrunkWidth}`)
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  await sendLine(session, 'stty size')
  const afterDeadline = Date.now() + 8_000
  let afterSize = ''
  let afterCols = null
  while (Date.now() < afterDeadline) {
    afterSize = await readOutput(handle)
    const nextCols = readSttyCols(afterSize)
    if (nextCols && nextCols < beforeCols) {
      afterCols = nextCols
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!afterCols) {
    const seen = [...String(afterSize).matchAll(/stty size[^0-9]{0,20}(\d+) (\d+)/g)].map((match) => match[0])
    console.log(`STTY_SEEN ${JSON.stringify(seen)}`)
    console.log(`STTY_TAIL ${String(afterSize).slice(-500)}`)
    throw new Error(
      `Narrow pane did not change PTY columns: before=${beforeCols} css=${shrunkWidth} tail=${beforeTail}`
    )
  }
  console.log(`RESIZE_OUTPUT cols ${beforeCols} -> ${afterCols}`)
  const second = runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'printf HORCA_PANE_2',
    '--focus',
    '--json'
  ])
  const secondHandle = second?.result?.terminal?.handle
  if (!secondHandle) {
    throw new Error('Second pane did not return a terminal handle')
  }
  const paneDeadline = Date.now() + 12_000
  let paneScreen = ''
  let paneCount = 0
  while (Date.now() < paneDeadline) {
    paneScreen = await readScreen(secondHandle)
    paneCount = await evaluate(
      session,
      `document.querySelectorAll('canvas[data-ghostty]').length`,
      5_000
    )
    if (paneScreen.includes('HORCA_PANE_2') && Number(paneCount) >= 2) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  if (!paneScreen.includes('HORCA_PANE_2') || Number(paneCount) < 2) {
    throw new Error(`Multi-pane failed: canvases=${paneCount} screen=${paneScreen.slice(0, 500)}`)
  }
  console.log(`MULTIPANE_OUTPUT ${paneCount} HORCA_PANE_2`)
  session.close()
  if (existsSync(join(home, '.orca'))) {
    throw new Error(`Horca created the official Orca state root: ${join(home, '.orca')}`)
  }
  console.log(
    'Packaged Horca smoke passed: title, renderer, key, modifier, selection, resize, multi-pane, enter, backspace, tab, arrow, home, page, function, unicode, alt-screen, no Herdr'
  )
  if (app.exitCode === null) {
    app.kill('SIGKILL')
  }
  process.exit(0)
} finally {
  if (app.exitCode === null) {
    app.kill('SIGKILL')
  }
}
