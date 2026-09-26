import { execFileSync } from 'node:child_process'
import {
  clickLabeledControl,
  delay,
  dragReadSelection,
  evaluate,
  ghosttyRect,
  openContextMenu,
  pollUntil,
  readClipboard,
  readScreen,
  releaseMeta,
  saw,
  sendKey,
  sendLine,
  withTerminal,
  writeClipboard
} from '../helpers.mjs'

export const id = 'selection'

export const precondition =
  'Fresh terminal this probe creates with printf HORCA_D1_SMOKE; cat, plus a fresh shell for OSC 52. Copy and clipboard checks do not read the paste or chord terminals. The OSC 52 checkbox is turned back on before the probe returns.'

async function copyMenuOpen(ctx) {
  return Boolean(
    await evaluate(
      ctx.session,
      `[...document.querySelectorAll('[role="menu"][data-state="open"]')].some((menu) => (menu.innerText || '').includes('Copy'))`,
      5_000
    )
  )
}

async function restoreOsc52(ctx) {
  await evaluate(
    ctx.session,
    `(() => {
      const node = document.querySelector('#terminal-osc52-clipboard, [data-setting-id="terminal-osc52-clipboard"], [name="terminal-osc52-clipboard"]')
      if (!node) return false
      if ('checked' in node && !node.checked) node.click()
      return true
    })()`,
    5_000
  )
}

export async function run(ctx) {
  await withTerminal(ctx, { command: 'printf HORCA_D1_SMOKE; cat', marker: 'HORCA_D1_SMOKE' }, async (term) => {
    const rect = await ghosttyRect(ctx.session, term.slot)
    if (!rect) {
      throw new Error('Selection canvas was not available')
    }
    let selected = ''
    for (const rowOffset of [8, 28, 48, 68, 88, 108]) {
      const dragY = rect.y + rowOffset
      await ctx.session.call(
        'Input.dispatchMouseEvent',
        { type: 'mousePressed', x: rect.x + 4, y: dragY, button: 'left', clickCount: 1 },
        15_000
      )
      await ctx.session.call(
        'Input.dispatchMouseEvent',
        { type: 'mouseMoved', x: rect.x + 140, y: dragY, button: 'left' },
        15_000
      )
      await ctx.session.call(
        'Input.dispatchMouseEvent',
        { type: 'mouseReleased', x: rect.x + 140, y: dragY, button: 'left', clickCount: 1 },
        15_000
      )
      selected = await evaluate(
        ctx.session,
        `(() => {
          const api = window.api && window.api.horcaGhosttyPassthru
          if (!api || typeof api.readSelection !== 'function') return ''
          return String(api.readSelection(${JSON.stringify(term.slot)}))
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
    saw(ctx, `SELECTION_OUTPUT ${JSON.stringify(selected)}`)

    const copyMarker = await dragReadSelection(ctx.session, term.slot)
    if (!String(copyMarker).includes('HORCA') && !String(copyMarker).includes('SCROLL')) {
      throw new Error(`Shortcut copy selection was empty: ${JSON.stringify(copyMarker).slice(0, 120)}`)
    }
    writeClipboard('REPLACE_ME')
    await sendKey(ctx.session, {
      key: 'c',
      code: 'KeyC',
      modifiers: 4,
      windowsVirtualKeyCode: 67,
      nativeVirtualKeyCode: 8
    })
    const shortcutCopied = await pollUntil('Shortcut copy did not reach the clipboard', 4_000, async () => {
      const copied = readClipboard()
      return copied && copied !== 'REPLACE_ME' ? copied : null
    })
    if (shortcutCopied.trim() !== String(copyMarker).trim()) {
      throw new Error(
        `Shortcut copy clipboard did not match the selection: ${JSON.stringify(shortcutCopied).slice(0, 120)}`
      )
    }
    saw(ctx, 'COPY_SHORTCUT matched')
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: rect.x + 8, y: rect.y + 8, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: rect.x + 8, y: rect.y + 8, button: 'left', clickCount: 1 },
      15_000
    )
    writeClipboard('KEEPCLIP')
    await sendKey(ctx.session, {
      key: 'c',
      code: 'KeyC',
      modifiers: 4,
      windowsVirtualKeyCode: 67,
      nativeVirtualKeyCode: 8
    })
    await releaseMeta(ctx.session)
    const kept = readClipboard()
    if (kept.trim() !== 'KEEPCLIP') {
      throw new Error(`Empty selection copy changed the clipboard: ${JSON.stringify(kept).slice(0, 120)}`)
    }
    saw(ctx, 'COPY_SHORTCUT empty-kept')

    const openedCopyMenu = await evaluate(
      ctx.session,
      `(() => {
        const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
        if (!node) return false
        const box = node.getBoundingClientRect()
        node.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.x + 20,
          clientY: box.y + 20
        }))
        return true
      })()`,
      5_000
    )
    if (!openedCopyMenu) {
      throw new Error('Selection canvas was not available for Copy')
    }
    const sawCopy = await pollUntil('Copy menu item did not open', 4_000, async () => {
      const open = await evaluate(
        ctx.session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').trim().split('\\n')[0].trim() === 'Copy')`,
        5_000
      )
      return open ? true : null
    })
    if (!sawCopy) {
      throw new Error('Copy menu item did not open')
    }
    const copyClicked = await evaluate(
      ctx.session,
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
    const copied = await pollUntil('Copy menu did not put HORCA on the clipboard', 4_000, async () => {
      let value = ''
      try {
        value = execFileSync('pbpaste', { encoding: 'utf8' })
      } catch {
        value = ''
      }
      return value.includes('HORCA') ? value : null
    })
    if (!String(copied).includes('HORCA')) {
      throw new Error(`Copy menu did not put HORCA on the clipboard: ${JSON.stringify(copied).slice(0, 200)}`)
    }
    saw(ctx, 'CHROME_COPY HORCA')

    await openContextMenu(ctx.session, term.slot)
    const sawTerminalId = await pollUntil('Copy Terminal ID menu item did not open', 4_000, async () => {
      const open = await evaluate(
        ctx.session,
        `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').includes('Copy Terminal ID'))`,
        5_000
      )
      return open ? true : null
    })
    if (!sawTerminalId) {
      throw new Error('Copy Terminal ID menu item did not open')
    }
    if (!(await clickLabeledControl(ctx.session, 'Copy Terminal ID'))) {
      throw new Error('Copy Terminal ID menu item was not clickable')
    }
    const copiedId = await pollUntil('Copy Terminal ID did not put a terminal handle on the clipboard', 4_000, async () => {
      const value = readClipboard().trim()
      return /^term_[0-9a-f-]+$/.test(value) ? value : null
    })
    saw(ctx, `CHROME_TERMINAL_ID ${copiedId}`)

    if (!(await copyMenuOpen(ctx))) {
      await openContextMenu(ctx.session, term.slot)
    }
    await pollUntil('Context menu was not open for dismiss', 3_000, async () => ((await copyMenuOpen(ctx)) ? true : null))
    await delay(250)
    const dismissedByChrome = await evaluate(
      ctx.session,
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
    await pollUntil('Context menu did not dismiss', 3_000, async () => ((await copyMenuOpen(ctx)) ? null : true))
    saw(ctx, 'CHROME_DISMISS closed')
    return ctx.marker
  })

  let failed = false
  try {
    return await withTerminal(ctx, { shell: 'OSC52_SHELL_READY' }, async (term) => {
      await releaseMeta(ctx.session)
      await sendLine(ctx.session, 'python3 osc52probe')
      await pollUntil('OSC 52 did not change the clipboard', 6_000, async () => {
        return readClipboard().includes('OSC52HORCA') ? readClipboard() : null
      })
      const oscToast = await pollUntil('OSC 52 toast did not appear', 4_000, async () => {
        const text = await evaluate(
          ctx.session,
          `(() => {
            const nodes = [...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')]
            return nodes.map((node) => (node.innerText || '').trim()).filter(Boolean).join(' | ')
          })()`,
          5_000
        )
        return text ? text : null
      })
      saw(ctx, `OSC52_CLIPBOARD OSC52HORCA ${String(oscToast).slice(0, 80)}`)
      const setting = await evaluate(
        ctx.session,
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
      await sendLine(ctx.session, 'python3 osc52off')
      const held = await pollUntil('OSC 52 off-state did not finish', 6_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return screen.includes('OSC52_OFF_WROTE') ? readClipboard() : null
      })
      if (String(held).includes('OSC52OFF')) {
        throw new Error(`OSC 52 wrote the clipboard while the setting was off: ${JSON.stringify(held).slice(0, 80)}`)
      }
      return saw(ctx, 'OSC52_OFF held')
    })
  } catch (error) {
    failed = true
    throw error
  } finally {
    try {
      await restoreOsc52(ctx)
    } catch (error) {
      if (!failed) {
        throw error
      }
    }
  }
}
