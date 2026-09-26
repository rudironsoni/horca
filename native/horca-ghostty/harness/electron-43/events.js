const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
require('./install-addon-facade');
const { GhosttyTerminal } = require('../../adopted/electron-ghostty');

const MARKER = 'HORCA_E43_EVENT_MARKER';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const parentEvents = [];
  const titles = [];
  const term = new GhosttyTerminal({
    scale: 2,
    fontSize: 13,
    engine: 'utility',
    widthPx: 800,
    heightPx: 400,
    config: 'window-vsync = false\n',
    command: `/bin/sh -c 'printf "\\033]0;${MARKER}\\007"; sleep 60'`,
  });
  const origOn = term._engine._onMessage.bind(term._engine);
  term._engine._onMessage = (msg) => {
    if (msg && msg.type === 'event') parentEvents.push(msg.event);
    return origOn(msg);
  };
  term.on('title', (t) => titles.push(t));

  const win = new BrowserWindow({
    width: 840, height: 460, show: false,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: require.resolve('../../adopted/electron-ghostty/preload.js'),
    },
  });
  term.attach(win.webContents);
  win.loadFile(path.join(__dirname, 'smoke.html'));
  await new Promise((r) => term.once('ready', r));
  const t0 = Date.now();
  while (Date.now() - t0 < 8000 && !titles.includes(MARKER)) await sleep(50);

  const parentTitle = parentEvents.find((e) => e && e.type === 'title' && e.str === MARKER);
  const ok = titles.includes(MARKER) && !!parentTitle;
  const out = {
    ok,
    electron: process.versions.electron,
    generated_event: 'title',
    expected_payload: MARKER,
    observed_payload: titles[0] ?? null,
    titles,
    parent_events: parentEvents.slice(0, 8),
    parent_receive: !!parentTitle,
    EventEmitter_receive: titles.includes(MARKER),
  };
  console.log(JSON.stringify(out));
  fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
  fs.writeFileSync('/tmp/horca-d2-e43-results/events.json', JSON.stringify(out, null, 2));
  try { term.destroy(); } catch {}
  app.exit(ok ? 0 : 1);
});
