import {
  evaluate,
  ghosttyRect,
  pollUntil,
  readOutput,
  readScreen,
  releaseMeta,
  revealMarkerOnScreen,
  saw,
  sendLine,
  tailLines,
  wheelAt,
  withTerminal
} from '../helpers.mjs'

export const id = 'scroll'

export const precondition =
  'Fresh shell this probe creates. fillprobe and followprobe run on that shell. The viewport is not whatever a previous probe left scrolled.'

export async function run(ctx) {
  return withTerminal(ctx, { shell: 'SCROLL_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 fillprobe')
    const painted = await revealMarkerOnScreen(ctx, term, 'SCROLLBOT')
    if (!painted) {
      throw new Error('Fill probe did not paint: null')
    }
    const beforeWheel = tailLines(await readScreen(ctx, term.handle))
    const rect = await ghosttyRect(ctx.session, term.slot)
    if (!rect) {
      throw new Error('Wheel canvas was not available')
    }
    await wheelAt(ctx.session, rect, -480)
    const afterWheel = await pollUntil('Wheel did not scroll the viewport', 6_000, async () => {
      const lines = tailLines(await readScreen(ctx, term.handle))
      const hadBottom = beforeWheel.some((line) => line.includes('SCROLLBOT'))
      const hasBottom = lines.some((line) => line.includes('SCROLLBOT'))
      if (hadBottom && !hasBottom) return lines
      return null
    })
    if (afterWheel.some((line) => line.includes('WHEELHEX'))) {
      throw new Error('Wheel over the shell inserted mouse text')
    }
    saw(ctx, 'WHEEL_SCROLL viewport')
    const barBefore = await evaluate(
      ctx.session,
      `(() => {
        const slider = document.querySelector('.orca-terminal-scrollbar .orca-terminal-slider')
        if (!slider) return null
        return { top: slider.style.top || '', display: slider.parentElement ? slider.parentElement.style.display : '' }
      })()`,
      5_000
    )
    await wheelAt(ctx.session, rect, 480)
    const barAfter = await pollUntil('Scrollbar did not follow the viewport', 4_000, async () => {
      const slider = await evaluate(
        ctx.session,
        `(() => {
          const track = document.querySelector('.orca-terminal-scrollbar')
          const slider = document.querySelector('.orca-terminal-scrollbar .orca-terminal-slider')
          if (!track || !slider) return null
          return { top: slider.style.top || '0px', display: track.style.display || '' }
        })()`,
        5_000
      )
      if (!slider) return null
      if (barBefore && slider.top === barBefore.top && slider.display === barBefore.display) return null
      return slider
    })
    saw(ctx, `SCROLLBAR ${JSON.stringify(barBefore)} -> ${JSON.stringify(barAfter)}`)

    await sendLine(ctx.session, 'python3 followprobe')
    await pollUntil('Follow probe did not show FOLLOWREADY', 8_000, async () => {
      const lines = tailLines(await readScreen(ctx, term.handle))
      return lines.some((line) => line.includes('FOLLOWREADY')) ? lines : null
    })
    const followRect = (await ghosttyRect(ctx.session, term.slot)) || rect
    await wheelAt(ctx.session, followRect, -800)
    await pollUntil('Scroll up did not leave the bottom', 4_000, async () => {
      const lines = tailLines(await readScreen(ctx, term.handle))
      return lines.some((line) => line.includes('FOLLOWREADY')) ? null : lines
    })
    const parkedOutput = await pollUntil('Output while scrolled up stayed on screen', 6_000, async () => {
      const screen = tailLines(await readScreen(ctx, term.handle))
      const output = await readOutput(ctx, term.handle)
      if (!output.includes('FOLLOWHORCA')) return null
      if (screen.some((line) => line.includes('FOLLOWHORCA'))) return null
      return output
    })
    if (!parkedOutput.includes('FOLLOWHORCA')) {
      throw new Error('Parked output was missing from the scrollback')
    }
    await wheelAt(ctx.session, followRect, 1600)
    await pollUntil('Returning to the bottom did not show the parked output', 6_000, async () => {
      const lines = tailLines(await readScreen(ctx, term.handle))
      return lines.some((line) => line.includes('FOLLOWHORCA')) ? lines : null
    })
    await sendLine(ctx.session, 'printf FOLLOWAGAIN')
    await pollUntil('Output at the bottom did not follow', 6_000, async () => {
      const lines = tailLines(await readScreen(ctx, term.handle))
      return lines.some((line) => line.includes('FOLLOWAGAIN')) ? lines : null
    })
    return saw(ctx, 'SCROLL_FOLLOW parked then followed')
  })
}
