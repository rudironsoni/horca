import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

export function saw(ctx, marker) {
  ctx.marker = marker
  console.log(marker)
  return marker
}

export async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

export async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) {
    throw new Error(`${url} -> ${response.status}`)
  }
  return response.json()
}

export async function waitForTargets(port) {
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
    await delay(200)
  }
  const titles = last.map((target) => `${target.type}:${target.title}`).join(', ')
  throw new Error(`Packaged Horca did not create its main renderer page (targets: ${titles})`)
}

export function openCdp(wsUrl) {
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

export async function evaluate(session, expression, timeoutMs) {
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

export async function pollUntil(label, timeoutMs, read) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = await read()
    if (last) {
      return last
    }
    await delay(150)
  }
  throw new Error(`${label}: ${JSON.stringify(last).slice(0, 800)}`)
}

export function runCli(ctx, args) {
  let stdout = ''
  try {
    stdout = execFileSync(ctx.publicCli, args, {
      env: ctx.launchEnvironment,
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

export async function readScreen(ctx, handle) {
  try {
    return JSON.stringify(runCli(ctx, ['terminal', 'read', '--terminal', handle, '--screen', '--json']))
  } catch (error) {
    return String(error && error.stdout ? error.stdout : error)
  }
}

export async function readOutput(ctx, handle) {
  try {
    return JSON.stringify(runCli(ctx, ['terminal', 'read', '--terminal', handle, '--json']))
  } catch (error) {
    return String(error && error.stdout ? error.stdout : error)
  }
}

export function tailLines(text) {
  try {
    const tail = JSON.parse(text)?.result?.terminal?.tail
    return Array.isArray(tail) ? tail.map((line) => String(line)) : []
  } catch {
    return []
  }
}

export function markerOnGrid(serialized, marker) {
  return tailLines(serialized).some((line) => {
    if (!line.includes(marker)) {
      return false
    }
    return !/\bprintf\b|\bpython3\b|PS1=/.test(line)
  })
}

export function smokeKeyOnMarkerLine(text) {
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

export function shellPromptAfter(text, marker) {
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
    const rest = rows.slice(markerAt).join('')
    const at = rest.lastIndexOf(marker)
    return at >= 0 && rest.slice(at + marker.length).includes('runner$')
  } catch {
    return false
  }
}

export function formatChordStartDump(screenText) {
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

export function installFixtures(worktreePath) {
  for (const name of readdirSync(fixtureDir)) {
    if (name.startsWith('.') || name === '__pycache__') {
      continue
    }
    writeFileSync(join(worktreePath, name), readFileSync(join(fixtureDir, name)))
  }
}

export function readClipboard() {
  try {
    return execFileSync('pbpaste', { encoding: 'utf8' })
  } catch {
    return ''
  }
}

export function writeClipboard(text) {
  execFileSync('pbcopy', { input: text })
}

export async function sendKey(session, event) {
  await session.call('Input.dispatchKeyEvent', { type: 'keyDown', ...event }, 15_000)
  await session.call(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: event.key,
      code: event.code,
      modifiers: event.modifiers,
      windowsVirtualKeyCode: event.windowsVirtualKeyCode,
      nativeVirtualKeyCode: event.nativeVirtualKeyCode
    },
    15_000
  )
}

export async function releaseMeta(session) {
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
}

export async function sendLine(session, text) {
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

export async function ghosttyCanvasCount(session) {
  return Number(await evaluate(session, `document.querySelectorAll('canvas[data-ghostty]').length`, 5_000))
}

export async function ghosttySlots(session) {
  const slots = await evaluate(
    session,
    `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => node.getAttribute('data-ghostty')).filter(Boolean)`,
    5_000
  )
  return Array.isArray(slots) ? slots : []
}

export async function ghosttyRect(session, slot) {
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

export async function awaitHittableRect(session, slot) {
  const deadline = Date.now() + 8_000
  let rect = null
  while (Date.now() < deadline) {
    rect = await ghosttyRect(session, slot)
    if (rect && rect.width > 2 && rect.height > 2) {
      return rect
    }
    await delay(200)
  }
  const described = await evaluate(
    session,
    `(() => [...document.querySelectorAll('canvas')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, slot: node.getAttribute('data-ghostty') }
    }))()`,
    5_000
  )
  throw new Error(
    `Packaged Ghostty canvas is not hittable: ${JSON.stringify({ slot, rect, described })}`
  )
}

export async function containGhosttySlot(session, slot) {
  await evaluate(
    session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node || node.dataset.horcaSmokeContained === '1') return
      node.style.width = '800px'
      node.style.height = '480px'
      node.style.maxWidth = '800px'
      node.style.flex = '0 0 auto'
      node.dataset.horcaSmokeContained = '1'
    })()`,
    5_000
  )
}

export async function releaseStuckSession(session) {
  await releaseMeta(session)
  await sendKey(session, {
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 53
  })
  await session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 },
    5_000
  )
}

export async function focusGhosttySlot(session, slot) {
  await evaluate(
    session,
    `document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})?.focus()`,
    5_000
  )
}

export async function activateHorca() {
  try {
    execFileSync('osascript', ['-e', 'tell application "Horca" to activate'], { stdio: 'ignore' })
  } catch {
    // Packaged smoke still drives the page through CDP when AppKit activate is unavailable.
  }
}

export function clearProbeSelectionPlan(origin) {
  return {
    rows: [8, 28, 48, 68, 88, 108].filter((offset) => offset < origin.height),
    x2: origin.x + Math.max(24, origin.width - 8)
  }
}

export function clearProbeSelectionCoversPromptRow(origin) {
  const plan = clearProbeSelectionPlan(origin)
  const bannerClip = Math.min(220, Math.max(24, origin.width - 8))
  return plan.rows.some((offset) => offset > 8) && plan.x2 - origin.x > bannerClip
}

if (!clearProbeSelectionCoversPromptRow({ x: 0, y: 0, width: 800, height: 400 })) {
  throw new Error('Clear probe drag does not cover the prompt row')
}

export async function dragReadSelection(session, slot, coverPromptRow = false) {
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
  const x2 = coverPromptRow ? plan.x2 : origin.x + Math.min(220, Math.max(24, origin.width - 8))
  const covered = []
  let selected = ''
  for (const offset of plan.rows) {
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

export async function openContextMenu(session, slot) {
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

export async function clickLabeledControl(session, label) {
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
    await delay(150)
  }
  return false
}

export async function confirmStopAndClose(session) {
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

export async function clickClearScreen(session, slot) {
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
    await delay(150)
  }
  return false
}

export async function closeNewestTerminalTab(session) {
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
  return pollUntil('Close tab did not release a Ghostty surface', 8_000, async () => {
    await confirmStopAndClose(session)
    const count = await ghosttyCanvasCount(session)
    return count < before ? { count } : null
  })
}

export async function closePaneSlot(session, slot) {
  const before = await ghosttyCanvasCount(session)
  await openContextMenu(session, slot)
  const closed = await pollUntil('Close Pane did not open', 4_000, () => clickLabeledControl(session, 'Close Pane'))
  if (!closed) {
    throw new Error('Close Pane was not clickable')
  }
  await pollUntil('Close Pane did not release a Ghostty surface', 8_000, async () => {
    await confirmStopAndClose(session)
    const slots = await ghosttySlots(session)
    return slots.includes(slot) ? null : { count: slots.length }
  })
  const after = await ghosttyCanvasCount(session)
  if (after >= before) {
    throw new Error(`Close Pane left the surface: before=${before} after=${after}`)
  }
}

export async function keepGhosttyCanvases(session, limit) {
  let count = await ghosttyCanvasCount(session)
  let guard = 0
  while (count > limit && guard < 6) {
    guard += 1
    count = (await closeNewestTerminalTab(session)).count
  }
  if (count > limit) {
    throw new Error(`Ghostty surfaces stayed above ${limit}: ${count}`)
  }
  return count
}

export async function wheelAt(session, rect, deltaY) {
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

export async function passthruCall(session, slot, expression) {
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

export async function tabLabels(session) {
  const labels = await evaluate(
    session,
    `[...document.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || '').filter((label) => label.startsWith('Close tab '))`,
    5_000
  )
  return Array.isArray(labels) ? labels : []
}

export async function closeTabByLabel(ctx, label) {
  const before = await ghosttyCanvasCount(ctx.session)
  const clicked = await pollUntil(`Close tab was not clickable: ${label}`, 8_000, async () => {
    const ok = await evaluate(
      ctx.session,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          (entry.getAttribute('aria-label') || '') === ${JSON.stringify(label)}
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      5_000
    )
    return ok ? true : null
  })
  if (!clicked) {
    throw new Error(`Close tab was not clickable: ${label}`)
  }
  await pollUntil(`Close tab did not release a surface: ${label}`, 8_000, async () => {
    await confirmStopAndClose(ctx.session)
    const count = await ghosttyCanvasCount(ctx.session)
    return count < before ? { count } : null
  })
}

export async function closeTabsOpenedSince(ctx, labelsBefore) {
  const before = new Set(labelsBefore)
  let guard = 0
  while (guard < 8) {
    guard += 1
    const labels = await tabLabels(ctx.session)
    const extra = labels.find((label) => !before.has(label))
    if (!extra) {
      return
    }
    await closeTabByLabel(ctx, extra)
  }
}

async function ensureWorkbenchOnce(ctx) {
  if (ctx.workbenchChecked) {
    return
  }
  const deadline = Date.now() + 20_000
  let workbench = { canvas: 0, primedError: false, reactError: false, body: '', painted: false }
  while (Date.now() < deadline) {
    workbench = await evaluate(
      ctx.session,
      `(() => {
        const canvases = [...document.querySelectorAll('.orca-terminal-canvas')]
        let painted = false
        for (const canvas of canvases) {
          if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 2 || canvas.height < 2) continue
          const context = canvas.getContext('2d')
          if (!context) {
            painted = canvas.width > 2 && canvas.height > 2
            continue
          }
          const sample = context.getImageData(0, 0, Math.min(canvas.width, 64), Math.min(canvas.height, 64)).data
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
    await delay(200)
  }
  if (workbench.canvas < 1 || !workbench.painted) {
    throw new Error(
      `Packaged terminal workbench has no painted Ghostty canvas: canvas=${workbench.canvas} painted=${workbench.painted} sizes=${JSON.stringify(workbench.sizes ?? [])} ${workbench.body}`
    )
  }
  const wasmEntries = await evaluate(
    ctx.session,
    `performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /wasm/i.test(name))`,
    5_000
  )
  console.log(`WASM_RESOURCES ${JSON.stringify(wasmEntries)}`)
  ctx.workbenchChecked = true
}

export async function openOwnedTerminal(ctx, { command, marker, markerTimeout = 15_000, focus = true }) {
  const labelsBefore = await tabLabels(ctx.session)
  const slotsBefore = await ghosttySlots(ctx.session)
  const created = runCli(ctx, [
    'terminal',
    'create',
    '--worktree',
    ctx.worktreeSelector,
    '--command',
    command,
    ...(focus ? ['--focus'] : []),
    '--json'
  ])
  const handle = created?.result?.terminal?.handle
  if (!handle) {
    throw new Error(`Terminal create did not return a handle: ${command}`)
  }
  if (marker) {
    await pollUntil(`${marker} was not on the new terminal`, markerTimeout, async () => {
      const screen = await readScreen(ctx, handle)
      const output = await readOutput(ctx, handle)
      return markerOnGrid(screen, marker) || markerOnGrid(output, marker) ? screen : null
    })
  }
  const slot = await pollUntil(`Ghostty slot did not appear for ${command}`, 12_000, async () => {
    const slots = await ghosttySlots(ctx.session)
    const fresh = slots.filter((item) => !slotsBefore.includes(item))
    for (const item of fresh) {
      const rect = await ghosttyRect(ctx.session, item)
      if (rect && rect.width > 2 && rect.height > 2) {
        return item
      }
    }
    return null
  })
  await containGhosttySlot(ctx.session, slot)
  const rect = await awaitHittableRect(ctx.session, slot)
  if (focus) {
    await focusGhosttySlot(ctx.session, slot)
    await activateHorca()
    await releaseMeta(ctx.session)
    const clickX = rect.x + 12
    const clickY = rect.y + 12
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: clickX, y: clickY, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: clickX, y: clickY, button: 'left', clickCount: 1 },
      15_000
    )
  }
  await ensureWorkbenchOnce(ctx)
  return {
    handle,
    slot,
    async close() {
      await closeTabsOpenedSince(ctx, labelsBefore)
    }
  }
}

export async function openShell(ctx, readyMarker) {
  const term = await openOwnedTerminal(ctx, {
    command: `PS1='runner$ '; printf '%s\\n' ${readyMarker}`,
    marker: readyMarker,
    markerTimeout: 8_000
  })
  try {
    const readyDeadline = Date.now() + 8_000
    let output = ''
    while (Date.now() < readyDeadline) {
      output = await readOutput(ctx, term.handle)
      if (shellPromptAfter(output, readyMarker)) {
        break
      }
      await delay(150)
    }
    if (!shellPromptAfter(output, readyMarker)) {
      throw new Error(
        `Shell was not ready after ${readyMarker}: ${JSON.stringify(tailLines(output).slice(-8))}`
      )
    }
    await focusGhosttySlot(ctx.session, term.slot)
    await releaseMeta(ctx.session)
    return term
  } catch (error) {
    try {
      await term.close()
    } catch {
      // The shell-ready failure is the one the probe reports.
    }
    throw error
  }
}

export async function withTerminal(ctx, spec, body) {
  const term = spec.shell ? await openShell(ctx, spec.shell) : await openOwnedTerminal(ctx, spec)
  let failed = false
  try {
    return await body(term)
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await term.close()
    } catch (closeError) {
      if (!failed) {
        throw closeError
      }
    }
  }
}
