import {
  clickClearScreen,
  clickLabeledControl,
  closeNewestTerminalTab,
  delay,
  dragReadSelection,
  evaluate,
  focusGhosttySlot,
  ghosttyCanvasCount,
  ghosttySlots,
  openOwnedTerminal,
  pollUntil,
  readOutput,
  readScreen,
  releaseMeta,
  runCli,
  saw,
  sendLine,
  withTerminal
} from '../helpers.mjs'

export const id = 'lifecycle'

export const precondition =
  'Screen, clear, busy-close, and exit each open a terminal this probe creates. Clear always uses printf clearmarkhorca; cat on its own terminal. It does not reuse a grid left by another probe.'

const promptMark = /clearmark|printf|zsh|┌|─|├|HORCA|❯/

export async function run(ctx) {
  await withTerminal(ctx, { shell: 'SCREEN_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 screenprobe')
    const altDeadline = Date.now() + 15_000
    let sawAlt = false
    let sawPrimary = false
    let screenProbe = ''
    while (Date.now() < altDeadline) {
      screenProbe = `${await readScreen(ctx, term.handle)}\n${await readOutput(ctx, term.handle)}`
      if (screenProbe.includes('ALTSCREEN_HORCA')) {
        sawAlt = true
      }
      if (screenProbe.includes('PRIMARY_HORCA')) {
        sawPrimary = true
      }
      if (sawAlt && sawPrimary) {
        break
      }
      await delay(150)
    }
    if (!sawAlt || !sawPrimary) {
      throw new Error(
        `Screen probe failed alt=${sawAlt} primary=${screenProbe.includes('PRIMARY_HORCA')} unicode=${screenProbe.includes('UNICODE_HORCA')}`
      )
    }
    return saw(ctx, 'SCREEN_OUTPUT alt primary')
  })

  await withTerminal(ctx, { command: 'printf clearmarkhorca; cat', marker: 'clearmarkhorca' }, async (term) => {
    saw(ctx, `CHROME_CLEAR_SLOT ${term.slot}`)
    let clearBefore = ''
    for (let attempt = 0; attempt < 6; attempt += 1) {
      clearBefore = await dragReadSelection(ctx.session, term.slot, true)
      if (promptMark.test(clearBefore)) {
        break
      }
      await delay(1000)
    }
    if (!promptMark.test(clearBefore)) {
      throw new Error(`Clear probe grid had no prompt: ${JSON.stringify(clearBefore).slice(0, 200)}`)
    }
    saw(ctx, `CHROME_CLEAR_BEFORE ${JSON.stringify(clearBefore).slice(0, 80)}`)
    if (!(await clickClearScreen(ctx.session, term.slot))) {
      throw new Error('Clear Screen menu item was not clickable')
    }
    await delay(400)
    let clearText = ''
    for (let attempt = 0; attempt < 3; attempt += 1) {
      clearText = await dragReadSelection(ctx.session, term.slot, true)
      if (!promptMark.test(clearText)) {
        break
      }
      await delay(700)
    }
    if (promptMark.test(clearText)) {
      throw new Error(`Clear Screen left the Ghostty grid: ${JSON.stringify(clearText).slice(0, 200)}`)
    }
    return saw(ctx, `CHROME_CLEAR grid-cleared selection=${JSON.stringify(clearText).slice(0, 80)}`)
  })

  const busy = await openOwnedTerminal(ctx, { command: 'cat', markerTimeout: 8_000 })
  try {
    const clicked = await pollUntil(`Busy close button was not clickable`, 8_000, async () => {
      const ok = await evaluate(
        ctx.session,
        `(() => {
          const button = [...document.querySelectorAll('button')].filter((entry) =>
            (entry.getAttribute('aria-label') || '').startsWith('Close tab ')
          ).at(-1)
          if (!button) return false
          button.click()
          return true
        })()`,
        5_000
      )
      return ok ? true : null
    })
    if (!clicked) {
      throw new Error('Busy terminal did not add a tab')
    }
    const sawStopAndClose = await pollUntil('Running cat close did not ask', 8_000, async () => {
      const ok = await evaluate(
        ctx.session,
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
      return ok ? true : null
    })
    if (!sawStopAndClose) {
      const dialogText = await evaluate(ctx.session, `document.body.innerText.slice(0, 300)`, 5_000)
      throw new Error(`Running cat close did not ask: ${JSON.stringify(dialogText)}`)
    }
    saw(ctx, 'CHROME_CLOSE_DIALOG Stop and Close')
    const closeDeadline = Date.now() + 2_000
    let closeShown = false
    while (Date.now() < closeDeadline) {
      closeShown = Boolean(
        await evaluate(
          ctx.session,
          `[...document.querySelectorAll('button')].some((entry) =>
            (entry.getAttribute('aria-label') || entry.innerText || '').includes('Close tab')
          )`,
          5_000
        )
      )
      if (closeShown) {
        break
      }
      await delay(150)
    }
    if (!closeShown) {
      await openOwnedTerminal(ctx, { command: 'printf CLOSEIDLE', marker: 'CLOSEIDLE', focus: false })
    }
  } catch (error) {
    try {
      await busy.close()
    } catch {
      // The dialog assertion already failed.
    }
    throw error
  }

  const closesBefore = await ghosttyCanvasCount(ctx.session)
  await closeNewestTerminalTab(ctx.session)
  const closesAfter = await ghosttyCanvasCount(ctx.session)
  if (closesAfter >= closesBefore) {
    throw new Error(`Close tab did not remove a terminal tab: before=${closesBefore} after=${closesAfter}`)
  }
  saw(ctx, `CHROME_CLOSE ${closesBefore} -> ${closesAfter}`)

  const exiting = runCli(ctx, [
    'terminal',
    'create',
    '--worktree',
    ctx.worktreeSelector,
    '--command',
    'exec python3 exitprobe',
    '--json'
  ])
  const exitHandle = exiting?.result?.terminal?.handle
  if (!exitHandle) {
    throw new Error('Exit probe did not return a terminal handle')
  }
  const exitStatus = await pollUntil('Process exit was not observed', 12_000, async () => {
    const info = runCli(ctx, ['terminal', 'read', '--terminal', exitHandle, '--json'])
    const status = String(info?.result?.terminal?.status ?? '')
    return status === 'exited' ? info : null
  })
  const exitScreen = JSON.stringify(exitStatus)
  if (String(exitStatus?.result?.terminal?.status ?? '') !== 'exited') {
    throw new Error(`Process exit was not observed: ${exitScreen.slice(0, 500)}`)
  }
  saw(ctx, `EXIT_OUTPUT exited marker=${exitScreen.includes('EXIT_MARKER')}`)
  const exitSlot = (await ghosttySlots(ctx.session)).at(-1)
  if (exitSlot) {
    await focusGhosttySlot(ctx.session, exitSlot)
  }
  if (!(await pollUntil('Exit overlay did not offer Restart', 6_000, () => clickLabeledControl(ctx.session, 'Restart')))) {
    throw new Error('Restart was not clickable')
  }
  const restartSlot = (await ghosttySlots(ctx.session)).at(-1) || exitSlot
  if (restartSlot) {
    await focusGhosttySlot(ctx.session, restartSlot)
  }
  await releaseMeta(ctx.session)
  await sendLine(ctx.session, 'printf RESTARTHORCA')
  await pollUntil('Restart did not yield a shell that echoes a key', 8_000, async () => {
    if (restartSlot) {
      const selected = await dragReadSelection(ctx.session, restartSlot)
      if (String(selected).includes('RESTARTHORCA')) return selected
    }
    const screen = await readScreen(ctx, exitHandle)
    return screen.includes('RESTARTHORCA') ? screen : null
  })
  return saw(ctx, 'EXIT_RESTART RESTARTHORCA')
}
