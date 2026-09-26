import { chordLaunchState, classifyChordStart } from '../chord-evidence.mjs'
import {
  closePaneSlot,
  delay,
  evaluate,
  focusGhosttySlot,
  formatChordStartDump,
  ghosttyCanvasCount,
  ghosttyRect,
  ghosttySlots,
  pollUntil,
  readOutput,
  readScreen,
  releaseMeta,
  saw,
  sendKey,
  sendLine,
  shellPromptAfter,
  smokeKeyOnMarkerLine,
  withTerminal
} from '../helpers.mjs'

export const id = 'input'

export const precondition =
  'Key checks and chord checks each create their own terminal. The chord terminal is a fresh shell (printf CHORD_SHELL_READY, then runner$ on that handle). It does not read the paste terminal and does not wait for PASTE_OK. Meta is released on that terminal before python3 chordprobe. Pass requires CHORD_READY on that terminal. A visible chordprobe command without CHORD_READY is reported as "chord command observed, CHORD_READY absent".'

async function runKeys(ctx) {
  return withTerminal(
    ctx,
    { command: 'printf HORCA_D1_SMOKE; cat', marker: 'HORCA_D1_SMOKE', markerTimeout: 15_000 },
    async (term) => {
      saw(ctx, 'PTY_MARKER HORCA_D1_SMOKE')
      const rect = await ghosttyRect(ctx.session, term.slot)
      if (!rect || rect.width < 2 || rect.height < 2) {
        throw new Error(`Packaged Ghostty canvas is not hittable: ${JSON.stringify(rect)}`)
      }
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
      await sendKey(ctx.session, {
        key: 'q',
        code: 'KeyQ',
        text: 'q',
        unmodifiedText: 'q',
        windowsVirtualKeyCode: 81,
        nativeVirtualKeyCode: 12
      })
      const keyScreen = await pollUntil('Ghostty key q did not reach the PTY', 8_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return smokeKeyOnMarkerLine(screen) ? screen : null
      })
      if (!smokeKeyOnMarkerLine(keyScreen)) {
        throw new Error(`Ghostty key q did not reach the PTY: ${String(keyScreen).slice(0, 800)}`)
      }
      saw(ctx, 'KEY_OUTPUT q')
      await sendKey(ctx.session, {
        key: 'c',
        code: 'KeyC',
        modifiers: 2,
        windowsVirtualKeyCode: 67,
        nativeVirtualKeyCode: 8
      })
      const modifierScreen = await pollUntil('Ctrl+C did not reach the terminal', 8_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return screen.includes('^C') ? screen : null
      })
      if (!modifierScreen.includes('^C')) {
        throw new Error(`Ctrl+C did not reach the terminal: ${modifierScreen.slice(0, 800)}`)
      }
      saw(ctx, 'MODIFIER_OUTPUT ^C')
      const focusedSlot = await evaluate(
        ctx.session,
        `document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-ghostty')`,
        5_000
      )
      if (focusedSlot !== term.slot) {
        await focusGhosttySlot(ctx.session, term.slot)
      }
      const focused = await evaluate(
        ctx.session,
        `document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-ghostty')`,
        5_000
      )
      if (focused !== term.slot) {
        throw new Error(`Ghostty canvas is not focused: ${JSON.stringify(focused)} slot=${term.slot}`)
      }
      saw(ctx, `FOCUS_OUTPUT ${focused}`)
      await releaseMeta(ctx.session)
      await sendLine(ctx.session, 'python3 probe')
      await pollUntil('Key probe did not show PROBE_READY', 8_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return screen.includes('PROBE_READY') ? screen : null
      })
      const hexLines = (text) => [...String(text).matchAll(/HEX ([0-9a-f]+)/g)].map((match) => match[1])
      let seenHex = 0
      const oneKey = async (label, event, accept) => {
        await sendKey(ctx.session, event)
        const deadline = Date.now() + 6_000
        let screen = ''
        while (Date.now() < deadline) {
          screen = await readScreen(ctx, term.handle)
          const lines = hexLines(screen)
          if (lines.length > seenHex) {
            const hex = lines[lines.length - 1]
            if (!accept(hex)) {
              throw new Error(`${label} bytes ${hex} are not the expected terminal sequence`)
            }
            saw(ctx, `${label} ${hex}`)
            seenHex = lines.length
            return
          }
          await delay(150)
        }
        throw new Error(`${label} did not reach the PTY: ${screen.slice(0, 800)}`)
      }
      await oneKey(
        'ENTER_OUTPUT',
        { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 36 },
        (hex) => hex === '0d'
      )
      await oneKey(
        'BACKSPACE_OUTPUT',
        { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 51 },
        (hex) => hex === '7f'
      )
      await oneKey(
        'TAB_OUTPUT',
        { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 48 },
        (hex) => hex === '09'
      )
      await oneKey(
        'ARROW_OUTPUT',
        { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 126 },
        (hex) => hex === '1b5b41'
      )
      await oneKey(
        'HOME_OUTPUT',
        { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36, nativeVirtualKeyCode: 115 },
        (hex) => hex.startsWith('1b')
      )
      await oneKey(
        'PAGE_OUTPUT',
        { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34, nativeVirtualKeyCode: 121 },
        (hex) => hex.startsWith('1b')
      )
      await oneKey(
        'FUNCTION_OUTPUT',
        { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116, nativeVirtualKeyCode: 96 },
        (hex) => hex.startsWith('1b')
      )
      await oneKey(
        'END_OUTPUT',
        { key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 119 },
        (hex) => hex.startsWith('1b')
      )
      await oneKey(
        'PAGEUP_OUTPUT',
        { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33, nativeVirtualKeyCode: 116 },
        (hex) => hex.startsWith('1b')
      )
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
      await pollUntil('Key probe did not show PROBE_DONE', 6_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return screen.includes('PROBE_DONE') ? screen : null
      })
      return ctx.marker
    }
  )
}

async function collectChordOutput(ctx, handle) {
  const deadline = Date.now() + 8_000
  let chordOutput = ''
  while (Date.now() < deadline) {
    chordOutput = await readOutput(ctx, handle)
    if (classifyChordStart(chordOutput).chordReady) {
      return chordOutput
    }
    await delay(150)
  }
  return chordOutput
}

async function runChords(ctx) {
  ctx.marker = ''
  try {
    return await withTerminal(ctx, { shell: 'CHORD_SHELL_READY' }, async (term) => {
    await focusGhosttySlot(ctx.session, term.slot)
    await releaseMeta(ctx.session)
    const ready = await readOutput(ctx, term.handle)
    if (!shellPromptAfter(ready, 'CHORD_SHELL_READY')) {
      throw new Error('Chord shell was not ready on its own terminal')
    }
    await sendLine(ctx.session, 'python3 chordprobe', { text: '\r' })
    const chordOutput = await collectChordOutput(ctx, term.handle)
    const classified = classifyChordStart(chordOutput)
    if (!classified.chordReady) {
      const launch = chordLaunchState(chordOutput)
      ctx.marker = classified.marker
      throw new Error(`${classified.marker}; ${launch}\n${formatChordStartDump(chordOutput)}`)
    }
    saw(ctx, classified.marker)
    const nextChord = async (label, send, accept) => {
      const before = [...String(await readScreen(ctx, term.handle)).matchAll(/CHORDHEX ([0-9a-f]+)/g)].length
      await send()
      const hex = await pollUntil(`${label} did not reach the PTY`, 6_000, async () => {
        const lines = [...String(await readScreen(ctx, term.handle)).matchAll(/CHORDHEX ([0-9a-f]+)/g)].map(
          (match) => match[1]
        )
        return lines.length > before ? lines[lines.length - 1] : null
      })
      if (!accept(hex)) {
        throw new Error(`${label} bytes ${hex} are not the expected terminal sequence`)
      }
      saw(ctx, `${label} ${hex}`)
      return hex
    }
    await nextChord(
      'CHORD_CTRL_ENTER',
      () =>
        sendKey(ctx.session, {
          key: 'Enter',
          code: 'Enter',
          modifiers: 2,
          windowsVirtualKeyCode: 13,
          nativeVirtualKeyCode: 36
        }),
      (hex) => hex.includes('1b5b31333b3575')
    )
    await nextChord(
      'CHORD_OPTION_ARROW',
      () =>
        sendKey(ctx.session, {
          key: 'ArrowUp',
          code: 'ArrowUp',
          modifiers: 1,
          windowsVirtualKeyCode: 38,
          nativeVirtualKeyCode: 126
        }),
      (hex) => hex.includes('1b5b313b33') && hex.includes('41')
    )
    await nextChord(
      'CHORD_NONLATIN',
      () =>
        sendKey(ctx.session, {
          key: 'ф',
          code: 'KeyA',
          text: 'ф',
          modifiers: 2,
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 0
        }),
      (hex) => hex.includes('1b5b39373b3575') || hex.includes('1b5b313039323b3575')
    )
    await nextChord(
      'CHORD_KEYUP',
      () =>
        sendKey(ctx.session, {
          key: 'q',
          code: 'KeyQ',
          modifiers: 1,
          windowsVirtualKeyCode: 81,
          nativeVirtualKeyCode: 12
        }),
      (hex) => hex.includes('1b5b3131333b333a3375')
    )
    const surfacesBeforeSplit = await ghosttyCanvasCount(ctx.session)
    await nextChord(
      'CHORD_SPLIT_SHORTCUT',
      async () => {
        await sendKey(ctx.session, {
          key: 'd',
          code: 'KeyD',
          modifiers: 4,
          windowsVirtualKeyCode: 68,
          nativeVirtualKeyCode: 2
        })
        await focusGhosttySlot(ctx.session, term.slot)
        await sendKey(ctx.session, {
          key: 'a',
          code: 'KeyA',
          text: 'a',
          unmodifiedText: 'a',
          windowsVirtualKeyCode: 65,
          nativeVirtualKeyCode: 0
        })
      },
      (hex) => !hex.includes('1b5b3130303b') && (hex === '61' || hex.includes('1b5b39373b3175'))
    )
    if ((await ghosttyCanvasCount(ctx.session)) > surfacesBeforeSplit) {
      const extra = (await ghosttySlots(ctx.session)).find((item) => item !== term.slot)
      if (extra) {
        await closePaneSlot(ctx.session, extra)
      }
      await focusGhosttySlot(ctx.session, term.slot)
    }
    await nextChord(
      'CHORD_YEN',
      () =>
        sendKey(ctx.session, {
          key: '¥',
          code: 'IntlYen',
          text: '¥',
          unmodifiedText: '¥',
          windowsVirtualKeyCode: 220,
          nativeVirtualKeyCode: 93
        }),
      (hex) => hex.includes('c2a5') || hex.includes('1b5b313635')
    )
    await pollUntil('Chord probe did not show CHORD_DONE', 6_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('CHORD_DONE') ? screen : null
    })
    return saw(ctx, 'CHORD_DONE')
    })
  } catch (error) {
    if (!ctx.marker) {
      ctx.marker = error instanceof Error ? error.message : String(error)
    }
    throw error
  }
}

async function runInterrupt(ctx) {
  return withTerminal(ctx, { shell: 'INTERRUPT_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 sleepprobe')
    await pollUntil('Sleep probe did not show SLEEP_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('SLEEP_READY') ? screen : null
    })
    await sendKey(ctx.session, {
      key: 'c',
      code: 'KeyC',
      modifiers: 2,
      windowsVirtualKeyCode: 67,
      nativeVirtualKeyCode: 8
    })
    await sendLine(ctx.session, 'printf INTHORCA')
    const interrupted = await pollUntil('Ctrl-C did not return the prompt', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      if (screen.includes('SLEEP_DONE')) return 'SLEEP_DONE'
      return screen.includes('INTHORCA') ? screen : null
    })
    if (String(interrupted).includes('SLEEP_DONE')) {
      throw new Error('Ctrl-C left sleep running until it finished')
    }
    return saw(ctx, 'CTRL_C_PROMPT INTHORCA')
  })
}

export async function run(ctx) {
  await runKeys(ctx)
  await runChords(ctx)
  return runInterrupt(ctx)
}
