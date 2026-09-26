import {
  evaluate,
  ghosttyRect,
  pollUntil,
  readScreen,
  releaseMeta,
  saw,
  sendLine,
  withTerminal
} from '../helpers.mjs'

export const id = 'links'

export const precondition =
  'Fresh shell this probe creates. linkprobe paints HTTP, file, wrapped, and OSC 8 links on that terminal. Reflow of HORCAWRAP belongs to the resize probe.'

export async function run(ctx) {
  return withTerminal(ctx, { shell: 'LINK_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 linkprobe')
    await pollUntil('Link probe did not show LINK_READY', 8_000, async () => {
      const screen = await readScreen(ctx, term.handle)
      return screen.includes('LINK_READY') ? screen : null
    })
    const linkRect = await ghosttyRect(ctx.session, term.slot)
    const links = await evaluate(
      ctx.session,
      `(() => {
        const api = window.api && window.api.horcaGhosttyPassthru
        const canvas = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
        if (!api || !api.hyperlinkAt || !canvas) return []
        const rect = canvas.getBoundingClientRect()
        const hits = []
        for (let y = 4; y < rect.height; y += 12) {
          for (let x = 4; x < Math.min(rect.width, 420); x += 28) {
            const uri = String(api.hyperlinkAt(${JSON.stringify(term.slot)}, x, y) || '')
            if (uri) hits.push({ x, y, uri })
          }
        }
        return hits
      })()`,
      15_000
    )
    const uris = (Array.isArray(links) ? links : []).map((hit) => hit.uri)
    const http = (Array.isArray(links) ? links : []).find((hit) => hit.uri.includes('http://127.0.0.1/HORCALINK'))
    const file = uris.find((uri) => uri.includes('linkfile'))
    const wrapped = uris.find((uri) => uri.includes('HORCAWRAP') && uri.includes('www'))
    const osc8 = uris.find((uri) => uri.includes('http://127.0.0.1/OSC8HORCA'))
    if (!http || !file || !wrapped || !osc8) {
      throw new Error(
        `Link hits missed http=${Boolean(http)} file=${Boolean(file)} wrapped=${Boolean(wrapped)} osc8=${Boolean(osc8)}`
      )
    }
    await evaluate(
      ctx.session,
      `(() => {
        window.__horcaOpened = []
        const orig = window.open
        window.open = (...args) => { window.__horcaOpened.push(String(args[0] || '')); return null }
        window.__horcaOpen = orig
        return true
      })()`,
      5_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'left', clickCount: 1 },
      15_000
    )
    const opened = await pollUntil('HTTP link did not open outside the app', 4_000, async () => {
      const value = await evaluate(
        ctx.session,
        `Array.isArray(window.__horcaOpened) ? window.__horcaOpened.join(',') : ''`,
        5_000
      )
      return String(value).includes('http://127.0.0.1/HORCALINK') ? value : null
    })
    saw(ctx, `LINK_HTTP ${opened}`)
    const fileHit = (Array.isArray(links) ? links : []).find((hit) => hit.uri.includes('linkfile'))
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: linkRect.x + fileHit.x, y: linkRect.y + fileHit.y, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: linkRect.x + fileHit.x, y: linkRect.y + fileHit.y, button: 'left', clickCount: 1 },
      15_000
    )
    await pollUntil('File link did not open in the editor', 6_000, async () => {
      const text = await evaluate(ctx.session, `document.body.innerText.slice(0, 2000)`, 5_000)
      return String(text).includes('linkfile') ? text : null
    })
    saw(ctx, 'LINK_FILE linkfile')
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: linkRect.x + http.x, y: linkRect.y + http.y, button: 'none' },
      15_000
    )
    await pollUntil('Link hover did not show', 3_000, async () => {
      const text = await evaluate(ctx.session, `document.body.innerText`, 5_000)
      return String(text).includes('HORCALINK') ? true : null
    })
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: Math.max(0, linkRect.x - 20), y: Math.max(0, linkRect.y - 20), button: 'none' },
      15_000
    )
    await evaluate(
      ctx.session,
      `document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))`,
      5_000
    )
    const hoverCleared = await pollUntil('Link hover stayed after the pointer left', 3_000, async () => {
      const showing = await evaluate(
        ctx.session,
        `(() => {
          const nodes = [...document.querySelectorAll('[role="tooltip"], .terminal-link-tooltip, .xterm-hover')]
          return nodes.some((node) => (node.innerText || '').includes('HORCALINK') && node.style.display !== 'none')
        })()`,
        5_000
      )
      return showing ? null : true
    })
    if (!hoverCleared) {
      throw new Error('Link hover stayed after the pointer left')
    }
    return saw(ctx, 'LINK_OUTPUT http file wrapped osc8')
  })
}
