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
      'printf HORCA_D1_SMOKE; sleep 8',
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
  session.close()
  if (existsSync(join(home, '.orca'))) {
    throw new Error(`Horca created the official Orca state root: ${join(home, '.orca')}`)
  }
  console.log(
    'Packaged Horca smoke passed: title, renderer, Ghostty workbench, PTY marker, isolated state, no Herdr'
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
