'use strict'
const { app } = require('electron')
const path = require('path')
const { GhosttyTerminal } = require(path.join(__dirname, '../../adopted/electron-ghostty'))

app.whenReady().then(() => {
  const marker = 'HELLO selection'
  const term = new GhosttyTerminal({
    engine: 'main',
    passthru: true,
    config: 'window-vsync = false\n',
    widthPx: 800,
    heightPx: 400,
    scale: 1
  })
  term.ptyData(Buffer.from(`${marker}\r\n`))
  for (let i = 0; i < 5; i += 1) term.tick()
  const size = term.size()
  const y = size.cellHeight * 0.5
  term.mousePos(size.cellWidth * 0.5, y, 0)
  term.mouseButton(1, 1, 0)
  term.mousePos(size.cellWidth * (marker.length + 0.5), y, 0)
  term.mouseButton(0, 1, 0)
  for (let i = 0; i < 8; i += 1) term.tick()
  const text = term.readSelection()
  console.log(JSON.stringify({ text }))
  term.destroy()
  app.exit(text === marker ? 0 : 1)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
