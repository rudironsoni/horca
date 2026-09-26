import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  delay,
  evaluate,
  installFixtures,
  openCdp,
  pollUntil,
  reservePort,
  runCli,
  tabLabels,
  waitForTargets
} from './helpers.mjs'

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

async function waitForRuntime(userData) {
  const metadataPath = join(userData, 'orca-runtime.json')
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (existsSync(metadataPath)) {
      return
    }
    await delay(200)
  }
  throw new Error(`Packaged Horca did not write runtime metadata at ${metadataPath}`)
}

function waitForDevtools(app) {
  return new Promise((resolveReady, rejectReady) => {
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
}

export async function attachSession(ctx, port) {
  const page = await waitForTargets(port)
  if (!page.webSocketDebuggerUrl) {
    throw new Error('Packaged Horca page has no CDP websocket')
  }
  ctx.session = openCdp(page.webSocketDebuggerUrl)
  await ctx.session.call('Runtime.enable', {}, 10_000)
  console.log('CDP Runtime.enable ok')
  try {
    const { windowId } = await ctx.session.call('Browser.getWindowForTarget', {}, 5_000)
    await ctx.session.call(
      'Browser.setWindowBounds',
      { windowId, bounds: { width: 1200, height: 800, windowState: 'normal' } },
      5_000
    )
    console.log('WINDOW_BOUNDS 1200x800')
  } catch (error) {
    console.log(`WINDOW_BOUNDS ${error instanceof Error ? error.message : error}`)
  }
  await pollUntil('Packaged renderer title is not Horca', 20_000, async () => {
    const title = await evaluate(ctx.session, 'document.title', 5_000)
    console.log(`CDP document.title=${title}`)
    return title === 'Horca' ? title : null
  })
  await waitForRuntime(ctx.userData)
}

export async function boot(executablePath) {
  const resolved = resolve(executablePath ?? '')
  if (!existsSync(resolved)) {
    throw new Error(`Packaged Horca executable does not exist: ${resolved}`)
  }
  const resourcesPath =
    process.platform === 'darwin'
      ? resolve(dirname(resolved), '..', 'Resources')
      : join(dirname(resolved), 'resources')
  const publicCli = join(resourcesPath, 'bin', process.platform === 'win32' ? 'horca.cmd' : 'horca')
  if (!existsSync(publicCli)) {
    throw new Error(`Packaged Horca CLI does not exist: ${publicCli}`)
  }
  if (existsSync(join(resourcesPath, 'herdr'))) {
    throw new Error(`Packaged Horca includes Herdr at ${join(resourcesPath, 'herdr')}`)
  }

  const smokeTmpRoot = process.platform === 'darwin' ? '/tmp' : tmpdir()
  const root = join(smokeTmpRoot, `hs-${process.pid}-${Date.now()}`)
  const home = join(root, 'home')
  const userData = join(root, 'user-data')
  mkdirSync(home, { recursive: true, mode: 0o700 })
  mkdirSync(userData, { recursive: true, mode: 0o700 })
  const workspace = join(home, 'smoke-workspace')
  mkdirSync(workspace, { recursive: true, mode: 0o700 })
  execFileSync('git', ['-C', workspace, 'init', '-b', 'main'])
  execFileSync('git', [
    '-C',
    workspace,
    '-c',
    'user.email=smoke@horca.local',
    '-c',
    'user.name=Horca Smoke',
    'commit',
    '--allow-empty',
    '-m',
    'smoke'
  ])
  writeFileSync(
    join(userData, 'orca-data.json'),
    JSON.stringify({
      settings: { telemetry: { optedIn: true, installId: '00000000-0000-4000-8000-000000000000' } },
      onboarding: { flowVersion: 4, closedAt: 1, outcome: 'completed', lastCompletedStep: 5 },
      ui: {
        featureTipsSeenIds: ['voice-dictation', 'orca-cli', 'cmd-j-palette'],
        contextualToursSeenIds: ['workspace-board', 'browser', 'tasks', 'automations', 'workspace-creation'],
        contextualToursAutoEligible: false,
        projectOrderManualDefaultNoticeDismissed: true,
        usagePercentageDisplayChangeNoticeDismissed: true
      }
    })
  )

  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, NODE_OPTIONS: _nodeOptions, ...inheritedEnvironment } = process.env
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

  const ctx = {
    executablePath: resolved,
    publicCli,
    home,
    userData,
    workspace,
    launchEnvironment,
    app: null,
    session: null,
    worktreePath: '',
    worktreeSelector: '',
    marker: '',
    workbenchChecked: false,
    bootTabs: []
  }
  ctx.runCli = (args) => runCli(ctx, args)

  const assignedPort = await reservePort()
  ctx.app = spawn(
    resolved,
    ['--use-mock-keychain', `--remote-debugging-port=${assignedPort}`, '--remote-allow-origins=*'],
    { env: launchEnvironment, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  await waitForDevtools(ctx.app)
  await attachSession(ctx, assignedPort)
  const live = liveHorcaApp()
  console.log(`GUI_APP ${live || 'missing'}`)
  if (!live.includes('/Applications/Horca.app') && !live.includes('Horca.app')) {
    console.log('GUI_APP_NOTE lsappinfo did not resolve live bundle; continuing via CDP')
  }
  const added = ctx.runCli(['repo', 'add', '--path', workspace, '--json'])
  console.log(`REPO ${added.result?.repo?.id ?? ''} ${added.result?.repo?.path ?? ''}`)
  const created = ctx.runCli([
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
  ctx.worktreeSelector = created.result?.worktree?.id
    ? `id:${created.result.worktree.id}`
    : `path:${created.result.worktree.path}`
  ctx.worktreePath = created.result?.worktree?.path
  if (!ctx.worktreePath) {
    throw new Error('Workbench worktree path is missing')
  }
  installFixtures(ctx.worktreePath)
  ctx.bootTabs = await tabLabels(ctx.session)
  return ctx
}

export async function relaunchPackagedApp(ctx) {
  ctx.session.close()
  const exited = new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => rejectExit(new Error('Packaged Horca did not exit for relaunch')), 15_000)
    ctx.app.once('exit', (code) => {
      clearTimeout(timer)
      resolveExit(code)
    })
  })
  try {
    execFileSync('osascript', ['-e', 'tell application "Horca" to quit'], { stdio: 'ignore' })
  } catch {
    ctx.app.kill('SIGTERM')
  }
  await exited
  const relaunchPort = await reservePort()
  ctx.app = spawn(
    ctx.executablePath,
    ['--use-mock-keychain', `--remote-debugging-port=${relaunchPort}`, '--remote-allow-origins=*'],
    { env: ctx.launchEnvironment, stdio: ['ignore', 'ignore', 'pipe'] }
  )
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error('Relaunched Horca did not publish a CDP endpoint')), 20_000)
    ctx.app.once('exit', (code) => {
      clearTimeout(timeout)
      rejectReady(new Error(`Relaunched Horca exited before CDP was ready: ${code}`))
    })
    ctx.app.stderr.setEncoding('utf8')
    ctx.app.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      if (/DevTools listening on ws:\/\/\S+/.test(chunk)) {
        clearTimeout(timeout)
        resolveReady()
      }
    })
  })
  ctx.workbenchChecked = false
  await attachSession(ctx, relaunchPort)
}
