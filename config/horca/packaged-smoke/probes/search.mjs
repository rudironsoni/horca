import {
  clickLabeledControl,
  evaluate,
  paintFillOnScreen,
  passthruCall,
  pollUntil,
  readOutput,
  readScreen,
  saw,
  sendKey,
  tailLines,
  withTerminal
} from '../helpers.mjs'

export const id = 'search'

export const precondition =
  'Fresh shell this probe creates. fillprobe paints SEARCHHORCA on that terminal before the find bar opens. Escape closes the find bar before the probe returns.'

export async function run(ctx) {
  return withTerminal(ctx, { shell: 'SEARCH_SHELL_READY' }, async (term) => {
    const painted = await paintFillOnScreen(ctx, term, 'SEARCHHORCA')
    if (!painted) {
      const screen = await readScreen(ctx, term.handle)
      const output = await readOutput(ctx, term.handle)
      throw new Error(
        `Fill probe did not paint SEARCHHORCA: null top=${screen.includes('SCROLLTOP')} out=${output.includes('SEARCHHORCA')} tail=${JSON.stringify(tailLines(screen).slice(-3)).slice(0, 180)}`
      )
    }
    await sendKey(ctx.session, {
      key: 'f',
      code: 'KeyF',
      modifiers: 4,
      windowsVirtualKeyCode: 70,
      nativeVirtualKeyCode: 3
    })
    await pollUntil('Find bar did not open', 4_000, async () => {
      const open = await evaluate(ctx.session, `Boolean(document.querySelector('[data-terminal-search-root]'))`, 5_000)
      return open ? true : null
    })
    await evaluate(
      ctx.session,
      `(() => {
        const field = document.querySelector('[data-terminal-search-root] input')
        if (!field) return false
        field.focus()
        field.value = 'SEARCHHORCA'
        field.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })()`,
      5_000
    )
    const found = await passthruCall(
      ctx.session,
      term.slot,
      `return api.search ? api.search(slot, 'SEARCHHORCA', 'next') : false`
    )
    if (!found) {
      throw new Error('Search did not match SEARCHHORCA')
    }
    if (!(await clickLabeledControl(ctx.session, 'Next match'))) {
      throw new Error('Next match was not clickable')
    }
    const foundAgain = await passthruCall(
      ctx.session,
      term.slot,
      `return api.search ? api.search(slot, 'SEARCHHORCA', 'next') : false`
    )
    if (!(await clickLabeledControl(ctx.session, 'Previous match'))) {
      throw new Error('Previous match was not clickable')
    }
    const foundPrev = await passthruCall(
      ctx.session,
      term.slot,
      `return api.search ? api.search(slot, 'SEARCHHORCA', 'previous') : false`
    )
    if (!foundAgain || !foundPrev) {
      throw new Error(`Search next/previous failed: next=${foundAgain} previous=${foundPrev}`)
    }
    if (!(await clickLabeledControl(ctx.session, 'Case sensitive'))) {
      throw new Error('Case sensitive search control was not clickable')
    }
    if (!(await clickLabeledControl(ctx.session, 'Regex'))) {
      throw new Error('Regex search control was not clickable')
    }
    const bad = await evaluate(
      ctx.session,
      `(() => {
        try {
          const api = window.api && window.api.horcaGhosttyPassthru
          if (api && api.search) api.search(${JSON.stringify(term.slot)}, '(?', 'next')
          return 'ok'
        } catch (error) {
          return String(error)
        }
      })()`,
      5_000
    )
    if (bad !== 'ok') {
      throw new Error(`Bad search pattern threw: ${bad}`)
    }
    await sendKey(ctx.session, { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 53 })
    const searchClosed = await pollUntil('Find bar stayed open', 4_000, async () => {
      const open = await evaluate(ctx.session, `Boolean(document.querySelector('[data-terminal-search-root]'))`, 5_000)
      return open ? null : true
    })
    if (!searchClosed) {
      throw new Error('Find bar stayed open')
    }
    return saw(ctx, 'SEARCH_OUTPUT next previous case regex closed')
  })
}
