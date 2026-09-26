import { evaluate, pollUntil, readScreen, releaseMeta, saw, sendLine, withTerminal } from '../helpers.mjs'

export const id = 'ime'

export const precondition =
  'Two fresh shells this probe creates. compositionend runs on the first. Preedit and commit run on the second. Neither shell is the paste or chord terminal.'

export async function run(ctx) {
  await withTerminal(ctx, { shell: 'IME_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 imeprobe')
    await pollUntil('IME probe did not show IME_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('IME_READY') ? screen : null
    })
    await evaluate(
      ctx.session,
      `window.dispatchEvent(new CompositionEvent('compositionend', { data: '你', bubbles: true }))`,
      5_000
    )
    const imeHex = await pollUntil('compositionend did not write 你', 6_000, async () => {
      const match = String(await readScreen(ctx, term.handle)).match(/IMEHEX ([0-9a-f]+)/)
      return match ? match[1] : null
    })
    if (imeHex !== 'e4bda0') {
      throw new Error(`compositionend did not write 你 as e4bda0: ${imeHex}`)
    }
    return saw(ctx, `IME_OUTPUT ${imeHex}`)
  })

  return withTerminal(ctx, { shell: 'IME2_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 imemulti')
    await pollUntil('IME probe did not show IME2_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('IME2_READY') ? screen : null
    })
    await evaluate(
      ctx.session,
      `(() => {
        const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)}) || window
        const fire = (type, data) => node.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }))
        fire('compositionstart', '')
        fire('compositionupdate', 'ㅎ')
        fire('compositionupdate', '하')
        fire('compositionupdate', '한')
        return true
      })()`,
      5_000
    )
    const preedit = await pollUntil('IME preedit was not drawn', 4_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      const dom = await evaluate(
        ctx.session,
        `(() => {
          const canvas = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
          if (!canvas) return null
          const rect = canvas.getBoundingClientRect()
          const node = [...document.querySelectorAll('body *')].find((entry) => {
            const text = entry.innerText || entry.textContent || ''
            if (!text.includes('한') && !text.includes('하') && !text.includes('ㅎ')) return false
            if (entry === canvas) return false
            const box = entry.getBoundingClientRect()
            return box.width > 0 && box.height > 0 && box.left >= rect.left - 2 && box.top >= rect.top - 2 && box.left <= rect.right && box.top <= rect.bottom
          })
          if (!node) return null
          const box = node.getBoundingClientRect()
          return { text: (node.innerText || node.textContent || '').slice(0, 20), left: box.left, top: box.top }
        })()`,
        5_000
      )
      if (!dom) return null
      return { screen: screen.includes('한') || screen.includes('하') || screen.includes('ㅎ'), dom }
    })
    saw(ctx, `IME_PREEDIT ${JSON.stringify(preedit)}`)
    await evaluate(
      ctx.session,
      `(() => {
        const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
        Object.defineProperty(event, 'keyCode', { get: () => 229 })
        Object.defineProperty(event, 'isComposing', { get: () => true })
        window.dispatchEvent(event)
        window.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }))
        return true
      })()`,
      5_000
    )
    const imeHex = await pollUntil('IME commit did not reach the PTY', 6_000, async () => {
      const match = String(await readScreen(ctx, term.handle)).match(/IME2HEX ([0-9a-f]+)/)
      return match ? match[1] : null
    })
    if (imeHex.includes('0d') || imeHex.split('ed959c').length - 1 !== 1) {
      throw new Error(`IME commit was not one syllable without CR: ${imeHex}`)
    }
    return saw(ctx, `IME_MULTI ${imeHex}`)
  })
}
