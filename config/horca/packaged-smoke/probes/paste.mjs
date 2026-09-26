import {
  clickLabeledControl,
  closeNewestTerminalTab,
  evaluate,
  focusGhosttySlot,
  ghosttySlots,
  openContextMenu,
  openOwnedTerminal,
  passthruCall,
  pollUntil,
  readClipboard,
  readScreen,
  releaseMeta,
  tailLines,
  saw,
  sendKey,
  sendLine,
  withTerminal,
  writeClipboard
} from '../helpers.mjs'

function startupWriter(serialized) {
  const rows = tailLines(serialized)
  const bad = rows.find((row) => row.includes('STARTUP_BAD')) || ''
  const hexMatch = bad.match(/STARTUP_BAD\s+([0-9a-f]+)/i)
  const hex = hexMatch ? hexMatch[1] : ''
  const bracketed = hex.includes('1b5b3230307e')
  const commandInBytes = hex.includes(Buffer.from('startupprobe').toString('hex'))
  if (bracketed) {
    return `writer=pasteText hex=${hex.slice(0, 96)}`
  }
  if (commandInBytes) {
    return `writer=writePty hex=${hex.slice(0, 96)}`
  }
  return `writer=none hex=${hex.slice(0, 96)} line=${JSON.stringify(bad).slice(0, 160)}`
}

export const id = 'paste'

export const precondition =
  'Fresh shell this probe creates (printf PASTE_SHELL_READY, then runner$ on that handle). Bracketed paste, startup paste, agent paste, and ssh paste each use terminals this probe opens and closes. None of them read a chord terminal.'

async function runBracketedPaste(ctx, term, trigger) {
  await focusGhosttySlot(ctx.session, term.slot)
  await releaseMeta(ctx.session)
  await sendLine(ctx.session, 'python3 pasteprobe')
  await pollUntil('Paste probe did not show PASTE_READY', 8_000, async () => {
    const screen = await readScreen(ctx, term.handle)
    return screen.includes('PASTE_READY') ? screen : null
  })
  writeClipboard('PASTE_HORCA')
  await trigger()
  const verdict = await pollUntil('Paste did not reach the PTY', 6_000, async () => {
    const screen = await readScreen(ctx, term.handle)
    if (screen.includes('PASTE_OK')) return 'PASTE_OK'
    if (screen.includes('PASTE_BAD') || screen.includes('PASTE_SPLIT')) return screen.slice(0, 180)
    return null
  })
  if (verdict !== 'PASTE_OK') {
    throw new Error(`Paste did not reach the PTY as bracketed text: ${verdict}`)
  }
  await releaseMeta(ctx.session)
}

export async function run(ctx) {
  await withTerminal(ctx, { shell: 'PASTE_SHELL_READY' }, async (term) => {
    await runBracketedPaste(ctx, term, async () => {
      writeClipboard('PASTE_HORCA')
      await sendKey(ctx.session, {
        key: 'v',
        code: 'KeyV',
        modifiers: 4,
        windowsVirtualKeyCode: 86,
        nativeVirtualKeyCode: 9
      })
    })
    saw(ctx, 'PASTE_OUTPUT PASTE_OK')
    await runBracketedPaste(ctx, term, async () => {
      await evaluate(ctx.session, `window.dispatchEvent(new Event('orca-app-menu-paste'))`, 5_000)
    })
    saw(ctx, 'PASTE_MENU PASTE_OK')
    await runBracketedPaste(ctx, term, async () => {
      await openContextMenu(ctx.session, term.slot)
      const clicked = await pollUntil('Paste menu item did not open', 4_000, () =>
        clickLabeledControl(ctx.session, 'Paste')
      )
      if (!clicked) {
        throw new Error('Paste menu item was not clickable')
      }
    })
    saw(ctx, 'PASTE_CONTEXT PASTE_OK')
    await runBracketedPaste(ctx, term, async () => {
      await passthruCall(ctx.session, term.slot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
    })
    return saw(ctx, 'PASTE_PROGRAMMATIC PASTE_OK')
  })

  const startup = await openOwnedTerminal(ctx, { command: 'python3 startupprobe', markerTimeout: 8_000 })
  try {
    const startupVerdict = await pollUntil('Startup paste was not bracketed', 8_000, async () => {
      const screen = await readScreen(ctx, startup.handle)
      if (screen.includes('STARTUP_OK')) return 'STARTUP_OK'
      if (screen.includes('STARTUP_BAD')) return screen
      return null
    })
    if (startupVerdict !== 'STARTUP_OK') {
      throw new Error(`Startup command paste was not bracketed: STARTUP_BAD ${startupWriter(startupVerdict)}`)
    }
    saw(ctx, 'PASTE_STARTUP STARTUP_OK')
  } finally {
    try {
      await startup.close()
    } catch {
      // The startup terminal is closed even when the verdict already failed.
    }
  }

  await withTerminal(ctx, { shell: 'PASTE_AGENT_SHELL_READY' }, async (term) => {
    if (!(await clickLabeledControl(ctx.session, 'New tab'))) {
      throw new Error('New tab button was not clickable for an agent pane')
    }
    const agentLabel = await pollUntil('Agent menu item did not open', 4_000, async () => {
      const label = await evaluate(
        ctx.session,
        `(() => {
          const item = [...document.querySelectorAll('[role="menuitem"]')].find((entry) => /agent/i.test(entry.innerText || ''))
          return item ? (item.innerText || '').trim().split('\\n')[0].trim() : ''
        })()`,
        5_000
      )
      return label || null
    })
    if (!(await clickLabeledControl(ctx.session, agentLabel))) {
      throw new Error(`Agent menu item was not clickable: ${agentLabel}`)
    }
    const agentSlot = await pollUntil('Agent pane did not add a surface', 12_000, async () => {
      const extra = (await ghosttySlots(ctx.session)).find((item) => item !== term.slot)
      return extra || null
    })
    await focusGhosttySlot(ctx.session, agentSlot)
    await sendLine(ctx.session, 'python3 pasteprobe')
    const agentHandle = await pollUntil('Agent pane did not publish a handle', 8_000, async () => {
      await openContextMenu(ctx.session, agentSlot)
      if (!(await clickLabeledControl(ctx.session, 'Copy Terminal ID'))) return null
      const copied = readClipboard().trim()
      return /^term_[0-9a-f-]+$/.test(copied) ? copied : null
    })
    writeClipboard('PASTE_HORCA')
    await passthruCall(ctx.session, agentSlot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
    const agentPaste = await pollUntil('Agent paste was not bracketed', 6_000, async () => {
      const screen = await readScreen(ctx, agentHandle)
      if (screen.includes('PASTE_OK')) return 'PASTE_OK'
      if (screen.includes('PASTE_BAD')) return screen.slice(0, 160)
      return null
    })
    if (agentPaste !== 'PASTE_OK') {
      throw new Error(`Agent pane paste was not bracketed: ${agentPaste}`)
    }
    saw(ctx, 'PASTE_AGENT PASTE_OK')
    await closeNewestTerminalTab(ctx.session)
    await focusGhosttySlot(ctx.session, term.slot)
    return ctx.marker
  })

  const ssh = await openOwnedTerminal(ctx, {
    command: 'python3 sshprobe',
    marker: 'SSH_READY',
    markerTimeout: 8_000
  })
  try {
    await focusGhosttySlot(ctx.session, ssh.slot)
    writeClipboard('PASTE_HORCA')
    await passthruCall(ctx.session, ssh.slot, `api.pasteText && api.pasteText(slot, 'PASTE_HORCA'); return true`)
    const sshPaste = await pollUntil('SSH paste was not bracketed', 6_000, async () => {
      const screen = await readScreen(ctx, ssh.handle)
      if (screen.includes('PASTE_OK')) return 'PASTE_OK'
      if (screen.includes('PASTE_BAD')) return screen.slice(0, 160)
      return null
    })
    if (sshPaste !== 'PASTE_OK') {
      throw new Error(`SSH pane paste was not bracketed: ${sshPaste}`)
    }
    return saw(ctx, 'PASTE_SSH PASTE_OK')
  } finally {
    try {
      await ssh.close()
    } catch {
      // SSH reconnect is a different probe. This tab is closed after PASTE_OK.
    }
  }
}
