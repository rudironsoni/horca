import {
  clickGhosttySlot,
  clickLabeledControl,
  closeNewestTerminalTab,
  closePaneSlot,
  containGhosttySlot,
  dragReadSelection,
  evaluate,
  focusGhosttySlot,
  ghosttyCanvasCount,
  ghosttySlots,
  keepGhosttyCanvases,
  openContextMenu,
  openOwnedTerminal,
  pollUntil,
  readScreen,
  releaseMeta,
  saw,
  sendLine,
  withTerminal
} from '../helpers.mjs'

export const id = 'multipane'

export const precondition =
  'Fresh shell this probe creates for the parent cwd. The split pane, reorder tab, second pane, and chrome split are opened and closed by this probe. They do not reuse a pane left by paste or chord.'

export async function run(ctx) {
  await withTerminal(ctx, { shell: 'PANE_SHELL_READY' }, async (term) => {
    await releaseMeta(ctx.session)
    await sendLine(ctx.session, 'python3 cwdprobe')
    const parentCwd = await pollUntil('Parent cwd was not printed', 6_000, async () => {
      const match = String(await readScreen(ctx, term.handle)).match(/CWDHORCA (\S+)/)
      return match ? match[1] : null
    })
    const beforeSplit = await ghosttyCanvasCount(ctx.session)
    if (!(await clickLabeledControl(ctx.session, 'Split Terminal Right'))) {
      throw new Error('Split Terminal Right was not clickable')
    }
    await pollUntil('Split did not add a surface', 12_000, async () => {
      const count = await ghosttyCanvasCount(ctx.session)
      return count > beforeSplit ? count : null
    })
    const splitSlot = (await ghosttySlots(ctx.session)).find((item) => item !== term.slot)
    if (!splitSlot) {
      throw new Error('Split did not create a second Ghostty slot')
    }
    await containGhosttySlot(ctx.session, splitSlot)
    await clickGhosttySlot(ctx.session, splitSlot)
    await sendLine(ctx.session, 'python3 cwdprobe')
    const childCwd = await pollUntil('Split pane cwd was not printed', 8_000, async () => {
      const selected = await dragReadSelection(ctx.session, splitSlot)
      const match = String(selected).match(/CWDHORCA (\S+)/)
      return match ? match[1] : null
    })
    if (childCwd !== parentCwd) {
      throw new Error(`Split cwd did not match the parent: parent=${parentCwd} child=${childCwd}`)
    }
    await sendLine(ctx.session, 'printf ONLYFOCUS')
    const childSawFocus = await pollUntil('Focused pane did not echo its key', 6_000, async () => {
      const selected = await dragReadSelection(ctx.session, splitSlot)
      return String(selected).includes('ONLYFOCUS') ? selected : null
    })
    const parentSawFocus = await readScreen(ctx, term.handle)
    if (parentSawFocus.includes('ONLYFOCUS') || !String(childSawFocus).includes('ONLYFOCUS')) {
      throw new Error('A key reached a pane that was not focused')
    }
    const widthsBefore = await evaluate(
      ctx.session,
      `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
      5_000
    )
    const divider = await evaluate(
      ctx.session,
      `(() => {
        const node = document.querySelector('.pane-divider')
        if (!node) return null
        const rect = node.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + Math.min(40, rect.height / 2) }
      })()`,
      5_000
    )
    if (!divider) {
      throw new Error('Split divider was not available')
    }
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: divider.x, y: divider.y, button: 'left', clickCount: 1 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: divider.x + 80, y: divider.y, button: 'left' },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 1 },
      15_000
    )
    const widthsDragged = await pollUntil('Divider drag did not reflow both panes', 6_000, async () => {
      const widths = await evaluate(
        ctx.session,
        `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
        5_000
      )
      if (!Array.isArray(widths) || widths.length < 2) return null
      if (!Array.isArray(widthsBefore) || widthsBefore.length < 2) return null
      const changed = widths.filter((width, index) => width !== widthsBefore[index])
      return changed.length >= 2 ? widths : null
    })
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mousePressed', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 2 },
      15_000
    )
    await ctx.session.call(
      'Input.dispatchMouseEvent',
      { type: 'mouseReleased', x: divider.x + 80, y: divider.y, button: 'left', clickCount: 2 },
      15_000
    )
    const widthsEqual = await pollUntil('Equalize did not match the pane widths', 4_000, async () => {
      const widths = await evaluate(
        ctx.session,
        `[...document.querySelectorAll('canvas[data-ghostty]')].map((node) => Math.round(node.getBoundingClientRect().width))`,
        5_000
      )
      if (!Array.isArray(widths) || widths.length < 2) return null
      return Math.abs(widths[0] - widths[1]) < 48 ? widths : null
    })
    saw(ctx, `MULTIPANE_CWD ${parentCwd} widths ${JSON.stringify(widthsDragged)} equal ${JSON.stringify(widthsEqual)}`)
    await closePaneSlot(ctx.session, splitSlot)
    await focusGhosttySlot(ctx.session, term.slot)
    return ctx.marker
  })

  const reorderBase = await ghosttyCanvasCount(ctx.session)
  if (!(await clickLabeledControl(ctx.session, 'New tab'))) {
    throw new Error('New tab was not clickable for reorder')
  }
  if (!(await pollUntil('New Terminal did not open for reorder', 4_000, () => clickLabeledControl(ctx.session, 'New Terminal')))) {
    throw new Error('New Terminal was not clickable for reorder')
  }
  await pollUntil('Reorder tab did not add a surface', 12_000, async () => {
    const count = await ghosttyCanvasCount(ctx.session)
    return count > reorderBase ? count : null
  })
  const orderBefore = await ghosttySlots(ctx.session)
  const tab = await pollUntil('Reorder tabs were not on the strip', 4_000, async () =>
    evaluate(
      ctx.session,
      `(() => {
        const tabs = [...document.querySelectorAll('[role="tab"]')].filter((node) => node.getBoundingClientRect().width > 2)
        if (tabs.length < 2) return null
        const rect = tabs[tabs.length - 1].getBoundingClientRect()
        const first = tabs[0].getBoundingClientRect()
        return { fromX: rect.x + rect.width / 2, fromY: rect.y + rect.height / 2, toX: first.x + 8, toY: first.y + first.height / 2, labels: tabs.map((node) => (node.innerText || '').trim().slice(0, 40)) }
      })()`,
      5_000
    )
  )
  await ctx.session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: tab.fromX, y: tab.fromY, button: 'left', clickCount: 1 },
    15_000
  )
  await ctx.session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: tab.toX, y: tab.toY, button: 'left' },
    15_000
  )
  await ctx.session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: tab.toX, y: tab.toY, button: 'left', clickCount: 1 },
    15_000
  )
  const orderAfter = await ghosttySlots(ctx.session)
  const labelsAfter = await evaluate(
    ctx.session,
    `[...document.querySelectorAll('[role="tab"]')].filter((node) => node.getBoundingClientRect().width > 2).map((node) => (node.innerText || '').trim().slice(0, 40))`,
    5_000
  )
  if (JSON.stringify(labelsAfter) === JSON.stringify(tab.labels) && JSON.stringify(orderAfter) === JSON.stringify(orderBefore)) {
    throw new Error('Pane drag did not reorder the tabs')
  }
  saw(ctx, 'MULTIPANE_REORDER')
  await closeNewestTerminalTab(ctx.session)

  const second = await openOwnedTerminal(ctx, { command: 'printf HORCA_PANE_2', marker: 'HORCA_PANE_2' })
  try {
    const paneCount = await ghosttyCanvasCount(ctx.session)
    if (paneCount < 2) {
      throw new Error(`Multi-pane failed: canvases=${paneCount}`)
    }
    saw(ctx, `MULTIPANE_OUTPUT ${paneCount} HORCA_PANE_2`)
    await openContextMenu(ctx.session, second.slot)
    const chrome = await evaluate(
      ctx.session,
      `(() => {
        const texts = []
        for (const el of document.querySelectorAll('button,[role="tab"],[role="menuitem"],[role="menu"],header')) {
          const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 80)
          if (text) texts.push(el.tagName + ':' + text)
        }
        return texts.slice(0, 40)
      })()`,
      5_000
    )
    console.log(`CHROME_DOM ${JSON.stringify(chrome)}`)
  } finally {
    try {
      await second.close()
    } catch {
      // The second pane is closed after its marker is checked.
    }
  }

  const closeTabCount = async () =>
    evaluate(
      ctx.session,
      `[...document.querySelectorAll('button')].filter((button) => (button.getAttribute('aria-label') || button.innerText || '').includes('Close tab Terminal')).length`,
      5_000
    )
  const tabsBefore = Number(await closeTabCount())
  if (!(await clickLabeledControl(ctx.session, 'New tab'))) {
    throw new Error('New tab button was not clickable')
  }
  if (!(await pollUntil('New Terminal menu item did not open', 4_000, () => clickLabeledControl(ctx.session, 'New Terminal')))) {
    throw new Error('New Terminal menu item did not open')
  }
  const tabsAfter = await pollUntil('New Terminal did not add a tab', 8_000, async () => {
    const count = Number(await closeTabCount())
    return count > tabsBefore ? count : null
  })
  saw(ctx, `CHROME_TAB ${tabsBefore} -> ${tabsAfter}`)

  let canvasesBefore = await ghosttyCanvasCount(ctx.session)
  while (canvasesBefore >= 3) {
    const trimmed = await keepGhosttyCanvases(ctx.session, canvasesBefore - 1)
    console.log(`CHROME_TRIM ${trimmed}`)
    if (trimmed >= canvasesBefore) {
      break
    }
    canvasesBefore = trimmed
  }
  if (!(await clickLabeledControl(ctx.session, 'Split Terminal Right'))) {
    throw new Error('Split Terminal Right was not clickable')
  }
  const canvasesAfter = await pollUntil('Split Terminal Right did not add a surface', 20_000, async () => {
    const count = await ghosttyCanvasCount(ctx.session)
    return count > canvasesBefore ? count : null
  })
  saw(ctx, `CHROME_SPLIT ${canvasesBefore} -> ${canvasesAfter}`)
  const panesBeforeClose = await ghosttyCanvasCount(ctx.session)
  const panePoint = await evaluate(
    ctx.session,
    `(() => {
      const canvas = [...document.querySelectorAll('canvas[data-ghostty]')].find((item) => {
        const rect = item.getBoundingClientRect()
        return rect.width >= 2 && rect.height >= 2
      })
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      return { x: rect.x + Math.min(30, rect.width / 2), y: rect.y + Math.min(40, rect.height / 2) }
    })()`,
    5_000
  )
  if (!panePoint) {
    throw new Error('No Ghostty canvas for the context menu')
  }
  await ctx.session.call(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: panePoint.x, y: panePoint.y, button: 'right', clickCount: 1 },
    15_000
  )
  await ctx.session.call(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: panePoint.x, y: panePoint.y, button: 'right', clickCount: 1 },
    15_000
  )
  const sawClosePane = await pollUntil('Close Pane menu item did not open', 4_000, async () => {
    const open = await evaluate(
      ctx.session,
      `[...document.querySelectorAll('[role="menuitem"]')].some((item) => (item.innerText || '').trim().startsWith('Close Pane'))`,
      5_000
    )
    return open ? true : null
  })
  if (!sawClosePane) {
    throw new Error('Close Pane menu item did not open')
  }
  if (!(await clickLabeledControl(ctx.session, 'Close Pane'))) {
    throw new Error('Close Pane menu item was not clickable')
  }
  const panesAfterClose = await pollUntil('Close Pane did not remove a surface', 8_000, async () => {
    const count = await ghosttyCanvasCount(ctx.session)
    return count < panesBeforeClose ? count : null
  })
  return saw(ctx, `CHROME_PANE_CLOSE ${panesBeforeClose} -> ${panesAfterClose}`)
}
