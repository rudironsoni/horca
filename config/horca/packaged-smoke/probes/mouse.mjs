import {
  evaluate,
  ghosttyRect,
  pollUntil,
  readScreen,
  releaseMeta,
  saw,
  sendKey,
  sendLine,
  wheelAt,
  withTerminal
} from '../helpers.mjs'

export const id = 'mouse'

export const precondition =
  'Fresh shell this probe creates. Mouse reporting and SGR tracking run there. Scrollback wheel and link hit-tests belong to other probes.'

async function cursorValue(ctx, slot) {
  return evaluate(
    ctx.session,
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
}

export async function run(ctx) {
  return withTerminal(ctx, { shell: 'MOUSE_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    const rect = await ghosttyRect(ctx.session, term.slot)
    if (!rect) {
      throw new Error('Mouse canvas was not available')
    }
    await sendLine(ctx.session, 'python3 mouseprobe')
    await pollUntil('Mouse probe did not show MOUSE_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('MOUSE_READY') ? screen : null
    })
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: rect.x + 24, y: rect.y + 24, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: rect.x + 24, y: rect.y + 24, button: 'left', clickCount: 1 },
      15_000
    )
    const mouseHex = await pollUntil('Mouse click did not report', 6_000, async () => {
      const match = String(await readScreen(ctx, term.handle)).match(/MOUSEHEX ([0-9a-f]+)/)
      return match ? match[1] : null
    })
    if (!mouseHex.startsWith('1b5b4d') && !mouseHex.startsWith('1b5b3c')) {
      throw new Error(`Mouse click did not report: ${mouseHex}`)
    }
    saw(ctx, `MOUSE_OUTPUT ${mouseHex}`)

    await sendLine(ctx.session, 'python3 wheelprobe')
    await pollUntil('Mouse tracking probe did not show WHEEL_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('WHEEL_READY') ? screen : null
    })
    const trackRect = (await ghosttyRect(ctx.session, term.slot)) || rect
    await wheelAt(ctx.session, trackRect, 120)
    const wheelHex = await pollUntil('Tracking wheel did not report', 6_000, async () => {
      const lines = [...String(await readScreen(ctx, term.handle)).matchAll(/WHEELHEX ([0-9a-f]+)/g)].map(
        (match) => match[1]
      )
      return lines[0] || null
    })
    if (!wheelHex.startsWith('1b5b3c')) {
      throw new Error(`Tracking wheel was not an SGR report: ${wheelHex}`)
    }
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: trackRect.x + 24, y: trackRect.y + 24, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: trackRect.x + 24, y: trackRect.y + 24, button: 'left', clickCount: 1 },
      15_000
    )
    const clickHex = await pollUntil('Tracking click did not report', 6_000, async () => {
      const lines = [...String(await readScreen(ctx, term.handle)).matchAll(/WHEELHEX ([0-9a-f]+)/g)].map(
        (match) => match[1]
      )
      return lines[1] || null
    })
    if (!clickHex.startsWith('1b5b3c')) {
      throw new Error(`Tracking click was not an SGR report: ${clickHex}`)
    }
    saw(ctx, `WHEEL_SGR ${wheelHex} ${clickHex}`)
    await sendKey(ctx.session, {
      key: 'z',
      code: 'KeyZ',
      text: 'z',
      unmodifiedText: 'z',
      windowsVirtualKeyCode: 90,
      nativeVirtualKeyCode: 6
    })
    const hiddenCursor = await pollUntil('Pointer did not hide while typing', 4_000, async () => {
      const cursor = await cursorValue(ctx, term.slot)
      return cursor === 'none' ? cursor : null
    })
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: rect.x + 30, y: rect.y + 30, button: 'none' },
      15_000
    )
    const shownCursor = await pollUntil('Pointer stayed hidden after the mouse moved', 4_000, async () => {
      const cursor = await evaluate(
        ctx.session,
        `(() => {
          const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
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
    return saw(ctx, `POINTER_CURSOR ${hiddenCursor} ${shownCursor}`)
  })
}
