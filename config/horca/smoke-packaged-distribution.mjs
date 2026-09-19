#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
      const hit = last.find((target) => target.type === 'page' && target.title === 'Horca')
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
const app = spawn(executablePath, [`--remote-debugging-port=${assignedPort}`, '--remote-allow-origins=*'], {
  env: launchEnvironment,
  stdio: ['ignore', 'ignore', 'pipe']
})

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
  const title = await evaluate(session, 'document.title', 10_000)
  console.log(`CDP document.title=${title}`)
  if (title !== 'Horca') {
    throw new Error(`Packaged renderer title is not Horca: ${title}`)
  }
  const ptyId = await evaluate(
    session,
    `window.api.pty.spawn({
      cols: 80,
      rows: 24,
      cwd: ${JSON.stringify(home)},
      env: { ORCA_PANE_KEY: 'horca-packaged-smoke:3f391f2e-5f1f-4ea4-8c0c-0f5e630a36ca' },
      command: 'printf HORCA_D1_SMOKE; sleep 5',
      worktreeId: 'global-floating-terminal',
      tabId: 'horca-packaged-smoke',
      leafId: '3f391f2e-5f1f-4ea4-8c0c-0f5e630a36ca'
    }).then((result) => result.id)`,
    20_000
  )
  if (typeof ptyId !== 'string' || ptyId.length === 0) {
    throw new Error(`Packaged terminal did not spawn: ${ptyId}`)
  }
  if (ptyId.startsWith('herdr:')) {
    throw new Error(`Packaged terminal used Herdr: ${ptyId}`)
  }
  await evaluate(
    session,
    `window.api.pty.setPtyDeliveryInterest(${JSON.stringify(ptyId)}, true)`,
    5_000
  )
  const deadline = Date.now() + 15_000
  let snapshot = ''
  while (Date.now() < deadline) {
    snapshot = await evaluate(
      session,
      `window.api.pty.getMainBufferSnapshot(${JSON.stringify(ptyId)}).then((result) => result?.data ?? '')`,
      5_000
    )
    if (String(snapshot).includes('HORCA_D1_SMOKE')) {
      break
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  if (!String(snapshot).includes('HORCA_D1_SMOKE')) {
    throw new Error('Packaged terminal did not print HORCA_D1_SMOKE')
  }
  await evaluate(
    session,
    `window.api.pty.setPtyDeliveryInterest(${JSON.stringify(ptyId)}, false).then(() => window.api.pty.kill(${JSON.stringify(ptyId)}))`,
    5_000
  )
  session.close()
  if (existsSync(join(home, '.orca'))) {
    throw new Error(`Horca created the official Orca state root: ${join(home, '.orca')}`)
  }
  console.log(
    'Packaged Horca smoke passed: title, renderer, D1 PTY, public CLI, isolated state, no Herdr'
  )
} finally {
  if (app.exitCode === null) {
    app.kill()
    await Promise.race([
      new Promise((resolveExit) => app.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000))
    ])
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(root, { force: true, recursive: true })
      break
    } catch (error) {
      if (attempt === 4) {
        console.warn(`Could not remove packaged smoke directory ${root}:`, error)
        break
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250 * (attempt + 1)))
    }
  }
}
