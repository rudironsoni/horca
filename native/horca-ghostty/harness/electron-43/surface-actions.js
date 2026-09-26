'use strict'
const { app } = require('electron')
const path = require('path')
const { GhosttyTerminal } = require(path.join(__dirname, '../../adopted/electron-ghostty'))

app.whenReady().then(() => {
  const url = 'https://horca.example/d2'
  const term = new GhosttyTerminal({
    engine: 'main',
    passthru: true,
    config: 'window-vsync = false\nmacos-option-as-alt = true\n',
    widthPx: 900,
    heightPx: 400,
    scale: 1
  })
  const screen = `\x1b]8;;${url}\x1b\\LINK\x1b]8;;\x1b\\\r\nALPHA BETA ALPHA\r\n`
  term.ptyData(Buffer.from(screen, 'utf8'))
  for (let i = 0; i < 8; i += 1) term.tick()
  const size = term.size()
  const link = term.hyperlinkAt(size.cellWidth * 0.5, size.cellHeight * 0.5)
  term.selectAll()
  for (let i = 0; i < 4; i += 1) term.tick()
  const selected = term.readSelection()
  const found = term.search('BETA')
  const missed = term.search('ZZZZNOTHERE')
  const report = { link, selected, found, missed }
  console.log(JSON.stringify(report))
  term.destroy()
  const ok = link === url && selected.includes('ALPHA') && selected.includes('BETA') && found === true && missed === false
  app.exit(ok ? 0 : 1)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
