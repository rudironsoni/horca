import {
  delay,
  evaluate,
  pollUntil,
  readOutput,
  readScreen,
  releaseMeta,
  saw,
  sendLine,
  tailLines,
  withTerminal
} from '../helpers.mjs'

export const id = 'resize'

export const precondition =
  'Fresh shell this probe creates. linkprobe paints HORCAWRAP on that terminal before the wrap check. stty size runs on that same shell after the canvas width is restored. The canvas style is cleared before the probe returns.'

function readSttyCols(text) {
  const found = []
  for (const match of String(text).matchAll(/stty size[^0-9]{0,80}(\d+) (\d+)/g)) {
    found.push({ index: match.index ?? 0, cols: Number(match[2]) })
  }
  for (const match of String(text).matchAll(/"(\d+) (\d+)"/g)) {
    found.push({ index: match.index ?? 0, cols: Number(match[2]) })
  }
  if (found.length === 0) {
    return null
  }
  found.sort((a, b) => a.index - b.index)
  return found[found.length - 1].cols
}

function maxTailLength(text) {
  try {
    const tail = JSON.parse(text)?.result?.terminal?.tail
    if (!Array.isArray(tail) || tail.length === 0) {
      return 0
    }
    return Math.max(...tail.map((line) => String(line).length))
  } catch {
    return 0
  }
}

async function resetCanvas(ctx, slot) {
  await evaluate(
    ctx.session,
    `(() => {
      const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${slot}"]`)})
      if (!node) return 0
      node.style.width = ''
      node.style.height = ''
      node.style.maxWidth = ''
      node.style.flex = ''
      return node.getBoundingClientRect().width
    })()`,
    5_000
  )
}

export async function run(ctx) {
  return withTerminal(ctx, { shell: 'RESIZE_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    try {
      await sendLine(ctx.session, 'python3 linkprobe')
      await pollUntil('Link probe did not show LINK_READY', 8_000, async () => {
        const screen = await readScreen(ctx, term.handle)
        return screen.includes('LINK_READY') ? screen : null
      })
      const wide = tailLines(await readScreen(ctx, term.handle))
      const wideLength = wide.reduce((longest, line) => Math.max(longest, line.length), 0)
      if (!wide.some((line) => line.includes('HORCAWRAP'))) {
        throw new Error('Reflow line was not on the grid')
      }
      await evaluate(
        ctx.session,
        `(() => {
          const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
          if (!node) return 0
          node.style.width = '80px'
          node.style.maxWidth = '80px'
          node.style.flex = '0 0 80px'
          return node.getBoundingClientRect().width
        })()`,
        5_000
      )
      const wrappedScreen = await pollUntil('Narrow window did not wrap the long line', 6_000, async () => {
        const lines = tailLines(await readScreen(ctx, term.handle))
        if (!lines.some((line) => line.includes('HORCAWRAP'))) return null
        const longest = lines.reduce((length, line) => Math.max(length, line.length), 0)
        return longest < wideLength ? lines : null
      })
      await resetCanvas(ctx, term.slot)
      const unwrapped = await pollUntil('Widened window did not unwrap the line', 6_000, async () => {
        const lines = tailLines(await readScreen(ctx, term.handle))
        if (!lines.some((line) => line.includes('HORCAWRAP'))) return null
        const longest = lines.reduce((length, line) => Math.max(length, line.length), 0)
        const wrappedLongest = wrappedScreen.reduce((length, line) => Math.max(length, line.length), 0)
        return longest > wrappedLongest ? lines : null
      })
      if (!unwrapped.some((line) => line.includes('HORCAWRAP'))) {
        throw new Error('Unwrapped viewport lost the long line')
      }
      saw(ctx, 'REFLOW_OUTPUT wrap unwrap')

      await sendLine(ctx.session, 'stty size')
      const beforeCols = await pollUntil('stty size did not print a grid', 8_000, async () => {
        const text = await readOutput(ctx, term.handle)
        return readSttyCols(text)
      })
      const beforeTail = maxTailLength(await readOutput(ctx, term.handle))
      const shrunkWidth = await evaluate(
        ctx.session,
        `(() => {
          const node = document.querySelector(${JSON.stringify(`canvas[data-ghostty="${term.slot}"]`)})
          if (!node) return 0
          node.style.width = '80px'
          node.style.height = '400px'
          node.style.maxWidth = '80px'
          node.style.flex = '0 0 80px'
          return node.getBoundingClientRect().width
        })()`,
        5_000
      )
      console.log(`RESIZE_CSS_WIDTH ${shrunkWidth}`)
      await delay(400)
      await sendLine(ctx.session, 'stty size')
      const afterCols = await pollUntil('Narrow pane did not change PTY columns', 8_000, async () => {
        const text = await readOutput(ctx, term.handle)
        const nextCols = readSttyCols(text)
        return nextCols && nextCols < beforeCols ? nextCols : null
      }).catch(async (error) => {
        const afterSize = await readOutput(ctx, term.handle)
        const seen = [...String(afterSize).matchAll(/stty size[^0-9]{0,20}(\d+) (\d+)/g)].map((match) => match[0])
        console.log(`STTY_SEEN ${JSON.stringify(seen)}`)
        console.log(`STTY_TAIL ${String(afterSize).slice(-500)}`)
        throw new Error(
          `Narrow pane did not change PTY columns: before=${beforeCols} css=${shrunkWidth} tail=${beforeTail} ${error instanceof Error ? error.message : error}`
        )
      })
      return saw(ctx, `RESIZE_OUTPUT cols ${beforeCols} -> ${afterCols}`)
    } finally {
      await resetCanvas(ctx, term.slot)
    }
  })
}
