const { app, BrowserWindow } = require('electron');
const path = require('path');
const { createJiti } = require(path.join(process.env.HORCA_ORCA_WT, 'node_modules/jiti'));
const WT = process.env.HORCA_ORCA_WT;
const HORCA = process.env.HORCA_ROOT;
const ENGINE = process.argv.includes('--utility') ? 'utility' : 'main';
const KIND = process.argv.includes('--ctrlc') ? 'ctrlc' : 'key';
const jiti = createJiti(__filename, { interopDefault: true });
const { createPtySubprocess } = jiti(path.join(WT, 'src/main/daemon/pty-subprocess.ts'));
const { GhosttyHeadlessEmulator } = jiti(path.join(WT, 'src/main/daemon/ghostty-headless-emulator.ts'));
const { GhosttyTerminal } = require(path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty'));
const drainHandle = require('./drain-handle');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;

app.whenReady().then(async () => {
  const child = path.join(__dirname, KIND === 'ctrlc' ? 'ctrlc-child.py' : 'key-child.py');
  const handle = await createPtySubprocess({
    sessionId: 'lat-' + ENGINE + '-' + KIND, cols: 80, rows: 24, cwd: __dirname,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  const emulator = new GhosttyHeadlessEmulator({ cols: 80, rows: 24 });
  const term = new GhosttyTerminal({
    scale: 2, fontSize: 13, engine: ENGINE, passthru: true,
    widthPx: 800, heightPx: 400, config: 'window-vsync = false\n',
  });
  handle.onData((data) => {
    term.ptyData(Buffer.from(data, 'latin1'));
    void emulator.write(data, { forwardQueryReplies: false });
  });
  term.on('pty-write', (buf) => handle.write(Buffer.from(buf)));
  term.on('pty-resize', ({ cols, rows }) => handle.resize(cols, rows));
  const win = new BrowserWindow({
    width: 840, height: 460, show: false,
    webPreferences: {
      sandbox: true, backgroundThrottling: false,
      preload: require.resolve(path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty/preload.js')),
    },
  });
  term.attach(win.webContents);
  win.loadFile(path.join(__dirname, 'one.html'));
  await new Promise((r) => term.once('ready', r));
  handle.write(`exec python3 ${JSON.stringify(child)}\n`);
  const ready = KIND === 'ctrlc' ? 'CTRLC_CHILD_READY' : 'KEY_CHILD_READY';
  const tWait = now();
  while (now() - tWait < 8000) {
    const t = String((emulator.getSnapshot() || {}).snapshotAnsi || '');
    if (t.includes(ready)) break;
    await sleep(20);
  }
  const samples = [];
  let timeouts = 0;
  for (let i = 1; i <= 30; i++) {
    const marker = KIND === 'ctrlc' ? `INT_SENTINEL ${i} SIGINT` : `KEY_MARK ${i}`;
    const t0 = now();
    if (KIND === 'ctrlc') {
      term.key({ action: 1, keycode: 8, mods: 2 });
      term.key({ action: 0, keycode: 8, mods: 2 });
    } else {
      term.key({ action: 1, keycode: 0, mods: 0, text: 'a', unshiftedCodepoint: 97 });
      term.key({ action: 0, keycode: 0, mods: 0 });
    }
    let hit = false;
    const t1 = now();
    while (now() - t1 < 2000) {
      const text = String((emulator.getSnapshot() || {}).snapshotAnsi || '');
      if (text.includes(marker)) { samples.push(now() - t0); hit = true; break; }
      await sleep(8);
    }
    if (!hit) timeouts += 1;
    await sleep(40);
  }
  const sorted = samples.slice().sort((a,b)=>a-b);
  const pct = (p) => sorted.length ? sorted[Math.min(sorted.length-1, Math.floor((sorted.length-1)*p))] : -1;
  const out = {
    ok: samples.length >= 30 && timeouts === 0,
    engine: ENGINE, kind: KIND, n: samples.length, timeouts,
    p50: pct(0.5), p95: pct(0.95), p99: pct(0.99), max: sorted.at(-1) ?? -1,
    samples,
    sigint_proven: KIND === 'ctrlc' && samples.length > 0,
  };
  console.log(JSON.stringify(out));
  await drainHandle(handle);
  try { term.destroy(); } catch {}
  emulator.dispose();
  app.exit(out.ok ? 0 : 1);
});
