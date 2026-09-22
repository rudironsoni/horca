'use strict'
const { app } = require('electron')
const path = require('path')
const { GhosttyTerminal } = require(path.join(__dirname, '../../adopted/electron-ghostty'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function press(term, event) {
  term.key({ action: 1, ...event })
}

function release(term, event) {
  term.key({
    action: 0,
    keycode: event.keycode,
    mods: event.mods || 0,
    unshiftedCodepoint: event.unshiftedCodepoint || 0
  })
}

app.whenReady().then(async () => {
  const term = new GhosttyTerminal({
    engine: 'main',
    passthru: true,
    config: 'window-vsync = false\nmacos-option-as-alt = true\n',
    widthPx: 800,
    heightPx: 400,
    scale: 1
  })
  const chunks = []
  term.on('pty-write', (buf) => chunks.push(Buffer.from(buf)))
  term._engine.start()
  const settle = async () => {
    let last = -1
    for (let i = 0; i < 8 && chunks.length !== last; i += 1) {
      last = chunks.length
      term._engine._tick()
      await sleep(15)
    }
  }
  const take = async (fn) => {
    await settle()
    chunks.length = 0
    fn()
    await settle()
    return Buffer.concat(chunks).toString('hex')
  }
  const out = {}
  out.enter = await take(() => press(term, { keycode: 36, mods: 0 }))
  out.up = await take(() => press(term, { keycode: 126, mods: 0 }))
  out.ctrlc = await take(() => press(term, { keycode: 8, mods: 2 }))
  out.backspace = await take(() => press(term, { keycode: 51, mods: 0 }))
  out.a = await take(() => press(term, { keycode: 0, mods: 0, text: 'a', unshiftedCodepoint: 97 }))
  out.altqPlain = await take(() => press(term, { keycode: 12, mods: 4, text: 'q', unshiftedCodepoint: 113 }))
  term.ptyData(Buffer.from('\x1b[<u\x1b[>31u'))
  await settle()
  out.altq = await take(() => press(term, { keycode: 12, mods: 4, text: 'q', unshiftedCodepoint: 113 }))
  out.altqRepeat = await take(() => {
    term.key({ action: 2, keycode: 12, mods: 4, text: 'q', unshiftedCodepoint: 113 })
  })
  out.altqRelease = await take(() => {
    term.key({ action: 0, keycode: 12, mods: 4, unshiftedCodepoint: 113 })
  })
  out.ctrlAltQ = await take(() => press(term, { keycode: 12, mods: 6, unshiftedCodepoint: 113 }))
  out.shiftEnter = await take(() => {
    const event = { keycode: 36, mods: 1 }
    press(term, event)
    release(term, event)
  })
  out.ctrlEnter = await take(() => {
    const event = { keycode: 36, mods: 2 }
    press(term, event)
    release(term, event)
  })
  out.upKitty = await take(() => {
    const event = { keycode: 126, mods: 0 }
    press(term, event)
    release(term, event)
  })
  const expectHex = {
    enter: '0d',
    up: '1b5b41',
    ctrlc: '03',
    backspace: '7f',
    a: '61',
    altqPlain: '1b71',
    altq: '1b5b3131333b3375',
    altqRepeat: '1b5b3131333b333a3275',
    altqRelease: '1b5b3131333b333a3375',
    ctrlAltQ: '1b5b3131333b3775',
    shiftEnter: '1b5b31333b32751b5b31333b323a3375',
    ctrlEnter: '1b5b31333b35751b5b31333b353a3375',
    upKitty: '1b5b313b313a31411b5b313b313a3341'
  }
  const bad = Object.keys(expectHex).filter((key) => out[key] !== expectHex[key])
  const report = { ok: bad.length === 0, bad, out }
  console.log(JSON.stringify(report))
  term.destroy()
  app.exit(report.ok ? 0 : 1)
}).catch((err) => {
  console.error(err)
  app.exit(1)
})
