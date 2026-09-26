import { relaunchPackagedApp } from '../boot.mjs'
import {
  clickLabeledControl,
  closeTabByLabel,
  evaluate,
  focusGhosttySlot,
  ghosttyCanvasCount,
  ghosttyRect,
  ghosttySlots,
  openContextMenu,
  openOwnedTerminal,
  openShell,
  pollUntil,
  readClipboard,
  readOutput,
  readScreen,
  releaseMeta,
  saw,
  sendKey,
  sendLine,
  tabLabels,
  tailLines,
  wheelAt
} from '../helpers.mjs'

async function clickReconnect(session) {
  if (await clickLabeledControl(session, 'Reconnect')) {
    return true
  }
  return Boolean(
    await evaluate(
      session,
      `(() => {
        const button = [...document.querySelectorAll('button')].find((entry) =>
          /reconnect/i.test(entry.innerText || entry.getAttribute('aria-label') || entry.getAttribute('title') || '')
        )
        if (!button) return false
        button.click()
        return true
      })()`,
      5_000
    )
  )
}

export const id = 'restore'

export const precondition =
  'SSH reconnect opens python3 sshreconnect on a terminal this probe creates. That fixture prints SSHSCROLLHORCA and drops ssh without waiting for a paste probe. Relaunch then keeps one surface, runs relaunchprobe on it, and opens a companion tab. It does not read the paste terminal.'

export async function run(ctx) {
  const ssh = await openOwnedTerminal(ctx, {
    command: 'python3 sshreconnect',
    marker: 'SSH_READY',
    markerTimeout: 8_000
  })
  try {
    await pollUntil('SSH drop was not observed', 8_000, async () => {
      const screen = await readScreen(ctx, ssh.handle)
      return screen.includes('SSHDROPPED') ? screen : null
    })
    const reconnect = await pollUntil('SSH reconnect overlay did not show', 6_000, async () => {
      const marker = await evaluate(
        ctx.session,
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
    if (!(await clickReconnect(ctx.session))) {
      throw new Error(`SSH reconnect control was not clickable: ${reconnect}`)
    }
    const restoredSsh = await pollUntil('SSH reconnect did not keep the scrollback', 8_000, async () => {
      const screen = await readScreen(ctx, ssh.handle)
      return screen.includes('SSHSCROLLHORCA') ? screen : null
    })
    await focusGhosttySlot(ctx.session, ssh.slot)
    await releaseMeta(ctx.session)
    await sendKey(ctx.session, {
      key: 'q',
      code: 'KeyQ',
      text: 'q',
      unmodifiedText: 'q',
      windowsVirtualKeyCode: 81,
      nativeVirtualKeyCode: 12
    })
    await pollUntil('SSH reconnect did not accept a key', 6_000, async () => {
      const screen = await readScreen(ctx, ssh.handle)
      return screen.includes('q') ? screen : null
    })
    saw(ctx, `SSH_RECONNECT ${reconnect} ${restoredSsh.includes('SSHSCROLLHORCA')}`)
  } finally {
    try {
      await ssh.close()
    } catch {
      // The relaunch section uses a different surface.
    }
  }

  const labelsBefore = await tabLabels(ctx.session)
  const term = await openShell(ctx, 'RELAUNCH_SHELL_READY')
  const labelsAfter = await tabLabels(ctx.session)
  const ownedLabel = labelsAfter.find((label) => !labelsBefore.includes(label))
  if (ownedLabel) {
    for (const label of labelsAfter) {
      if (label !== ownedLabel) {
        await closeTabByLabel(ctx, label)
      }
    }
  }
  const restoreSlot = term.slot
  await focusGhosttySlot(ctx.session, restoreSlot)
  await releaseMeta(ctx.session)
  await openContextMenu(ctx.session, restoreSlot)
  if (!(await clickLabeledControl(ctx.session, 'Copy Terminal ID'))) {
    throw new Error('Relaunch pane did not copy a terminal id')
  }
  const copiedHandle = readClipboard().trim()
  if (!/^term_[0-9a-f-]+$/.test(copiedHandle)) {
    throw new Error(`Relaunch pane id was not a terminal handle: ${copiedHandle}`)
  }
  const restoreHandle = term.handle
  await sendLine(ctx.session, 'python3 relaunchprobe')
  await pollUntil('Relaunch marker was not on the grid', 8_000, async () => {
    const lines = tailLines(await readScreen(ctx, restoreHandle))
    return lines.some((line) => line.includes('RELAUNCHA')) ? lines : null
  })
  const restoreRect = await ghosttyRect(ctx.session, restoreSlot)
  if (!restoreRect) {
    throw new Error('Relaunch canvas was not available')
  }
  await wheelAt(ctx.session, restoreRect, -900)
  await pollUntil('Relaunch viewport did not stay up', 4_000, async () => {
    const lines = tailLines(await readScreen(ctx, restoreHandle))
    return lines.some((line) => line.includes('RELAUNCHA')) && !lines.some((line) => line.includes('HIDDENHORCA'))
      ? lines
      : null
  })
  const hiddenWhileUp = await pollUntil('Output while the pane was hidden was not in the scrollback', 6_000, async () => {
    const screen = tailLines(await readScreen(ctx, restoreHandle))
    const output = await readOutput(ctx, restoreHandle)
    if (!output.includes('HIDDENHORCA')) return null
    if (screen.some((line) => line.includes('HIDDENHORCA'))) return null
    return output
  })
  if (!hiddenWhileUp.includes('HIDDENHORCA')) {
    throw new Error('Hidden output was missing from the scrollback')
  }
  const companion = await openOwnedTerminal(ctx, { command: 'printf RELAUNCHB', marker: 'RELAUNCHB', focus: false })
  if ((await ghosttyCanvasCount(ctx.session)) > 2) {
    throw new Error(`Relaunch left more than two Ghostty surfaces: ${await ghosttyCanvasCount(ctx.session)}`)
  }
  await relaunchPackagedApp(ctx)
  await pollUntil('Relaunch did not restore the scrolled viewport', 12_000, async () => {
    const screen = await readScreen(ctx, restoreHandle)
    const lines = tailLines(screen)
    if (!lines.some((line) => line.includes('RELAUNCHA'))) return null
    if (lines.some((line) => line.includes('HIDDENHORCA'))) return null
    return screen
  })
  const restoredHidden = await readOutput(ctx, restoreHandle)
  if (!restoredHidden.includes('HIDDENHORCA')) {
    throw new Error('Relaunch scrollback lost the hidden output')
  }
  const restoredCompanion = await readScreen(ctx, companion.handle)
  if (!restoredCompanion.includes('RELAUNCHB')) {
    throw new Error(`Relaunch did not restore the companion tab: ${restoredCompanion.slice(0, 300)}`)
  }
  const restoredSlot = (await ghosttySlots(ctx.session))[0]
  if (restoredSlot) {
    await focusGhosttySlot(ctx.session, restoredSlot)
  }
  await releaseMeta(ctx.session)
  await sendKey(ctx.session, {
    key: 'q',
    code: 'KeyQ',
    text: 'q',
    unmodifiedText: 'q',
    windowsVirtualKeyCode: 81,
    nativeVirtualKeyCode: 12
  })
  await pollUntil('Restored shell did not accept a key', 8_000, async () => {
    const screen = await readScreen(ctx, restoreHandle)
    return screen.includes('q') ? screen : null
  })
  await pollUntil('Restored banner was not on the packaged surface', 6_000, async () => {
    const text = await evaluate(ctx.session, `document.body.innerText`, 5_000)
    return String(text).toLowerCase().includes('session restored') ? text : null
  })
  await evaluate(
    ctx.session,
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
    const text = await evaluate(ctx.session, `document.body.innerText`, 5_000)
    return String(text).toLowerCase().includes('session restored') ? null : true
  })
  return saw(ctx, 'RELAUNCH_OUTPUT tabs scrollback key')
}
