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

function shellPromptAfter(text, marker) {
  try {
    const tail = JSON.parse(text)?.result?.terminal?.tail
    if (!Array.isArray(tail)) {
      return false
    }
    const rows = tail.map((line) => String(line))
    let markerAt = -1
    for (let index = 0; index < rows.length; index += 1) {
      if (rows[index].includes(marker)) {
        markerAt = index
      }
    }
    if (markerAt < 0) {
      return false
    }
    for (let index = markerAt + 1; index < rows.length; index += 1) {
      if (rows[index].includes('runner$')) {
        return true
      }
    }
    return false
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

function clearProbeSelectionPlan(origin) {
  return {
    rows: [8, 28, 48, 68, 88, 108].filter((offset) => offset < origin.height),
    x2: origin.x + Math.max(24, origin.width - 8)
  }
}

function clearProbeSelectionCoversPromptRow(origin) {
  const plan = clearProbeSelectionPlan(origin)
  const bannerClip = Math.min(220, Math.max(24, origin.width - 8))
  return plan.rows.some((offset) => offset > 8) && plan.x2 - origin.x > bannerClip
}

if (!clearProbeSelectionCoversPromptRow({ x: 0, y: 0, width: 800, height: 400 })) {
  throw new Error('Clear probe drag does not cover the prompt row')
}

async function dragReadSelection(session, slot, coverPromptRow = false) {
  const origin = await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })()`,
    5_000
  )
  if (!origin || origin.width < 2 || origin.height < 2) {
    return ''
  }
  const plan = clearProbeSelectionPlan(origin)
  const x2 = coverPromptRow
    ? plan.x2
    : origin.x + Math.min(220, Math.max(24, origin.width - 8))
  const rows = plan.rows
  const covered = []
  let selected = ''
  for (const offset of rows) {
    const y = origin.y + offset
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: origin.x + 4, y, button: 'left', clickCount: 1 },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: x2, y, button: 'left' },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: x2, y, button: 'left', clickCount: 1 },
      15_000
    )
    selected = String(
      (await evaluate(
        session,
        `(() => {
          const api = window.api && window.api.horcaGhosttyPassthru
          return api && api.readSelection ? String(api.readSelection(${JSON.stringify(slot)})) : ''
        })()`,
        5_000
      )) ?? ''
    )
    if (coverPromptRow) {
      if (selected) {
        covered.push(selected)
      }
      continue
    }
    if (selected) {
      break
    }
  }
  return coverPromptRow ? covered.join('\n') : selected
}

async function clickClearScreen(session, slot) {
  const opened = await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return false
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.x + Math.min(24, rect.width / 2),
        clientY: rect.y + Math.min(24, rect.height / 2)
      }))
      return true
    })()`,
    5_000
  )
  if (!opened) {
    return false
  }
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    const clicked = await evaluate(
      session,
      `(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
          (entry.innerText || '').trim().startsWith('Clear Screen')
        )
        if (!item) return false
        item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
        item.click()
        return true
      })()`,
      5_000
    )
    if (clicked) {
      return true
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  return false
}

async function readOutput(handle) {
  try {
    return JSON.stringify(runCli(['terminal', 'read', '--terminal', handle, '--json']))
  } catch (error) {
    return String(error && error.stdout ? error.stdout : error)
  }
}

async function sendKey(session, event) {
  await session.call('Input.dispatchKeyEvent', { type: 'keyDown', ...event }, 15_000)
  await session.call(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: event.key, code: event.code, modifiers: event.modifiers, windowsVirtualKeyCode: event.windowsVirtualKeyCode, nativeVirtualKeyCode: event.nativeVirtualKeyCode },
    15_000
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
const IME_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"IME_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = [os.read(fd, 64)]
    deadline = time.monotonic() + 0.25
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        parts.append(os.read(fd, 64))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    sys.stdout.buffer.write(b"IMEHEX " + burst().hex().encode() + b"\\r\\n")
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
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
    sys.stdout.buffer.write(b"\\x1b[?1000l")
    sys.stdout.flush()
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
    blob = burst()
    exact = b"\\x1b[200~PASTE_HORCA\\x1b[201~"
    if exact in blob:
        line = b"PASTE_OK\\r\\n"
    elif b"\\x1b[200~PASTE_HORCA" in blob and b"\\x1b[201~" in blob:
        line = b"PASTE_SPLIT\\r\\n"
    else:
        line = b"PASTE_BAD " + blob[:48].hex().encode() + b"\\r\\n"
    sys.stdout.buffer.write(line)
    sys.stdout.flush()
    # The packaged screen read showed PASTE_OK, which is written while the
    # tty is still raw. The same read never showed PASTE_DONE once it was
    # written after tcsetattr, so the shell-return marker is printed here.
    sys.stdout.buffer.write(b"PASTE_DONE\\r\\n")
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"\\x1b[?2004l")
    sys.stdout.flush()
`
const EXIT_SOURCE = `import sys, time
sys.stdout.buffer.write("EXIT_MARKER\\n".encode())
sys.stdout.flush()
time.sleep(0.4)
raise SystemExit(0)
`
const SCREEN_SOURCE = `import sys, time
sys.stdout.buffer.write(b"\\x1b[2J\\x1b[HPRIMARY_HORCA\\r\\n")
sys.stdout.flush()
time.sleep(1.0)
sys.stdout.buffer.write(b"\\x1b[?1049h\\x1b[2J\\x1b[HALTSCREEN_HORCA\\r\\n")
sys.stdout.flush()
time.sleep(1.0)
sys.stdout.buffer.write(b"\\x1b[?1049l")
sys.stdout.flush()
time.sleep(1.0)
`
const CHORD_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"CHORD_READY\\r\\n")
sys.stdout.flush()
sys.stdout.buffer.write(b"\\x1b[<u\\x1b[>31u")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = [os.read(fd, 128)]
    deadline = time.monotonic() + 0.2
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        parts.append(os.read(fd, 128))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    for _ in range(6):
        sys.stdout.buffer.write(b"CHORDHEX " + burst().hex().encode() + b"\\r\\n")
        sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"\\x1b[<uCHORD_DONE\\r\\n")
    sys.stdout.flush()
`
const IME_MULTI_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"IME2_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = [os.read(fd, 128)]
    deadline = time.monotonic() + 0.35
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        parts.append(os.read(fd, 128))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    sys.stdout.buffer.write(b"IME2HEX " + burst().hex().encode() + b"\\r\\n")
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
`
const WHEEL_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"\\x1b[?1002h\\x1b[?1006hWHEEL_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = [os.read(fd, 128)]
    deadline = time.monotonic() + 0.25
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.03)
        if not ready:
            continue
        parts.append(os.read(fd, 128))
        deadline = time.monotonic() + 0.04
    return b"".join(parts)

try:
    for _ in range(2):
        sys.stdout.buffer.write(b"WHEELHEX " + burst().hex().encode() + b"\\r\\n")
        sys.stdout.flush()
finally:
    sys.stdout.buffer.write(b"\\x1b[?1002l\\x1b[?1006l")
    sys.stdout.flush()
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"WHEEL_DONE\\r\\n")
    sys.stdout.flush()
`
const FILL_SOURCE = `import sys
sys.stdout.write("SCROLLTOP\\n")
sys.stdout.write("REFLOWHORCA" + ("x" * 180) + "\\n")
for i in range(80):
    sys.stdout.write("SCROLLROW\\n")
sys.stdout.write("SEARCHHORCA one\\n")
sys.stdout.write("SEARCHHORCA two\\n")
sys.stdout.write("SCROLLBOT\\n")
sys.stdout.flush()
`
const LINK_SOURCE = `import os, sys
path = os.getcwd() + "/linkfile"
open(path, "w").write("link\\n")
sys.stdout.write("http://127.0.0.1/HORCALINK\\n")
sys.stdout.write(path + "\\n")
sys.stdout.write("http://127.0.0.1/HORCAWRAP" + ("w" * 180) + "\\n")
sys.stdout.buffer.write(b"\\x1b]8;;http://127.0.0.1/OSC8HORCA\\x1b\\\\OSC8HORCA\\x1b]8;;\\x1b\\\\\\n")
sys.stdout.write("LINK_READY\\n")
sys.stdout.flush()
`
const OSC52_SOURCE = `import sys
sys.stdout.buffer.write(b"\\x1b]52;c;T1NDNTJIT1JDQQ==\\x07")
sys.stdout.flush()
sys.stdout.write("OSC52_WROTE\\n")
sys.stdout.flush()
`
const OSC52_OFF_SOURCE = `import sys
sys.stdout.buffer.write(b"\\x1b]52;c;T1NDNTJPRkY=\\x07")
sys.stdout.flush()
sys.stdout.write("OSC52_OFF_WROTE\\n")
sys.stdout.flush()
`
const FOLLOW_SOURCE = `import sys, time
sys.stdout.write("FOLLOWREADY\\n")
sys.stdout.flush()
time.sleep(1.2)
sys.stdout.write("FOLLOWHORCA\\n")
sys.stdout.flush()
`
const SLEEP_SOURCE = `import sys, time
sys.stdout.buffer.write(b"SLEEP_READY\\n")
sys.stdout.flush()
time.sleep(60)
sys.stdout.buffer.write(b"SLEEP_DONE\\n")
sys.stdout.flush()
`
const SSH_SOURCE = `import os, sys, subprocess, termios, tty, select, time
sys.stdout.buffer.write(b"SSHSCROLLHORCA\\n\\x1b[?2004hSSH_READY\\r\\n")
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
            break
    return b"".join(parts)

try:
    blob = burst()
    exact = b"\\x1b[200~PASTE_HORCA\\x1b[201~"
    if exact in blob:
        line = b"PASTE_OK\\r\\n"
    else:
        line = b"PASTE_BAD " + blob[:48].hex().encode() + b"\\r\\n"
    sys.stdout.buffer.write(line)
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
    sys.stdout.buffer.write(b"\\x1b[?2004l")
    sys.stdout.flush()
subprocess.call(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=1", "-o", "ConnectionAttempts=1", "127.0.0.1", "true"])
sys.stdout.buffer.write(b"SSHDROPPED\\n")
sys.stdout.flush()
`
const STARTUP_SOURCE = `import os, sys, termios, tty, select, time
sys.stdout.buffer.write(b"\\x1b[?2004hSTARTUP_READY\\r\\n")
sys.stdout.flush()
fd = 0
old = termios.tcgetattr(fd)
tty.setraw(fd)

def burst():
    parts = []
    close = bytes.fromhex("1b5b3230317e")
    open_ = bytes.fromhex("1b5b3230307e")
    deadline = time.monotonic() + 1.2
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if not ready:
            if parts and open_ in b"".join(parts) and close in b"".join(parts):
                break
            continue
        parts.append(os.read(fd, 256))
        blob = b"".join(parts)
        if open_ in blob and close in blob:
            break
    return b"".join(parts)

try:
    blob = burst()
    if bytes.fromhex("1b5b3230307e") in blob and bytes.fromhex("1b5b3230317e") in blob and len(blob) > 12:
        line = b"STARTUP_OK\\r\\n"
    else:
        line = b"STARTUP_BAD " + blob[:48].hex().encode() + b"\\r\\n"
    sys.stdout.buffer.write(line)
    sys.stdout.flush()
finally:
    termios.tcsetattr(fd, termios.TCSANOW, old)
`
const CWD_SOURCE = `import os, sys
sys.stdout.write("CWDHORCA " + os.getcwd() + "\\n")
sys.stdout.flush()
`
const RELAUNCH_SOURCE = `import sys, time
sys.stdout.write("RELAUNCHA\\n")
sys.stdout.write("RELAUNCHROW\\n" * 60)
sys.stdout.flush()
time.sleep(1.2)
sys.stdout.write("HIDDENHORCA\\n")
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

function readClipboard() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' })
  } catch {
    return ''
  }
}

function tailLines(text) {
  try {
    const tail = JSON.parse(text)?.result?.terminal?.tail
    return Array.isArray(tail) ? tail.map((line) => String(line)) : []
  } catch {
    return []
  }
}

function formatShellReturnDump(screenText, outputText) {
  const screenRows = tailLines(screenText)
  const outputRows = tailLines(outputText)
  let pasteAt = -1
  for (let index = 0; index < outputRows.length; index += 1) {
    if (outputRows[index].includes('pasteprobe')) {
      pasteAt = index
    }
  }
  const tailRows = pasteAt >= 0 ? outputRows.slice(pasteAt) : outputRows
  const lines = [`SCREEN ${screenRows.length}`]
  if (screenRows.length === 0) {
    lines.push(String(screenText))
  } else {
    screenRows.forEach((row, index) => {
      lines.push(`SCREEN ${index} ${JSON.stringify(row)}`)
    })
  }
  lines.push(`TAIL ${pasteAt >= 0 ? pasteAt : 'absent'} ${tailRows.length}`)
  if (outputRows.length === 0) {
    lines.push(String(outputText))
  } else {
    tailRows.forEach((row, index) => {
      lines.push(`TAIL ${index} ${JSON.stringify(row)}`)
    })
  }
  return lines.join('\n')
}

function formatChordStartDump(screenText) {
  let terminal = null
  try {
    terminal = JSON.parse(screenText)?.result?.terminal ?? null
  } catch {
    terminal = null
  }
  const source =
    terminal && Object.prototype.hasOwnProperty.call(terminal, 'source') ? terminal.source : undefined
  const lines = [`source ${source === undefined ? 'absent' : JSON.stringify(source)}`]
  const tail = Array.isArray(terminal?.tail) ? terminal.tail.map((line) => String(line)) : null
  if (!tail) {
    lines.push(String(screenText))
    return lines.join('\n')
  }
  lines.push(`TAIL ${tail.length}`)
  tail.forEach((row, index) => {
    lines.push(`TAIL ${index} ${JSON.stringify(row)}`)
  })
  return lines.join('\n')
}

function writeClipboard(text) {
  execFileSync('pbcopy', { input: text })
}

async function pollUntil(label, timeoutMs, read) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await read()
    if (last) {
      return last
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  throw new Error(`${label}: ${JSON.stringify(last).slice(0, 800)}`)
}

async function ghosttyCanvasCount(session) {
  return Number(
    await evaluate(session, `document.querySelectorAll('canvas[data-ghostty]').length`, 5_000)
  )
}

async function ghosttySlots(session) {
  const slots = await evaluate(
    session,
    `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => node.getAttribute('data-ghostty')).filter(Boolean)`,
    5_000
  )
  return Array.isArray(slots) ? slots : []
}

async function ghosttyRect(session, slot) {
  return evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, slot: ${JSON.stringify(slot)} }
    })()`,
    5_000
  )
}

async function focusGhosttySlot(session, slot) {
  await evaluate(
    session,
    `document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})?.focus()`,
    5_000
  )
}

async function openContextMenu(session, slot) {
  const opened = await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return false
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.x + Math.min(24, rect.width / 2),
        clientY: rect.y + Math.min(24, rect.height / 2)
      }))
      return true
    })()`,
    5_000
  )
  if (!opened) {
    throw new Error(`Context menu canvas was not available: ${slot}`)
  }
}

async function clickLabeledControl(session, label) {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    const point = await evaluate(
      session,
      `(() => {
        const wanted = ${JSON.stringify(label)}
        const el = [...document.querySelectorAll('button,[role="menuitem"]')].find((item) => {
          const text = (item.getAttribute('aria-label') || item.getAttribute('title') || item.innerText || '').trim()
          return text === wanted || text.startsWith(wanted)
        })
        if (!el) return null
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return null
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })()`,
      5_000
    )
    if (point) {
      await session.call(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        15_000
      )
      await session.call(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
        15_000
      )
      return true
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  return false
}

async function confirmStopAndClose(session) {
  await evaluate(
    session,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((entry) =>
        (entry.innerText || '').trim().startsWith('Stop and Close')
      )
      if (!button) return false
      button.click()
      return true
    })()`,
    5_000
  )
}

async function closeNewestTerminalTab(session) {
  const before = await ghosttyCanvasCount(session)
  const clicked = await evaluate(
    session,
    `(() => {
      const button = [...document.querySelectorAll('button')].filter((entry) =>
        (entry.getAttribute('aria-label') || entry.innerText || '').includes('Close tab')
      ).at(-1)
      if (!button) return false
      button.click()
      return true
    })()`,
    5_000
  )
  if (!clicked) {
    throw new Error('Close tab button was not available')
  }
  const next = await pollUntil(
    'Close tab did not release a Ghostty surface',
    8_000,
    async () => {
      await confirmStopAndClose(session)
      const count = await ghosttyCanvasCount(session)
      return count < before ? count : null
    }
  )
  return next
}

async function closePaneSlot(session, slot) {
  const before = await ghosttyCanvasCount(session)
  await openContextMenu(session, slot)
  const closed = await pollUntil('Close Pane did not open', 4_000, () => clickLabeledControl(session, 'Close Pane'))
  if (!closed) {
    throw new Error('Close Pane was not clickable')
  }
  await pollUntil('Close Pane did not release a Ghostty surface', 8_000, async () => {
    await confirmStopAndClose(session)
    const slots = await ghosttySlots(session)
    return slots.includes(slot) ? null : slots.length
  })
  const after = await ghosttyCanvasCount(session)
  if (after >= before) {
    throw new Error(`Close Pane left the surface: before=${before} after=${after}`)
  }
}

async function keepGhosttyCanvases(session, limit) {
  let count = await ghosttyCanvasCount(session)
  let guard = 0
  while (count > limit && guard < 6) {
    guard += 1
    count = await closeNewestTerminalTab(session)
  }
  if (count > limit) {
    throw new Error(`Ghostty surfaces stayed above ${limit}: ${count}`)
  }
  return count
}

async function wheelAt(session, rect, deltaY) {
  await session.call(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseWheel',
      x: rect.x + Math.min(40, rect.width / 2),
      y: rect.y + Math.min(40, rect.height / 2),
      deltaX: 0,
      deltaY,
      button: 'none'
    },
    15_000
  )
}

async function passthruCall(session, slot, expression) {
  return evaluate(
    session,
    `(() => {
      const api = window.api && window.api.horcaGhosttyPassthru
      const slot = ${JSON.stringify(slot)}
      if (!api) return null
      ${expression}
    })()`,
    5_000
  )
}

async function runBracketedPaste(session, handle, trigger) {
  await sendLine(session, 'python3 pasteprobe')
  await pollUntil('Paste probe did not start', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('PASTE_READY') ? screen : null
  })
  writeClipboard('PASTE_HORCA')
  await trigger()
  const verdict = await pollUntil('Paste did not reach the PTY', 6_000, async () => {
    const screen = await readScreen(handle)
    if (screen.includes('PASTE_OK')) return 'PASTE_OK'
    if (screen.includes('PASTE_BAD') || screen.includes('PASTE_SPLIT')) return screen.slice(0, 180)
    return null
  })
  if (verdict !== 'PASTE_OK') {
    throw new Error(`Paste did not reach the PTY as bracketed text: ${verdict}`)
  }
}

async function probePackagedBehaviors(ctx) {
  const { session, handle, worktreePath, worktreeSelector } = ctx
  let slot = ctx.slot
  writeFileSync(join(worktreePath, 'chordprobe'), CHORD_SOURCE)
  writeFileSync(join(worktreePath, 'imemulti'), IME_MULTI_SOURCE)
  writeFileSync(join(worktreePath, 'wheelprobe'), WHEEL_SOURCE)
  writeFileSync(join(worktreePath, 'fillprobe'), FILL_SOURCE)
  writeFileSync(join(worktreePath, 'linkprobe'), LINK_SOURCE)
  writeFileSync(join(worktreePath, 'osc52probe'), OSC52_SOURCE)
  writeFileSync(join(worktreePath, 'osc52off'), OSC52_OFF_SOURCE)
  writeFileSync(join(worktreePath, 'sleepprobe'), SLEEP_SOURCE)
  writeFileSync(join(worktreePath, 'followprobe'), FOLLOW_SOURCE)
  writeFileSync(join(worktreePath, 'sshprobe'), SSH_SOURCE)
  writeFileSync(join(worktreePath, 'startupprobe'), STARTUP_SOURCE)
  writeFileSync(join(worktreePath, 'cwdprobe'), CWD_SOURCE)
  writeFileSync(join(worktreePath, 'relaunchprobe'), RELAUNCH_SOURCE)

  const nextChord = async (label, send, accept) => {
    const before = [...String(await readScreen(handle)).matchAll(/CHORDHEX ([0-9a-f]+)/g)].length
    await send()
    const hex = await pollUntil(`${label} did not reach the PTY`, 6_000, async () => {
      const lines = [...String(await readScreen(handle)).matchAll(/CHORDHEX ([0-9a-f]+)/g)].map((match) => match[1])
      return lines.length > before ? lines[lines.length - 1] : null
    })
    if (!accept(hex)) {
      throw new Error(`${label} bytes ${hex} are not the expected terminal sequence`)
    }
    console.log(`${label} ${hex}`)
    return hex
  }

  await focusGhosttySlot(session, slot)
  // The rendered screen ends on PASTE_OK. The terminal-read tail already has
  // PASTE_OK and the shell prompt (`runner$`); PASTE_DONE is in that tail and
  // not on the screen. Type the next command only after that tail prompt.
  const shellDeadline = Date.now() + 8_000
  let shellSample = ''
  while (Date.now() < shellDeadline) {
    shellSample = await readOutput(handle)
    if (shellPromptAfter(shellSample, 'PASTE_OK')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!shellPromptAfter(shellSample, 'PASTE_OK')) {
    const screenSample = await readScreen(handle)
    throw new Error(
      `Paste probe did not return the shell:\n${formatShellReturnDump(screenSample, shellSample)}`
    )
  }
  // Cmd+V set the meta modifier. The packaged canvas drops keydowns while metaKey is set.
  await session.call(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: 'Meta',
      code: 'MetaLeft',
      windowsVirtualKeyCode: 91,
      nativeVirtualKeyCode: 55,
      modifiers: 0
    },
    15_000
  )
  await sendLine(session, 'python3 chordprobe')
  const chordStartDeadline = Date.now() + 8_000
  let chordScreen = ''
  while (Date.now() < chordStartDeadline) {
    chordScreen = await readScreen(handle)
    if (chordScreen.includes('CHORD_READY')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!chordScreen.includes('CHORD_READY')) {
    throw new Error(`Chord probe did not start:\n${formatChordStartDump(chordScreen)}`)
  }
  await nextChord(
    'CHORD_CTRL_ENTER',
    () => sendKey(session, { key: 'Enter', code: 'Enter', modifiers: 2, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 }),
    (hex) => hex.includes('1b5b31333b3575')
  )
  await nextChord(
    'CHORD_OPTION_ARROW',
    () => sendKey(session, { key: 'ArrowUp', code: 'ArrowUp', modifiers: 1, windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 126 }),
    (hex) => hex.includes('1b5b313b33') && hex.includes('41')
  )
  await nextChord(
    'CHORD_NONLATIN',
    () => sendKey(session, { key: 'ф', code: 'KeyA', text: 'ф', modifiers: 2, windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 0 }),
    (hex) => hex.includes('1b5b39373b3575') || hex.includes('1b5b313039323b3575')
  )
  await nextChord(
    'CHORD_KEYUP',
    () => sendKey(session, { key: 'q', code: 'KeyQ', modifiers: 1, windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 12 }),
    (hex) => hex.includes('1b5b3131333b333a3375')
  )
  const surfacesBeforeSplit = await ghosttyCanvasCount(session)
  await nextChord(
    'CHORD_SPLIT_SHORTCUT',
    async () => {
      await sendKey(session, { key: 'd', code: 'KeyD', modifiers: 4, windowsVirtualKeyCode: 68, nativeVirtualKeyCode: 2 })
      await focusGhosttySlot(session, slot)
      await sendKey(session, { key: 'a', code: 'KeyA', text: 'a', unmodifiedText: 'a', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 0 })
    },
    (hex) => !hex.includes('1b5b3130303b') && (hex === '61' || hex.includes('1b5b39373b3175'))
  )
  if ((await ghosttyCanvasCount(session)) > surfacesBeforeSplit) {
    const extra = (await ghosttySlots(session)).find((item) => item !== slot)
    if (extra) {
      await closePaneSlot(session, extra)
    }
    await focusGhosttySlot(session, slot)
  }
  await nextChord(
    'CHORD_YEN',
    () => sendKey(session, { key: '¥', code: 'IntlYen', text: '¥', unmodifiedText: '¥', windowsVirtualKeyCode: 220, nativeVirtualKeyCode: 93 }),
    (hex) => hex.includes('c2a5') || hex.includes('1b5b313635')
  )
  await pollUntil('Chord probe did not restore the terminal', 6_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('CHORD_DONE') ? screen : null
  })

  await sendLine(session, 'python3 imemulti')
  await pollUntil('IME probe did not start', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('IME2_READY') ? screen : null
  })
  await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)}) || window
      const fire = (type, data) => node.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
      fire('compositionstart', '')
      fire('compositionupdate', 'ㅎ')
      fire('compositionupdate', '하')
      fire('compositionupdate', '한')
      return true
    })()`,
    5_000
  )
  const preedit = await pollUntil('IME preedit was not drawn', 4_000, async () => {
    const screen = await readScreen(handle)
    const dom = await evaluate(
      session,
      `(() => {
        const canvas = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
        if (!canvas) return null
        const rect = canvas.getBoundingClientRect()
        const node = [...document.querySelectorAll('body *')].find((entry) => {
          const text = entry.innerText || entry.textContent || ''
          if (!text.includes('한') && !text.includes('하') && !text.includes('ㅎ')) return false
          if (entry === canvas) return false
          const box = entry.getBoundingClientRect()
          return box.width > 0 && box.height > 0 && box.left >= rect.left - 2 && box.top >= rect.top - 2 && box.left <= rect.right && box.top <= rect.bottom
        })
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { text: (node.innerText || node.textContent || '').slice(0, 20), left: box.left, top: box.top }
      })()`,
      5_000
    )
    if (!dom) return null
    return { screen: screen.includes('한') || screen.includes('하') || screen.includes('ㅎ'), dom }
  })
  console.log(`IME_PREEDIT ${JSON.stringify(preedit)}`)
  await evaluate(
    session,
    `(() => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
      Object.defineProperty(event, 'keyCode', { get: () => 229 })
      Object.defineProperty(event, 'isComposing', { get: () => true })
      window.dispatchEvent(event)
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)}) || window
      window.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }))
      return true
    })()`,
    5_000
  )
  const imeHex = await pollUntil('IME commit did not reach the PTY', 6_000, async () => {
    const match = String(await readScreen(handle)).match(/IME2HEX ([0-9a-f]+)/)
    return match ? match[1] : null
  })
  if (imeHex.includes('0d') || imeHex.split('ed959c').length - 1 !== 1) {
    throw new Error(`IME commit was not one syllable without CR: ${imeHex}`)
  }
  console.log(`IME_MULTI ${imeHex}`)

  await sendLine(session, 'python3 fillprobe')
  await pollUntil('Fill probe did not paint', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('SCROLLBOT') ? screen : null
  })
  const beforeWheel = tailLines(await readScreen(handle))
  const rect = await ghosttyRect(session, slot)
  if (!rect) {
    throw new Error('Wheel canvas was not available')
  }
  await wheelAt(session, rect, -480)
  const afterWheel = await pollUntil('Wheel did not scroll the viewport', 6_000, async () => {
    const lines = tailLines(await readScreen(handle))
    const hadBottom = beforeWheel.some((line) => line.includes('SCROLLBOT'))
    const hasBottom = lines.some((line) => line.includes('SCROLLBOT'))
    if (hadBottom && !hasBottom) return lines
    return null
  })
  if (afterWheel.some((line) => line.includes('WHEELHEX'))) {
    throw new Error('Wheel over the shell inserted mouse text')
  }
  console.log('WHEEL_SCROLL viewport')
  const barBefore = await evaluate(
    session,
    `(() => {
      const slider = document.querySelector('.orca-terminal-scrollbar .orca-terminal-slider')
      if (!slider) return null
      return { top: slider.style.top || '', display: slider.parentElement ? slider.parentElement.style.display : '' }
    })()`,
    5_000
  )
  await wheelAt(session, rect, 480)
  const barAfter = await pollUntil('Scrollbar did not follow the viewport', 4_000, async () => {
    const slider = await evaluate(
      session,
      `(() => {
        const track = document.querySelector('.orca-terminal-scrollbar')
        const slider = document.querySelector('.orca-terminal-scrollbar .orca-terminal-slider')
        if (!track || !slider) return null
        return { top: slider.style.top || '0px', display: track.style.display || '' }
      })()`,
      5_000
    )
    if (!slider) return null
    if (barBefore && slider.top === barBefore.top && slider.display === barBefore.display) return null
    return slider
  })
  console.log(`SCROLLBAR ${JSON.stringify(barBefore)} -> ${JSON.stringify(barAfter)}`)

  await sendLine(session, 'python3 wheelprobe')
  await pollUntil('Mouse tracking probe did not start', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('WHEEL_READY') ? screen : null
  })
  const trackRect = (await ghosttyRect(session, slot)) || rect
  await wheelAt(session, trackRect, 120)
  const wheelHex = await pollUntil('Tracking wheel did not report', 6_000, async () => {
    const lines = [...String(await readScreen(handle)).matchAll(/WHEELHEX ([0-9a-f]+)/g)].map((match) => match[1])
    return lines[0] || null
  })
  if (!wheelHex.startsWith('1b5b3c')) {
    throw new Error(`Tracking wheel was not an SGR report: ${wheelHex}`)
  }
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: trackRect.x + 24, y: trackRect.y + 24, button: 'left', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: trackRect.x + 24, y: trackRect.y + 24, button: 'left', clickCount: 1 },
    15_000
  )
  const clickHex = await pollUntil('Tracking click did not report', 6_000, async () => {
    const lines = [...String(await readScreen(handle)).matchAll(/WHEELHEX ([0-9a-f]+)/g)].map((match) => match[1])
    return lines[1] || null
  })
  if (!clickHex.startsWith('1b5b3c')) {
    throw new Error(`Tracking click was not an SGR report: ${clickHex}`)
  }
  console.log(`WHEEL_SGR ${wheelHex} ${clickHex}`)
  await sendKey(session, { key: 'z', code: 'KeyZ', text: 'z', unmodifiedText: 'z', windowsVirtualKeyCode: 90, nativeVirtualKeyCode: 6 })
  const hiddenCursor = await pollUntil('Pointer did not hide while typing', 4_000, async () => {
    const cursor = await evaluate(
      session,
      `(() => {
        const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
        let el = node
        while (el) {
          const value = getComputedStyle(el).cursor
          if (value && value !== 'auto') return value
          el = el.parentElement
        }
        return ''
      })()`,
      5_000
    )
    return cursor === 'none' ? cursor : null
  })
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: rect.x + 30, y: rect.y + 30, button: 'none' },
    15_000
  )
  const shownCursor = await pollUntil('Pointer stayed hidden after the mouse moved', 4_000, async () => {
    const cursor = await evaluate(
      session,
      `(() => {
        const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
        let el = node
        while (el) {
          const value = getComputedStyle(el).cursor
          if (value && value !== 'auto') return value
          el = el.parentElement
        }
        return 'auto'
      })()`,
      5_000
    )
    return cursor === 'none' ? null : cursor
  })
  console.log(`POINTER_CURSOR ${hiddenCursor} ${shownCursor}`)

  const copyMarker = await dragReadSelection(session, slot)
  if (!String(copyMarker).includes('HORCA') && !String(copyMarker).includes('SCROLL')) {
    throw new Error(`Shortcut copy selection was empty: ${JSON.stringify(copyMarker).slice(0, 120)}`)
  }
  writeClipboard('REPLACE_ME')
  await sendKey(session, { key: 'c', code: 'KeyC', modifiers: 4, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8 })
  const shortcutCopied = await pollUntil('Shortcut copy did not reach the clipboard', 4_000, async () => {
    const copied = readClipboard()
    return copied && copied !== 'REPLACE_ME' ? copied : null
  })
  if (shortcutCopied.trim() !== String(copyMarker).trim()) {
    throw new Error(`Shortcut copy clipboard did not match the selection: ${JSON.stringify(shortcutCopied).slice(0, 120)}`)
  }
  console.log('COPY_SHORTCUT matched')
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: rect.x + 8, y: rect.y + 8, button: 'left', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: rect.x + 8, y: rect.y + 8, button: 'left', clickCount: 1 },
    15_000
  )
  writeClipboard('KEEPCLIP')
  await sendKey(session, { key: 'c', code: 'KeyC', modifiers: 4, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8 })
  const kept = readClipboard()
  if (kept.trim() !== 'KEEPCLIP') {
    throw new Error(`Empty selection copy changed the clipboard: ${JSON.stringify(kept).slice(0, 120)}`)
  }
  console.log('COPY_SHORTCUT empty-kept')

  await runBracketedPaste(session, handle, async () => {
    await evaluate(session, `window.dispatchEvent(new Event('orca-app-menu-paste'))`, 5_000)
  })
  console.log('PASTE_MENU PASTE_OK')
  await runBracketedPaste(session, handle, async () => {
    await openContextMenu(session, slot)
    const clicked = await pollUntil('Paste menu item did not open', 4_000, () => clickLabeledControl(session, 'Paste'))
    if (!clicked) {
      throw new Error('Paste menu item was not clickable')
    }
  })
  console.log('PASTE_CONTEXT PASTE_OK')
  await runBracketedPaste(session, handle, async () => {
    await passthruCall(session, slot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
  })
  console.log('PASTE_PROGRAMMATIC PASTE_OK')

  await keepGhosttyCanvases(session, 1)
  const startup = runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'python3 startupprobe',
    '--focus',
    '--json'
  ])
  const startupHandle = startup?.result?.terminal?.handle
  if (!startupHandle) {
    throw new Error('Startup paste probe did not return a terminal handle')
  }
  const startupVerdict = await pollUntil('Startup paste was not bracketed', 8_000, async () => {
    const screen = await readScreen(startupHandle)
    if (screen.includes('STARTUP_OK')) return 'STARTUP_OK'
    if (screen.includes('STARTUP_BAD')) return screen.slice(screen.indexOf('STARTUP_BAD'), screen.indexOf('STARTUP_BAD') + 140)
    return null
  })
  if (startupVerdict !== 'STARTUP_OK') {
    throw new Error(`Startup command paste was not bracketed: ${startupVerdict}`)
  }
  console.log('PASTE_STARTUP STARTUP_OK')
  await closeNewestTerminalTab(session)
  await focusGhosttySlot(session, slot)

  await sendLine(session, 'python3 osc52probe')
  await pollUntil('OSC 52 did not change the clipboard', 6_000, async () => {
    return readClipboard().includes('OSC52HORCA') ? readClipboard() : null
  })
  const oscToast = await pollUntil('OSC 52 toast did not appear', 4_000, async () => {
    const text = await evaluate(
      session,
      `(() => {
        const nodes = [...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')]
        return nodes.map((node) => (node.innerText || '').trim()).filter(Boolean).join(' | ')
      })()`,
      5_000
    )
    return text ? text : null
  })
  console.log(`OSC52_CLIPBOARD OSC52HORCA ${String(oscToast).slice(0, 80)}`)
  const setting = await evaluate(
    session,
    `(() => {
      const node = document.querySelector('#terminal-osc52-clipboard, [data-setting-id="terminal-osc52-clipboard"], [name="terminal-osc52-clipboard"]')
      if (!node) return false
      if ('checked' in node && node.checked) node.click()
      return true
    })()`,
    5_000
  )
  if (!setting) {
    throw new Error('OSC 52 setting control was not on the packaged surface')
  }
  writeClipboard('OSC52HELD')
  await sendLine(session, 'python3 osc52off')
  const held = await pollUntil('OSC 52 off-state did not finish', 6_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('OSC52_OFF_WROTE') ? readClipboard() : null
  })
  if (String(held).includes('OSC52OFF')) {
    throw new Error(`OSC 52 wrote the clipboard while the setting was off: ${JSON.stringify(held).slice(0, 80)}`)
  }
  console.log('OSC52_OFF held')

  await sendKey(session, { key: 'f', code: 'KeyF', modifiers: 4, windowsVirtualKeyCode: 70, nativeVirtualKeyCode: 3 })
  await pollUntil('Find bar did not open', 4_000, async () => {
    const open = await evaluate(session, `Boolean(document.querySelector('[data-terminal-search-root]'))`, 5_000)
    return open ? true : null
  })
  await evaluate(
    session,
    `(() => {
      const field = document.querySelector('[data-terminal-search-root] input')
      if (!field) return false
      field.focus()
      field.value = 'SEARCHHORCA'
      field.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
    5_000
  )
  const found = await passthruCall(session, slot, `return api.search ? api.search(slot, 'SEARCHHORCA', 'next') : false`)
  if (!found) {
    throw new Error('Search did not match SEARCHHORCA')
  }
  if (!(await clickLabeledControl(session, 'Next match'))) {
    throw new Error('Next match was not clickable')
  }
  const foundAgain = await passthruCall(session, slot, `return api.search ? api.search(slot, 'SEARCHHORCA', 'next') : false`)
  if (!(await clickLabeledControl(session, 'Previous match'))) {
    throw new Error('Previous match was not clickable')
  }
  const foundPrev = await passthruCall(session, slot, `return api.search ? api.search(slot, 'SEARCHHORCA', 'previous') : false`)
  if (!foundAgain || !foundPrev) {
    throw new Error(`Search next/previous failed: next=${foundAgain} previous=${foundPrev}`)
  }
  if (!(await clickLabeledControl(session, 'Case sensitive'))) {
    throw new Error('Case sensitive search control was not clickable')
  }
  if (!(await clickLabeledControl(session, 'Regex'))) {
    throw new Error('Regex search control was not clickable')
  }
  const bad = await evaluate(
    session,
    `(() => {
      try {
        const api = window.api && window.api.horcaGhosttyPassthru
        if (api && api.search) api.search(${JSON.stringify(slot)}, '(?', 'next')
        return 'ok'
      } catch (error) {
        return String(error)
      }
    })()`,
    5_000
  )
  if (bad !== 'ok') {
    throw new Error(`Bad search pattern threw: ${bad}`)
  }
  await sendKey(session, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53 })
  const searchClosed = await pollUntil('Find bar stayed open', 4_000, async () => {
    const open = await evaluate(session, `Boolean(document.querySelector('[data-terminal-search-root]'))`, 5_000)
    return open ? null : true
  })
  if (!searchClosed) {
    throw new Error('Find bar stayed open')
  }
  console.log('SEARCH_OUTPUT next previous case regex closed')

  await sendLine(session, 'python3 linkprobe')
  await pollUntil('Link probe did not paint', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('LINK_READY') ? screen : null
  })
  const linkRect = await ghosttyRect(session, slot)
  const links = await evaluate(
    session,
    `(() => {
      const api = window.api && window.api.horcaGhosttyPassthru
      const canvas = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!api || !api.hyperlinkAt || !canvas) return []
      const rect = canvas.getBoundingClientRect()
      const hits = []
      for (let y = 4; y < rect.height; y += 12) {
        for (let x = 4; x < Math.min(rect.width, 420); x += 28) {
          const uri = String(api.hyperlinkAt(${JSON.stringify(slot)}, x, y) || '')
          if (uri) hits.push({ x, y, uri })
        }
      }
      return hits
    })()`,
    15_000
  )
  const uris = (Array.isArray(links) ? links : []).map((hit) => hit.uri)
  const http = (Array.isArray(links) ? links : []).find((hit) => hit.uri.includes('http://127.0.0.1/HORCALINK'))
  const file = uris.find((uri) => uri.includes('linkfile'))
  const wrapped = uris.find((uri) => uri.includes('HORCAWRAP') && uri.includes('www'))
  const osc8 = uris.find((uri) => uri.includes('http://127.0.0.1/OSC8HORCA'))
  if (!http || !file || !wrapped || !osc8) {
    throw new Error(`Link hits missed http=${Boolean(http)} file=${Boolean(file)} wrapped=${Boolean(wrapped)} osc8=${Boolean(osc8)}`)
  }
  await evaluate(
    session,
    `(() => {
      window.__horcaOpened = []
      const orig = window.open
      window.open = (...args) => { window.__horcaOpened.push(String(args[0] || '')); return null }
      window.__horcaOpen = orig
      return true
    })()`,
    5_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'left', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'left', clickCount: 1 },
    15_000
  )
  const opened = await pollUntil('HTTP link did not open outside the app', 4_000, async () => {
    const value = await evaluate(session, `Array.isArray(window.__horcaOpened) ? window.__horcaOpened.join(',') : ''`, 5_000)
    return String(value).includes('http://127.0.0.1/HORCALINK') ? value : null
  })
  console.log(`LINK_HTTP ${opened}`)
  const fileHit = (Array.isArray(links) ? links : []).find((hit) => hit.uri.includes('linkfile'))
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: linkRect.x + fileHit.x, y: linkRect.y + fileHit.y, button: 'left', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: linkRect.x + fileHit.x, y: linkRect.y + fileHit.y, button: 'left', clickCount: 1 },
    15_000
  )
  await pollUntil('File link did not open in the editor', 6_000, async () => {
    const text = await evaluate(session, `document.body.innerText.slice(0, 2000)`, 5_000)
    return String(text).includes('linkfile') ? text : null
  })
  console.log('LINK_FILE linkfile')
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'none' },
    15_000
  )
  await pollUntil('Link hover did not show', 3_000, async () => {
    const text = await evaluate(session, `document.body.innerText`, 5_000)
    return String(text).includes('HORCALINK') ? true : null
  })
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: Math.max(0, linkRect.x - 20), y: Math.max(0, linkRect.y - 20), button: 'none' },
    15_000
  )
  await evaluate(
    session,
    `document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))`,
    5_000
  )
  const hoverCleared = await pollUntil('Link hover stayed after the pointer left', 3_000, async () => {
    const showing = await evaluate(
      session,
      `(() => {
        const nodes = [...document.querySelectorAll('[role="tooltip"], .terminal-link-tooltip, .xterm-hover')]
        return nodes.some((node) => (node.innerText || '').includes('HORCALINK') && node.style.display !== 'none')
      })()`,
      5_000
    )
    return showing ? null : true
  })
  if (!hoverCleared) {
    throw new Error('Link hover stayed after the pointer left')
  }
  console.log(`LINK_OUTPUT http file wrapped osc8`)

  const wide = tailLines(await readScreen(handle))
  const wideLength = wide.reduce((longest, line) => Math.max(longest, line.length), 0)
  if (!wide.some((line) => line.includes('HORCAWRAP'))) {
    throw new Error('Reflow line was not on the grid')
  }
  await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return 0
      node.style.width = '80px'
      node.style.maxWidth = '80px'
      node.style.flex = '0 0 80px'
      return node.getBoundingClientRect().width
    })()`,
    5_000
  )
  const wrappedScreen = await pollUntil('Narrow window did not wrap the long line', 6_000, async () => {
    const lines = tailLines(await readScreen(handle))
    if (!lines.some((line) => line.includes('HORCAWRAP'))) return null
    const longest = lines.reduce((length, line) => Math.max(length, line.length), 0)
    return longest < wideLength ? lines : null
  })
  await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return 0
      node.style.width = ''
      node.style.maxWidth = ''
      node.style.flex = ''
      return node.getBoundingClientRect().width
    })()`,
    5_000
  )
  const unwrapped = await pollUntil('Widened window did not unwrap the line', 6_000, async () => {
    const lines = tailLines(await readScreen(handle))
    if (!lines.some((line) => line.includes('HORCAWRAP'))) return null
    const longest = lines.reduce((length, line) => Math.max(length, line.length), 0)
    const wrappedLongest = wrappedScreen.reduce((length, line) => Math.max(length, line.length), 0)
    return longest > wrappedLongest ? lines : null
  })
  if (!unwrapped.some((line) => line.includes('HORCAWRAP'))) {
    throw new Error('Unwrapped viewport lost the long line')
  }
  console.log('REFLOW_OUTPUT wrap unwrap')

  await sendLine(session, 'python3 followprobe')
  await pollUntil('Follow probe did not start', 8_000, async () => {
    const lines = tailLines(await readScreen(handle))
    return lines.some((line) => line.includes('FOLLOWREADY')) ? lines : null
  })
  const followRect = await ghosttyRect(session, slot)
  if (!followRect) {
    throw new Error('Scroll canvas was not available')
  }
  await wheelAt(session, followRect, -800)
  await pollUntil('Scroll up did not leave the bottom', 4_000, async () => {
    const lines = tailLines(await readScreen(handle))
    return lines.some((line) => line.includes('FOLLOWREADY')) ? null : lines
  })
  const parkedOutput = await pollUntil('Output while scrolled up stayed on screen', 6_000, async () => {
    const screen = tailLines(await readScreen(handle))
    const output = await readOutput(handle)
    if (!output.includes('FOLLOWHORCA')) return null
    if (screen.some((line) => line.includes('FOLLOWHORCA'))) return null
    return output
  })
  if (!parkedOutput.includes('FOLLOWHORCA')) {
    throw new Error('Parked output was missing from the scrollback')
  }
  await wheelAt(session, followRect, 1600)
  await pollUntil('Returning to the bottom did not show the parked output', 6_000, async () => {
    const lines = tailLines(await readScreen(handle))
    return lines.some((line) => line.includes('FOLLOWHORCA')) ? lines : null
  })
  await sendLine(session, 'printf FOLLOWAGAIN')
  await pollUntil('Output at the bottom did not follow', 6_000, async () => {
    const lines = tailLines(await readScreen(handle))
    return lines.some((line) => line.includes('FOLLOWAGAIN')) ? lines : null
  })
  console.log('SCROLL_FOLLOW parked then followed')

  await sendLine(session, 'python3 sleepprobe')
  await pollUntil('Sleep probe did not start', 8_000, async () => {
    const screen = await readScreen(handle)
    return screen.includes('SLEEP_READY') ? screen : null
  })
  await sendKey(session, { key: 'c', code: 'KeyC', modifiers: 2, windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 8 })
  await sendLine(session, 'printf INTHORCA')
  const interrupted = await pollUntil('Ctrl-C did not return the prompt', 8_000, async () => {
    const screen = await readScreen(handle)
    if (screen.includes('SLEEP_DONE')) return 'SLEEP_DONE'
    return screen.includes('INTHORCA') ? screen : null
  })
  if (String(interrupted).includes('SLEEP_DONE')) {
    throw new Error('Ctrl-C left sleep running until it finished')
  }
  console.log('CTRL_C_PROMPT INTHORCA')

  await sendLine(session, 'python3 cwdprobe')
  const parentCwd = await pollUntil('Parent cwd was not printed', 6_000, async () => {
    const match = String(await readScreen(handle)).match(/CWDHORCA (\S+)/)
    return match ? match[1] : null
  })
  const beforeSplit = await ghosttyCanvasCount(session)
  if (!(await clickLabeledControl(session, 'Split Terminal Right'))) {
    throw new Error('Split Terminal Right was not clickable')
  }
  await pollUntil('Split did not add a surface', 12_000, async () => {
    const count = await ghosttyCanvasCount(session)
    return count > beforeSplit ? count : null
  })
  const splitSlot = (await ghosttySlots(session)).find((item) => item !== slot)
  if (!splitSlot) {
    throw new Error('Split did not create a second Ghostty slot')
  }
  await focusGhosttySlot(session, splitSlot)
  await sendLine(session, 'python3 cwdprobe')
  const childCwd = await pollUntil('Split pane cwd was not printed', 8_000, async () => {
    const selected = await dragReadSelection(session, splitSlot)
    const match = String(selected).match(/CWDHORCA (\S+)/)
    return match ? match[1] : null
  })
  if (childCwd !== parentCwd) {
    throw new Error(`Split cwd did not match the parent: parent=${parentCwd} child=${childCwd}`)
  }
  await sendLine(session, 'printf ONLYFOCUS')
  const childSawFocus = await pollUntil('Focused pane did not echo its key', 6_000, async () => {
    const selected = await dragReadSelection(session, splitSlot)
    return String(selected).includes('ONLYFOCUS') ? selected : null
  })
  const parentSawFocus = await readScreen(handle)
  if (parentSawFocus.includes('ONLYFOCUS') || !String(childSawFocus).includes('ONLYFOCUS')) {
    throw new Error('A key reached a pane that was not focused')
  }
  const widthsBefore = await evaluate(
    session,
    `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
    5_000
  )
  const divider = await evaluate(
    session,
    `(() => {
      const node = document.querySelector('.pane-divider')
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return { x: rect.x + rect.width / 2, y: rect.y + Math.min(40, rect.height / 2) }
    })()`,
    5_000
  )
  if (!divider) {
    throw new Error('Split divider was not available')
  }
  await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: divider.x, y: divider.y, button: 'left', clickCount: 1 }, 15_000)
  await session.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: divider.x + 80, y: divider.y, button: 'left' }, 15_000)
  await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 1 }, 15_000)
  const widthsDragged = await pollUntil('Divider drag did not reflow both panes', 6_000, async () => {
    const widths = await evaluate(
      session,
      `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
      5_000
    )
    if (!Array.isArray(widths) || widths.length < 2) return null
    if (!Array.isArray(widthsBefore) || widthsBefore.length < 2) return null
    const changed = widths.filter((width, index) => width !== widthsBefore[index])
    return changed.length >= 2 ? widths : null
  })
  await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 2 }, 15_000)
  await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 2 }, 15_000)
  const widthsEqual = await pollUntil('Equalize did not match the pane widths', 4_000, async () => {
    const widths = await evaluate(
      session,
      `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
      5_000
    )
    if (!Array.isArray(widths) || widths.length < 2) return null
    return Math.abs(widths[0] - widths[1]) < 48 ? widths : null
  })
  console.log(`MULTIPANE_CWD ${parentCwd} widths ${JSON.stringify(widthsDragged)} equal ${JSON.stringify(widthsEqual)}`)
  await closePaneSlot(session, splitSlot)
  await focusGhosttySlot(session, slot)
  await keepGhosttyCanvases(session, 1)
  if (!(await clickLabeledControl(session, 'New tab'))) {
    throw new Error('New tab was not clickable for reorder')
  }
  if (!(await pollUntil('New Terminal did not open for reorder', 4_000, () => clickLabeledControl(session, 'New Terminal')))) {
    throw new Error('New Terminal was not clickable for reorder')
  }
  await pollUntil('Reorder tab did not add a surface', 12_000, async () => {
    const count = await ghosttyCanvasCount(session)
    return count === 2 ? count : null
  })
  const orderBefore = await ghosttySlots(session)
  const tab = await pollUntil('Reorder tabs were not on the strip', 4_000, async () =>
    evaluate(
      session,
      `(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')].filter((node) => node.getBoundingClientRect().width > 2)
        if (tabs.length < 2) return null
        const rect = tabs[tabs.length - 1].getBoundingClientRect()
        const first = tabs[0].getBoundingClientRect()
        return { fromX: rect.x + rect.width / 2, fromY: rect.y + rect.height / 2, toX: first.x + 8, toY: first.y + first.height / 2, labels: tabs.map((node) => (node.innerText || '').trim().slice(0, 40)) }
      })()`,
      5_000
    )
  )
  await session.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: tab.fromX, y: tab.fromY, button: 'left', clickCount: 1 }, 15_000)
  await session.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tab.toX, y: tab.toY, button: 'left' }, 15_000)
  await session.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tab.toX, y: tab.toY, button: 'left', clickCount: 1 }, 15_000)
  const orderAfter = await ghosttySlots(session)
  const labelsAfter = await evaluate(
    session,
    `[...document.querySelectorAll('[role="tab"]')].filter((node) => node.getBoundingClientRect().width > 2).map((node) => (node.innerText || '').trim().slice(0, 40))`,
    5_000
  )
  if (JSON.stringify(labelsAfter) === JSON.stringify(tab.labels) && JSON.stringify(orderAfter) === JSON.stringify(orderBefore)) {
    throw new Error('Pane drag did not reorder the tabs')
  }
  console.log('MULTIPANE_REORDER')
  await closeNewestTerminalTab(session)
  await focusGhosttySlot(session, slot)

  await keepGhosttyCanvases(session, 1)
  if (!(await clickLabeledControl(session, 'New tab'))) {
    throw new Error('New tab button was not clickable for an agent pane')
  }
  const agentLabel = await pollUntil('Agent menu item did not open', 4_000, async () => {
    const label = await evaluate(
      session,
      `(() => {
        const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) => /agent/i.test(entry.innerText || ''))
        return item ? (item.innerText || '').trim().split('\\n')[0].trim() : ''
      })()`,
      5_000
    )
    return label || null
  })
  if (!(await clickLabeledControl(session, agentLabel))) {
    throw new Error(`Agent menu item was not clickable: ${agentLabel}`)
  }
  const agentSlot = await pollUntil('Agent pane did not add a surface', 12_000, async () => {
    const extra = (await ghosttySlots(session)).find((item) => item !== slot)
    return extra || null
  })
  await focusGhosttySlot(session, agentSlot)
  await sendLine(session, 'python3 pasteprobe')
  const agentHandle = await pollUntil('Agent pane did not publish a handle', 8_000, async () => {
    await openContextMenu(session, agentSlot)
    if (!(await clickLabeledControl(session, 'Copy Terminal ID'))) return null
    const copied = readClipboard().trim()
    return /^term_[0-9a-f-]+$/.test(copied) ? copied : null
  })
  writeClipboard('PASTE_HORCA')
  await passthruCall(session, agentSlot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
  const agentPaste = await pollUntil('Agent paste was not bracketed', 6_000, async () => {
    const screen = await readScreen(agentHandle)
    if (screen.includes('PASTE_OK')) return 'PASTE_OK'
    if (screen.includes('PASTE_BAD')) return screen.slice(0, 160)
    return null
  })
  if (agentPaste !== 'PASTE_OK') {
    throw new Error(`Agent pane paste was not bracketed: ${agentPaste}`)
  }
  console.log('PASTE_AGENT PASTE_OK')
  await closeNewestTerminalTab(session)
  await focusGhosttySlot(session, slot)

  await keepGhosttyCanvases(session, 1)
  const ssh = runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'python3 sshprobe',
    '--focus',
    '--json'
  ])
  const sshHandle = ssh?.result?.terminal?.handle
  if (!sshHandle) {
    throw new Error('SSH probe did not return a terminal handle')
  }
  await pollUntil('SSH paste probe did not start', 8_000, async () => {
    const screen = await readScreen(sshHandle)
    return screen.includes('SSH_READY') ? screen : null
  })
  const sshSlot = (await ghosttySlots(session)).find((item) => item !== slot) || slot
  await focusGhosttySlot(session, sshSlot)
  writeClipboard('PASTE_HORCA')
  await passthruCall(session, sshSlot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
  const sshPaste = await pollUntil('SSH paste was not bracketed', 6_000, async () => {
    const screen = await readScreen(sshHandle)
    if (screen.includes('PASTE_OK')) return 'PASTE_OK'
    if (screen.includes('PASTE_BAD')) return screen.slice(0, 160)
    return null
  })
  if (sshPaste !== 'PASTE_OK') {
    throw new Error(`SSH pane paste was not bracketed: ${sshPaste}`)
  }
  console.log('PASTE_SSH PASTE_OK')
  await pollUntil('SSH drop was not observed', 8_000, async () => {
    const screen = await readScreen(sshHandle)
    return screen.includes('SSHDROPPED') ? screen : null
  })
  const reconnect = await pollUntil('SSH reconnect overlay did not show', 6_000, async () => {
    const marker = await evaluate(
      session,
      `(() => {
        const banner = document.querySelector('[data-terminal-remote-runtime-reconnect-banner]')
        if (banner) return banner.getAttribute('data-terminal-remote-runtime-reconnect-banner') || 'banner'
        const button = [...document.querySelectorAll('button')].find((entry) => /reconnect/i.test(entry.innerText || ''))
        return button ? 'button' : ''
      })()`,
      5_000
    )
    return marker || null
  })
  if (!(await clickLabeledControl(session, 'Reconnect'))) {
    throw new Error(`SSH reconnect control was not clickable: ${reconnect}`)
  }
  const restoredSsh = await pollUntil('SSH reconnect did not keep the scrollback', 8_000, async () => {
    const screen = await readScreen(sshHandle)
    return screen.includes('SSHSCROLLHORCA') ? screen : null
  })
  await focusGhosttySlot(session, sshSlot)
  await sendKey(session, { key: 'q', code: 'KeyQ', text: 'q', unmodifiedText: 'q', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 12 })
  await pollUntil('SSH reconnect did not accept a key', 6_000, async () => {
    const screen = await readScreen(sshHandle)
    return screen.includes('q') ? screen : null
  })
  console.log(`SSH_RECONNECT ${reconnect} ${restoredSsh.includes('SSHSCROLLHORCA')}`)
  await closeNewestTerminalTab(session)
  await focusGhosttySlot(session, slot)
  if ((await ghosttyCanvasCount(session)) > 2) {
    await keepGhosttyCanvases(session, 2)
  }
}

const assignedPort = await reservePort()
let app = spawn(
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
  let session = openCdp(page.webSocketDebuggerUrl)
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
  try {
    execFileSync('osascript', ['-e', 'tell application "Horca" to activate'], { stdio: 'ignore' })
  } catch {
    void 0
  }
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1 },
    15_000
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
    15_000
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
    15_000
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
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: canvas.x + 140, y: dragY, button: 'left' },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: canvas.x + 140, y: dragY, button: 'left', clickCount: 1 },
      15_000
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
  writeFileSync(join(worktreePath, 'imeprobe'), IME_SOURCE)
  writeFileSync(join(worktreePath, 'exitprobe'), EXIT_SOURCE)
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
  await sendLine(session, 'python3 imeprobe')
  const imeReadyDeadline = Date.now() + 8_000
  let imeScreen = ''
  while (Date.now() < imeReadyDeadline) {
    imeScreen = await readScreen(handle)
    if (imeScreen.includes('IME_READY')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!imeScreen.includes('IME_READY')) {
    throw new Error(`IME probe did not start: ${imeScreen.slice(0, 800)}`)
  }
  await evaluate(
    session,
    `window.dispatchEvent(new CompositionEvent('compositionend', { data: '你', bubbles: true }))`,
    5_000
  )
  const imeDeadline = Date.now() + 6_000
  let imeHex = ''
  while (Date.now() < imeDeadline) {
    imeScreen = await readScreen(handle)
    const match = String(imeScreen).match(/IMEHEX ([0-9a-f]+)/)
    if (match) {
      imeHex = match[1]
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (imeHex !== 'e4bda0') {
    throw new Error(`compositionend did not write 你 as e4bda0: ${imeHex || imeScreen.slice(0, 800)}`)
  }
  console.log(`IME_OUTPUT ${imeHex}`)
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
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: canvas.x + 24, y: canvas.y + 24, button: 'left', clickCount: 1 },
    15_000
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
  let copySelection = ''
  for (const rowOffset of [8, 28, 48, 68, 88, 108]) {
    const dragY = canvas.y + rowOffset
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: canvas.x + 4, y: dragY, button: 'left', clickCount: 1 },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: canvas.x + 140, y: dragY, button: 'left' },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: canvas.x + 140, y: dragY, button: 'left', clickCount: 1 },
      15_000
    )
    copySelection = await evaluate(
      session,
      `(() => {
        const api = window.api && window.api.horcaGhosttyPassthru
        if (!api || typeof api.readSelection !== 'function') return ''
        return String(api.readSelection(${JSON.stringify(canvas.slot)}))
      })()`,
      5_000
    )
    if (String(copySelection).includes('HORCA')) {
      break
    }
  }
  if (!String(copySelection).includes('HORCA')) {
    throw new Error(`Copy selection did not include HORCA: ${JSON.stringify(copySelection)}`)
  }
  const openedCopyMenu = await evaluate(
    session,
    `(() => {
      const node = document.querySelector('canvas[data-ghostty="${canvas.slot}"]')
      if (!node) return false
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.x + 20,
        clientY: rect.y + 20
      }))
      return true
    })()`,
    5_000
  )
  if (!openedCopyMenu) {
    throw new Error('Selection canvas was not available for Copy')
  }
  const copyMenuDeadline = Date.now() + 4_000
  let sawCopy = false
  while (Date.now() < copyMenuDeadline) {
    sawCopy = Boolean(
      await evaluate(
        session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').trim().split('\\n')[0].trim() === 'Copy')`,
        5_000
      )
    )
    if (sawCopy) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawCopy) {
    throw new Error('Copy menu item did not open')
  }
  const copyClicked = await evaluate(
    session,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
        (entry.innerText || '').trim().split('\\n')[0].trim() === 'Copy'
      )
      if (!item) return false
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      item.click()
      return true
    })()`,
    5_000
  )
  if (!copyClicked) {
    throw new Error('Copy menu item was not clickable')
  }
  const copyDeadline = Date.now() + 4_000
  let copied = ''
  while (Date.now() < copyDeadline) {
    try {
      copied = execFileSync('pbpaste', { encoding: 'utf8' })
    } catch {
      copied = ''
    }
    if (copied.includes('HORCA')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!copied.includes('HORCA')) {
    throw new Error(`Copy menu did not put HORCA on the clipboard: ${JSON.stringify(copied).slice(0, 200)}`)
  }
  console.log('CHROME_COPY HORCA')
  const openedIdMenu = await evaluate(
    session,
    `(() => {
      const node = document.querySelector('canvas[data-ghostty="${canvas.slot}"]')
      if (!node) return false
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.x + 20,
        clientY: rect.y + 20
      }))
      return true
    })()`,
    5_000
  )
  if (!openedIdMenu) {
    throw new Error('Terminal ID canvas was not available')
  }
  const idMenuDeadline = Date.now() + 4_000
  let sawTerminalId = false
  while (Date.now() < idMenuDeadline) {
    sawTerminalId = Boolean(
      await evaluate(
        session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').includes('Copy Terminal ID'))`,
        5_000
      )
    )
    if (sawTerminalId) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawTerminalId) {
    throw new Error('Copy Terminal ID menu item did not open')
  }
  const idClicked = await evaluate(
    session,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
        (entry.innerText || '').includes('Copy Terminal ID')
      )
      if (!item) return false
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      item.click()
      return true
    })()`,
    5_000
  )
  if (!idClicked) {
    throw new Error('Copy Terminal ID menu item was not clickable')
  }
  const idDeadline = Date.now() + 4_000
  let copiedId = ''
  while (Date.now() < idDeadline) {
    try {
      copiedId = execFileSync('pbpaste', { encoding: 'utf8' }).trim()
    } catch {
      copiedId = ''
    }
    if (/^term_[0-9a-f-]+$/.test(copiedId)) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!/^term_[0-9a-f-]+$/.test(copiedId)) {
    throw new Error(`Copy Terminal ID did not put a terminal handle on the clipboard: ${JSON.stringify(copiedId).slice(0, 200)}`)
  }
  console.log(`CHROME_TERMINAL_ID ${copiedId}`)
  const copyMenuOpen = async () =>
    Boolean(
      await evaluate(
        session,
        `[...document.querySelectorAll('[role="menu"][data-state="open"]')].some((menu) => (menu.innerText || '').includes('Copy'))`,
        5_000
      )
    )
  if (!(await copyMenuOpen())) {
    await evaluate(
      session,
      `(() => {
        const node = document.querySelector('canvas[data-ghostty="${canvas.slot}"]')
        if (!node) return false
        const rect = node.getBoundingClientRect()
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: rect.x + 20,
          clientY: rect.y + 20
        }))
        return true
      })()`,
      5_000
    )
  }
  const dismissSeenDeadline = Date.now() + 3_000
  while (Date.now() < dismissSeenDeadline && !(await copyMenuOpen())) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  if (!(await copyMenuOpen())) {
    throw new Error('Context menu was not open for dismiss')
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  const dismissedByChrome = await evaluate(
    session,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((entry) =>
        (entry.getAttribute('aria-label') || entry.innerText || '').trim() === 'Go back'
      )
      if (!button) return false
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      return true
    })()`,
    5_000
  )
  if (!dismissedByChrome) {
    throw new Error('Context menu dismiss control was missing')
  }
  const dismissDeadline = Date.now() + 3_000
  let menuStillOpen = true
  while (Date.now() < dismissDeadline) {
    menuStillOpen = await copyMenuOpen()
    if (!menuStillOpen) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  if (menuStillOpen) {
    throw new Error('Context menu did not dismiss')
  }
  console.log('CHROME_DISMISS closed')
  await evaluate(
    session,
    `document.querySelector('canvas[data-ghostty="${canvas.slot}"]')?.focus()`,
    5_000
  )
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
  let pasteVerdict = ''
  while (Date.now() < pasteDeadline) {
    pasteScreen = await readScreen(handle)
    if (String(pasteScreen).includes('PASTE_OK')) {
      pasteVerdict = 'PASTE_OK'
      break
    }
    if (String(pasteScreen).includes('PASTE_SPLIT')) {
      pasteVerdict = 'PASTE_SPLIT'
      break
    }
    const badAt = String(pasteScreen).indexOf('PASTE_BAD')
    if (badAt >= 0) {
      pasteVerdict = String(pasteScreen).slice(badAt, badAt + 120)
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (pasteVerdict !== 'PASTE_OK') {
    throw new Error(`Paste did not reach the PTY as bracketed text: ${pasteVerdict || pasteScreen.slice(0, 800)}`)
  }
  console.log('PASTE_OUTPUT PASTE_OK')
  await probePackagedBehaviors({
    session,
    handle,
    slot: canvas.slot,
    worktreePath,
    worktreeSelector
  })
  let gridCleared = false
  await sendLine(session, 'python3 screenprobe')
  const altDeadline = Date.now() + 15_000
  let sawAlt = false
  let sawPrimary = false
  let screenProbe = ''
  while (Date.now() < altDeadline) {
    screenProbe = `${await readScreen(handle)}\n${await readOutput(handle)}`
    if (screenProbe.includes('ALTSCREEN_HORCA')) {
      sawAlt = true
    }
    if (screenProbe.includes('PRIMARY_HORCA')) {
      sawPrimary = true
    }
    if (sawAlt && sawPrimary) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawAlt || !sawPrimary) {
    throw new Error(
      `Screen probe failed alt=${sawAlt} primary=${screenProbe.includes('PRIMARY_HORCA')} unicode=${screenProbe.includes('UNICODE_HORCA')}`
    )
  }
  console.log('SCREEN_OUTPUT alt primary')
  const promptMark = /clearmark|printf|zsh|┌|─|├|HORCA|❯/
  let earlyBefore = await dragReadSelection(session, canvas.slot)
  if (!promptMark.test(earlyBefore)) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
    earlyBefore = await dragReadSelection(session, canvas.slot)
  }
  if (promptMark.test(earlyBefore)) {
    console.log(`CHROME_CLEAR_SLOT ${canvas.slot}`)
    console.log(`CHROME_CLEAR_BEFORE ${JSON.stringify(earlyBefore).slice(0, 80)}`)
    if (!(await clickClearScreen(session, canvas.slot))) {
      throw new Error('Clear Screen menu item was not clickable')
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
    const earlyAfter = await dragReadSelection(session, canvas.slot)
    if (promptMark.test(earlyAfter)) {
      throw new Error(`Clear Screen left the Ghostty grid: ${JSON.stringify(earlyAfter).slice(0, 200)}`)
    }
    console.log(`CHROME_CLEAR grid-cleared selection=${JSON.stringify(earlyAfter).slice(0, 80)}`)
    gridCleared = true
  } else {
    console.log(`CHROME_CLEAR_MISS ${JSON.stringify(earlyBefore).slice(0, 120)}`)
  }
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
    beforeSize = await readOutput(handle)
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
  await evaluate(
    session,
    `(() => {
      const canvas = document.querySelector('canvas[data-ghostty]')
      if (!canvas) return false
      const rect = canvas.getBoundingClientRect()
      canvas.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: rect.x + 20,
        clientY: rect.y + 20,
        button: 2
      }))
      return true
    })()`,
    5_000
  )
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  const chrome = await evaluate(
    session,
    `(() => {
      const texts = []
      for (const el of document.querySelectorAll('button,[role="tab"],[role="menuitem"],[role="menu"],header')) {
        const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80)
        if (text) texts.push(el.tagName + ':' + text)
      }
      return texts.slice(0, 40)
    })()`,
    5_000
  )
  console.log(`CHROME_DOM ${JSON.stringify(chrome)}`)
  const closeTabCount = async () =>
    evaluate(
      session,
      `[...document.querySelectorAll('button')].filter((button) => (button.getAttribute('aria-label') || button.innerText || '').includes('Close tab Terminal')).length`,
      5_000
    )
  const clickLabeled = async (label) => {
    const point = await evaluate(
      session,
      `(() => {
        const wanted = ${JSON.stringify(label)}
        const el = [...document.querySelectorAll('button,[role="menuitem"]')].find((item) => {
          const text = (item.getAttribute('aria-label') || item.innerText || '').trim()
          return text === wanted || text.startsWith(wanted)
        })
        if (!el) return null
        const rect = el.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return null
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })()`,
      5_000
    )
    if (!point) {
      return false
    }
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 },
      15_000
    )
    await session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 },
      15_000
    )
    return true
  }
  const tabsBefore = Number(await closeTabCount())
  if (!(await clickLabeled('New tab'))) {
    throw new Error('New tab button was not clickable')
  }
  const menuDeadline = Date.now() + 4_000
  let openedTerminal = false
  while (Date.now() < menuDeadline) {
    openedTerminal = await clickLabeled('New Terminal')
    if (openedTerminal) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!openedTerminal) {
    throw new Error('New Terminal menu item did not open')
  }
  const tabDeadline = Date.now() + 8_000
  let tabsAfter = tabsBefore
  while (Date.now() < tabDeadline) {
    tabsAfter = Number(await closeTabCount())
    if (tabsAfter > tabsBefore) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (tabsAfter <= tabsBefore) {
    throw new Error(`New Terminal did not add a tab: before=${tabsBefore} after=${tabsAfter}`)
  }
  console.log(`CHROME_TAB ${tabsBefore} -> ${tabsAfter}`)
  const canvasCount = async () =>
    Number(
      await evaluate(
        session,
        `document.querySelectorAll('canvas[data-ghostty]').length`,
        5_000
      )
    )
  let canvasesBefore = await canvasCount()
  while (canvasesBefore >= 3) {
    const closed = await evaluate(
      session,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          (entry.getAttribute('aria-label') || '').startsWith('Close tab ')
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      5_000
    )
    if (!closed) {
      break
    }
    const trimDeadline = Date.now() + 8_000
    let trimmed = canvasesBefore
    while (Date.now() < trimDeadline) {
      await evaluate(
        session,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((entry) =>
            (entry.innerText || '').trim().startsWith('Stop and Close')
          )
          if (!button) return false
          button.click()
          return true
        })()`,
        5_000
      )
      trimmed = await canvasCount()
      if (trimmed < canvasesBefore) {
        break
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
    }
    if (trimmed >= canvasesBefore) {
      break
    }
    canvasesBefore = trimmed
    console.log(`CHROME_TRIM ${canvasesBefore}`)
  }
  if (!(await clickLabeled('Split Terminal Right'))) {
    throw new Error('Split Terminal Right was not clickable')
  }
  const splitDeadline = Date.now() + 20_000
  let canvasesAfter = canvasesBefore
  while (Date.now() < splitDeadline) {
    canvasesAfter = await canvasCount()
    if (canvasesAfter > canvasesBefore) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (canvasesAfter <= canvasesBefore) {
    throw new Error(
      `Split Terminal Right did not add a surface: before=${canvasesBefore} after=${canvasesAfter}`
    )
  }
  console.log(`CHROME_SPLIT ${canvasesBefore} -> ${canvasesAfter}`)
  const panePoint = await evaluate(
    session,
    `(() => {
      const canvas = [...document.querySelectorAll('canvas[data-ghostty]')].find((item) => {
        const rect = item.getBoundingClientRect()
        return rect.width >= 2 && rect.height >= 2
      })
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      return { x: rect.x + Math.min(30, rect.width / 2), y: rect.y + Math.min(40, rect.height / 2) }
    })()`,
    5_000
  )
  if (!panePoint) {
    throw new Error('No Ghostty canvas for the context menu')
  }
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: panePoint.x, y: panePoint.y, button: 'right', clickCount: 1 },
    15_000
  )
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: panePoint.x, y: panePoint.y, button: 'right', clickCount: 1 },
    15_000
  )
  const paneMenuDeadline = Date.now() + 4_000
  let sawClosePane = false
  while (Date.now() < paneMenuDeadline) {
    sawClosePane = Boolean(
      await evaluate(
        session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').trim().startsWith('Close Pane'))`,
        5_000
      )
    )
    if (sawClosePane) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawClosePane) {
    throw new Error('Close Pane menu item did not open')
  }
  const panesBeforeClose = await canvasCount()
  const closePaneClicked = await evaluate(
    session,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
        (entry.innerText || '').trim().startsWith('Close Pane')
      )
      if (!item) return false
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      item.click()
      return true
    })()`,
    5_000
  )
  if (!closePaneClicked) {
    throw new Error('Close Pane menu item was not clickable')
  }
  const paneCloseDeadline = Date.now() + 8_000
  let panesAfterClose = panesBeforeClose
  while (Date.now() < paneCloseDeadline) {
    await evaluate(
      session,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          (entry.innerText || '').trim().startsWith('Stop and Close')
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      5_000
    )
    panesAfterClose = await canvasCount()
    if (panesAfterClose < panesBeforeClose) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (panesAfterClose >= panesBeforeClose) {
    const dialogText = await evaluate(
      session,
      `document.body.innerText.slice(0, 400)`,
      5_000
    )
    throw new Error(
      `Close Pane did not remove a surface: before=${panesBeforeClose} after=${panesAfterClose} text=${JSON.stringify(dialogText)}`
    )
  }
  console.log(`CHROME_PANE_CLOSE ${panesBeforeClose} -> ${panesAfterClose}`)
  const closeLabels = async () =>
    evaluate(
      session,
      `[...document.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || '').filter((label) => label.startsWith('Close tab '))`,
      5_000
    )
  const clearLabelsBefore = gridCleared ? null : await closeLabels()
  const clearTerm = gridCleared ? null : runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'printf clearmarkhorca; cat',
    '--focus',
    '--json'
  ])
  const clearHandle = clearTerm?.result?.terminal?.handle
  if (!gridCleared && !clearHandle) {
    throw new Error('Clear probe did not return a terminal handle')
  }
  if (!gridCleared) {
  const clearLabelDeadline = Date.now() + 8_000
  let clearLabel = ''
  while (Date.now() < clearLabelDeadline) {
    const labels = await closeLabels()
    clearLabel = (Array.isArray(labels) ? labels : []).find((label) => !clearLabelsBefore.includes(label)) ?? ''
    if (clearLabel) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!clearLabel) {
    throw new Error('Clear probe did not add a terminal tab')
  }
  const openedClearMenu = await evaluate(
    session,
    `(() => {
      const visible = [...document.querySelectorAll('canvas[data-ghostty]')].filter((node) => {
        const rect = node.getBoundingClientRect()
        return rect.width >= 2 && rect.height >= 2
      })
      visible.sort((a, b) => {
        const slotOf = (node) => Number(String(node.getAttribute('data-ghostty') || '').replace('pane-', '')) || 0
        return slotOf(a) - slotOf(b)
      })
      const node = visible.at(-1)
      return node ? node.getAttribute('data-ghostty') : ''
    })()`,
    5_000
  )
  if (!openedClearMenu) {
    throw new Error('Clear Screen canvas was not available')
  }
  console.log(`CHROME_CLEAR_SLOT ${openedClearMenu}`)
  let clearBefore = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    clearBefore = await dragReadSelection(session, openedClearMenu, true)
    if (/clearmark|printf|zsh|┌|─|├|HORCA|❯/.test(clearBefore)) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }
  if (!/clearmark|printf|zsh|┌|─|├|HORCA|❯/.test(clearBefore)) {
    throw new Error(`Clear probe grid had no prompt: ${JSON.stringify(clearBefore).slice(0, 200)}`)
  }
  console.log(`CHROME_CLEAR_BEFORE ${JSON.stringify(clearBefore).slice(0, 80)}`)
  const openedClear = await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${openedClearMenu}"]`)})
      if (!node) return false
      const rect = node.getBoundingClientRect()
      node.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.x + Math.min(24, rect.width / 2),
        clientY: rect.y + Math.min(24, rect.height / 2)
      }))
      return true
    })()`,
    5_000
  )
  if (!openedClear) {
    throw new Error('Clear Screen canvas was not available')
  }
  const clearMenuDeadline = Date.now() + 4_000
  let sawClear = false
  while (Date.now() < clearMenuDeadline) {
    sawClear = Boolean(
      await evaluate(
        session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').trim().startsWith('Clear Screen'))`,
        5_000
      )
    )
    if (sawClear) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  if (!sawClear) {
    throw new Error('Clear Screen menu item did not open')
  }
  const clearClicked = await evaluate(
    session,
    `(() => {
      const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) =>
        (entry.innerText || '').trim().startsWith('Clear Screen')
      )
      if (!item) return false
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }))
      item.click()
      return true
    })()`,
    5_000
  )
  if (!clearClicked) {
    throw new Error('Clear Screen menu item was not clickable')
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 400))
  let clearText = ''
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clearText = await dragReadSelection(session, openedClearMenu, true)
    if (!/clearmark|printf|zsh|┌|─|├|HORCA|❯/.test(clearText)) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700))
  }
  if (/clearmark|printf|zsh|┌|─|├|HORCA|❯/.test(clearText)) {
    throw new Error(`Clear Screen left the Ghostty grid: ${JSON.stringify(clearText).slice(0, 200)}`)
  }
  console.log(`CHROME_CLEAR grid-cleared selection=${JSON.stringify(clearText).slice(0, 80)}`)
  }
  const busyLabelsBefore = await closeLabels()
  runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'cat',
    '--focus',
    '--json'
  ])
  const busyLabelDeadline = Date.now() + 8_000
  let busyLabel = ''
  while (Date.now() < busyLabelDeadline) {
    const labels = await closeLabels()
    busyLabel = (Array.isArray(labels) ? labels : []).find((label) => !busyLabelsBefore.includes(label)) ?? ''
    if (busyLabel) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!busyLabel) {
    throw new Error('Busy terminal did not add a tab')
  }
  const busyDeadline = Date.now() + 8_000
  let busyClicked = false
  while (Date.now() < busyDeadline) {
    busyClicked = Boolean(
      await evaluate(
        session,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((entry) =>
            (entry.getAttribute('aria-label') || '') === ${JSON.stringify(busyLabel)}
          )
          if (!button) return false
          button.click()
          return true
        })()`,
        5_000
      )
    )
    if (busyClicked) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!busyClicked) {
    throw new Error(`Busy close button was not clickable: ${busyLabel}`)
  }
  const busyConfirmDeadline = Date.now() + 8_000
  let sawStopAndClose = false
  while (Date.now() < busyConfirmDeadline) {
    sawStopAndClose = Boolean(
      await evaluate(
        session,
        `(() => {
          const button = [...document.querySelectorAll('button')].find((entry) =>
            (entry.innerText || '').trim().startsWith('Stop and Close')
          )
          if (!button) return false
          button.click()
          return true
        })()`,
        5_000
      )
    )
    if (sawStopAndClose) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!sawStopAndClose) {
    const dialogText = await evaluate(session, `document.body.innerText.slice(0, 300)`, 5_000)
    throw new Error(`Running cat close did not ask: ${JSON.stringify(dialogText)}`)
  }
  console.log('CHROME_CLOSE_DIALOG Stop and Close')
  const closesBefore = Number(await closeTabCount())
  const closeTabClicked = await evaluate(
    session,
    `(() => {
      const button = [...document.querySelectorAll('button')].filter((entry) =>
        (entry.getAttribute('aria-label') || entry.innerText || '').includes('Close tab Terminal')
      ).at(-1)
      if (!button) return false
      button.click()
      return true
    })()`,
    5_000
  )
  if (!closeTabClicked) {
    throw new Error('Close tab button was not clickable')
  }
  const closeDeadline = Date.now() + 8_000
  let closesAfter = closesBefore
  while (Date.now() < closeDeadline) {
    await evaluate(
      session,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          (entry.innerText || '').trim().startsWith('Stop and Close')
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      5_000
    )
    closesAfter = Number(await closeTabCount())
    if (closesAfter < closesBefore) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (closesAfter >= closesBefore) {
    const dialogText = await evaluate(session, `document.body.innerText.slice(0, 300)`, 5_000)
    throw new Error(
      `Close tab did not remove a terminal tab: before=${closesBefore} after=${closesAfter} text=${JSON.stringify(dialogText)}`
    )
  }
  console.log(`CHROME_CLOSE ${closesBefore} -> ${closesAfter}`)
  const exiting = runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'exec python3 exitprobe',
    '--json'
  ])
  const exitHandle = exiting?.result?.terminal?.handle
  if (!exitHandle) {
    throw new Error('Exit probe did not return a terminal handle')
  }
  const exitDeadline = Date.now() + 12_000
  let exitStatus = ''
  let exitScreen = ''
  while (Date.now() < exitDeadline) {
    const info = runCli(['terminal', 'read', '--terminal', exitHandle, '--json'])
    exitStatus = String(info?.result?.terminal?.status ?? '')
    exitScreen = JSON.stringify(info)
    if (exitStatus === 'exited') {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  if (exitStatus !== 'exited') {
    throw new Error(`Process exit was not observed: status=${exitStatus} ${exitScreen.slice(0, 500)}`)
  }
  console.log(`EXIT_OUTPUT ${exitStatus} marker=${exitScreen.includes('EXIT_MARKER')}`)
  const exitSlot = (await ghosttySlots(session)).at(-1)
  if (exitSlot) {
    await focusGhosttySlot(session, exitSlot)
  }
  if (!(await pollUntil('Exit overlay did not offer Restart', 6_000, () => clickLabeledControl(session, 'Restart')))) {
    throw new Error('Restart was not clickable')
  }
  const restartSlot = (await ghosttySlots(session)).at(-1) || exitSlot
  if (restartSlot) {
    await focusGhosttySlot(session, restartSlot)
  }
  await sendLine(session, 'printf RESTARTHORCA')
  await pollUntil('Restart did not yield a shell that echoes a key', 8_000, async () => {
    if (restartSlot) {
      const selected = await dragReadSelection(session, restartSlot)
      if (String(selected).includes('RESTARTHORCA')) return selected
    }
    const screen = await readScreen(exitHandle)
    return screen.includes('RESTARTHORCA') ? screen : null
  })
  console.log('EXIT_RESTART RESTARTHORCA')
  await keepGhosttyCanvases(session, 1)
  const restoreSlot = (await ghosttySlots(session))[0]
  if (!restoreSlot) {
    throw new Error('Relaunch probe had no Ghostty surface')
  }
  await focusGhosttySlot(session, restoreSlot)
  await openContextMenu(session, restoreSlot)
  if (!(await clickLabeledControl(session, 'Copy Terminal ID'))) {
    throw new Error('Relaunch pane did not copy a terminal id')
  }
  const restoreHandle = readClipboard().trim()
  if (!/^term_[0-9a-f-]+$/.test(restoreHandle)) {
    throw new Error(`Relaunch pane id was not a terminal handle: ${restoreHandle}`)
  }
  await sendLine(session, 'python3 relaunchprobe')
  await pollUntil('Relaunch marker was not on the grid', 8_000, async () => {
    const lines = tailLines(await readScreen(restoreHandle))
    return lines.some((line) => line.includes('RELAUNCHA')) ? lines : null
  })
  const restoreRect = await ghosttyRect(session, restoreSlot)
  if (!restoreRect) {
    throw new Error('Relaunch canvas was not available')
  }
  await wheelAt(session, restoreRect, -900)
  await pollUntil('Relaunch viewport did not stay up', 4_000, async () => {
    const lines = tailLines(await readScreen(restoreHandle))
    return lines.some((line) => line.includes('RELAUNCHA')) && !lines.some((line) => line.includes('HIDDENHORCA'))
      ? lines
      : null
  })
  const hiddenWhileUp = await pollUntil('Output while the pane was hidden was not in the scrollback', 6_000, async () => {
    const screen = tailLines(await readScreen(restoreHandle))
    const output = await readOutput(restoreHandle)
    if (!output.includes('HIDDENHORCA')) return null
    if (screen.some((line) => line.includes('HIDDENHORCA'))) return null
    return output
  })
  if (!hiddenWhileUp.includes('HIDDENHORCA')) {
    throw new Error('Hidden output was missing from the scrollback')
  }
  const companion = runCli([
    'terminal',
    'create',
    '--worktree',
    worktreeSelector,
    '--command',
    'printf RELAUNCHB',
    '--json'
  ])
  const companionHandle = companion?.result?.terminal?.handle
  if (!companionHandle) {
    throw new Error('Relaunch companion tab did not return a handle')
  }
  await pollUntil('Companion tab did not show its marker', 8_000, async () => {
    const screen = await readScreen(companionHandle)
    return screen.includes('RELAUNCHB') ? screen : null
  })
  if ((await ghosttyCanvasCount(session)) > 2) {
    throw new Error(`Relaunch left more than two Ghostty surfaces: ${await ghosttyCanvasCount(session)}`)
  }
  session.close()
  const exited = new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('Packaged Horca did not exit for relaunch')), 15_000)
    app.once('exit', (code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
  try {
    execFileSync('osascript', ['-e', 'tell application "Horca" to quit'], { stdio: 'ignore' })
  } catch {
    app.kill('SIGTERM')
  }
  await exited
  const relaunchPort = await reservePort()
  app = spawn(
    executablePath,
    ['--use-mock-keychain', `--remote-debugging-port=${relaunchPort}`, '--remote-allow-origins=*'],
    { env: launchEnvironment, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('Relaunched Horca did not publish a CDP endpoint')), 20_000)
    app.once('exit', (code) => {
      clearTimeout(timeout)
      rejectReady(new Error(`Relaunched Horca exited before CDP was ready: ${code}`))
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
  const relaunchPage = await waitForTargets(relaunchPort)
  session = openCdp(relaunchPage.webSocketDebuggerUrl)
  await session.call('Runtime.enable', {}, 10_000)
  await pollUntil('Relaunched renderer title is not Horca', 20_000, async () => {
    const title = await evaluate(session, 'document.title', 5_000)
    return title === 'Horca' ? title : null
  })
  await waitForRuntime()
  await pollUntil('Relaunch did not restore the scrolled viewport', 12_000, async () => {
    const screen = await readScreen(restoreHandle)
    const lines = tailLines(screen)
    if (!lines.some((line) => line.includes('RELAUNCHA'))) return null
    if (lines.some((line) => line.includes('HIDDENHORCA'))) return null
    return screen
  })
  const restoredHidden = await readOutput(restoreHandle)
  if (!restoredHidden.includes('HIDDENHORCA')) {
    throw new Error('Relaunch scrollback lost the hidden output')
  }
  const restoredCompanion = await readScreen(companionHandle)
  if (!restoredCompanion.includes('RELAUNCHB')) {
    throw new Error(`Relaunch did not restore the companion tab: ${restoredCompanion.slice(0, 300)}`)
  }
  const restoredSlot = (await ghosttySlots(session))[0]
  if (restoredSlot) {
    await focusGhosttySlot(session, restoredSlot)
  }
  await sendKey(session, { key: 'q', code: 'KeyQ', text: 'q', unmodifiedText: 'q', windowsVirtualKeyCode: 81, nativeVirtualKeyCode: 12 })
  await pollUntil('Restored shell did not accept a key', 8_000, async () => {
    const screen = await readScreen(restoreHandle)
    return screen.includes('q') ? screen : null
  })
  await pollUntil('Restored banner was not on the packaged surface', 6_000, async () => {
    const text = await evaluate(session, `document.body.innerText`, 5_000)
    return String(text).toLowerCase().includes('session restored') ? text : null
  })
  await evaluate(
    session,
    `(() => {
      const node = [...document.querySelectorAll('button, [role="button"]')].find((entry) =>
        /dismiss|close|got it/i.test(entry.innerText || entry.getAttribute('aria-label') || '')
      ) || [...document.querySelectorAll('*')].find((entry) => (entry.innerText || '').toLowerCase().includes('session restored'))
      if (!node) return false
      node.click()
      return true
    })()`,
    5_000
  )
  await pollUntil('Restored banner did not dismiss', 4_000, async () => {
    const text = await evaluate(session, `document.body.innerText`, 5_000)
    return String(text).toLowerCase().includes('session restored') ? null : true
  })
  console.log('RELAUNCH_OUTPUT tabs scrollback key')
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
