'use strict'
const { app } = require('electron')
const path = require('path')
const { GhosttyTerminal } = require(path.join(__dirname, '../../adopted/electron-ghostty'))

function selectLine(term) {
  const size = term.size()
  const y = size.cellHeight * 0.5
  term.mousePos(size.cellWidth * 0.5, y, 0)
  term.mouseButton(1, 1, 0)
  term.mousePos(size.cellWidth * 20, y, 0)
  term.mouseButton(0, 1, 0)
  for (let i = 0; i < 6; i += 1) term.tick()
  return term.readSelection()
}

app.whenReady().then(() => {
  const term = new GhosttyTerminal({
    engine: 'main',
    passthru: true,
    config: 'window-vsync = false\nmacos-option-as-alt = true\n',
    widthPx: 800,
    heightPx: 400,
    scale: 1
  })
  const prompt = 'PROMPT_HORCA'
  term.ptyData(Buffer.from(prompt + '\r\n'))
  for (let i = 0; i < 8; i += 1) term.tick()
  const before = selectLine(term)
  term.ptyData(Buffer.from('\x1b[H\x1b[2J\x1b[3J', 'utf8'))
  for (let i = 0; i < 8; i += 1) term.tick()
  const after = selectLine(term)
  console.log(JSON.stringify({ before, after }))
  term.destroy()
  const cleared = before === prompt && after === ''
  app.exit(cleared ? 0 : 1)
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
