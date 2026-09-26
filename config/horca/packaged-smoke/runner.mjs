import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { boot } from './boot.mjs'
import { closeTabsOpenedSince } from './helpers.mjs'
import * as ime from './probes/ime.mjs'
import * as input from './probes/input.mjs'
import * as lifecycle from './probes/lifecycle.mjs'
import * as links from './probes/links.mjs'
import * as mouse from './probes/mouse.mjs'
import * as multipane from './probes/multipane.mjs'
import * as paste from './probes/paste.mjs'
import * as resize from './probes/resize.mjs'
import * as restore from './probes/restore.mjs'
import * as scroll from './probes/scroll.mjs'
import * as search from './probes/search.mjs'
import * as selection from './probes/selection.mjs'

export const probes = [input, paste, ime, mouse, selection, scroll, links, search, resize, lifecycle, multipane, restore]

export async function runPackagedSmoke({ executablePath, only = '' }) {
  const selected = only ? probes.filter((probe) => probe.id === only) : probes
  if (only && selected.length !== 1) {
    throw new Error(`Unknown smoke probe: ${only}`)
  }
  const ctx = await boot(executablePath)
  const failures = []
  try {
    for (const probe of selected) {
      ctx.marker = ''
      try {
        await closeTabsOpenedSince(ctx, ctx.bootTabs)
        const marker = await probe.run(ctx)
        console.log(`SMOKE_EVIDENCE ${JSON.stringify({ capability: probe.id, pass: true, marker: marker || ctx.marker })}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const marker = message.split('\n')[0].slice(0, 1800)
        console.log(`SMOKE_EVIDENCE ${JSON.stringify({ capability: probe.id, pass: false, marker })}`)
        failures.push(probe.id)
      }
    }
    if (!only && failures.length === 0) {
      if (existsSync(join(ctx.home, '.orca'))) {
        throw new Error(`Horca created the official Orca state root: ${join(ctx.home, '.orca')}`)
      }
      console.log(
        'Packaged Horca smoke passed: title, renderer, key, modifier, selection, resize, multi-pane, enter, backspace, tab, arrow, home, page, function, unicode, alt-screen, no Herdr'
      )
    }
    if (failures.length > 0) {
      throw new Error(`capabilities failed: ${failures.join(', ')}`)
    }
  } finally {
    if (ctx.session) {
      try {
        ctx.session.close()
      } catch {
        // The packaged app is killed next.
      }
    }
    if (ctx.app && ctx.app.exitCode === null) {
      ctx.app.kill('SIGKILL')
    }
  }
}
