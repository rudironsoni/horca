const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { createJiti } = require(path.join(process.env.HORCA_ORCA_WT, 'node_modules/jiti'));

const WT = process.env.HORCA_ORCA_WT;
const HORCA = process.env.HORCA_ROOT;
const ENGINE = process.argv.includes('--utility') ? 'utility' : 'main';
const FLOOD = Number(process.env.HORCA_FLOOD_BYTES || 8 * 1024 * 1024);
const jiti = createJiti(__filename, { interopDefault: true });
const { createPtySubprocess } = jiti(path.join(WT, 'src/main/daemon/pty-subprocess.ts'));
const { GhosttyHeadlessEmulator } = jiti(path.join(WT, 'src/main/daemon/ghostty-headless-emulator.ts'));
const { GhosttyTerminal } = require(path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty'));
const drainHandle = require('./drain-handle');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rssKb() {
  try { return Number(fs.readFileSync('/proc/self/statm', 'utf8').split(' ')[1]) * 4; } catch { return process.memoryUsage().rss / 1024; }
}

async function oneSession(id) {
  const handle = await createPtySubprocess({
    sessionId: 'bench-' + ENGINE + '-' + id,
    cols: 80, rows: 24, cwd: __dirname,
    env: { ...process.env, HORCA_CHILD_MODE: 'flood', HORCA_FLOOD_BYTES: String(FLOOD), PYTHONUNBUFFERED: '1' },
  });
  const emulator = new GhosttyHeadlessEmulator({ cols: 80, rows: 24 });
  const term = new GhosttyTerminal({
    scale: 2, fontSize: 13, engine: ENGINE, passthru: true,
    widthPx: 800, heightPx: 400, config: 'window-vsync = false\n',
  });
  let ipcOut = 0, ipcOutB = 0, ipcIn = 0, ipcInB = 0;
  handle.onData((data) => {
    ipcOut += 1; ipcOutB += Buffer.byteLength(data, 'latin1');
    term.ptyData(Buffer.from(data, 'latin1'));
    void emulator.write(data, { forwardQueryReplies: false });
  });
  term.on('pty-write', (buf) => {
    ipcIn += 1; ipcInB += buf.length;
    handle.write(Buffer.from(buf));
  });
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
  const tBlock = Date.now();
  await new Promise((r) => term.once('ready', r));
  const startup_block_ms = Date.now() - tBlock;
  handle.write(`exec python3 ${JSON.stringify(path.join(__dirname, 'child.py'))}\n`);
  return { handle, term, emulator, win, startup_block_ms, stats: () => ({ ipcOut, ipcOutB, ipcIn, ipcInB }) };
}

app.whenReady().then(async () => {
  const loops = [];
  const probe = setInterval(() => {
    const a = Date.now();
    setImmediate(() => loops.push(Date.now() - a));
  }, 20);
  const session = await oneSession('0');
  const first_frame_ms = await (async () => {
    const t = Date.now();
    while (Date.now() - t < 5000) {
      const px = session.term.readPixels && session.term.engine === 'main' ? session.term.readPixels() : true;
      if (px) return Date.now() - t;
      await sleep(20);
    }
    return -1;
  })();
  const tFlood = Date.now();
  let seen = false;
  while (Date.now() - tFlood < 60000) {
    const snap = String((session.emulator.getSnapshot() || {}).snapshotAnsi || '');
    if (snap.includes('FLOOD_SENTINEL')) { seen = true; break; }
    await sleep(50);
  }
  const e2e_ms = Date.now() - tFlood;
  const peak = rssKb();
  const st = session.stats();
  clearInterval(probe);
  loops.sort((a, b) => a - b);
  const pct = (p) => loops.length ? loops[Math.min(loops.length - 1, Math.floor(loops.length * p))] : -1;
  const out = {
    engine: ENGINE,
    electron: process.versions.electron,
    flood_bytes: FLOOD,
    e2e_ms,
    MB_per_sec: seen ? (FLOOD / 1024 / 1024) / (e2e_ms / 1000) : 0,
    seen_sentinel: seen,
    startup_block_ms: session.startup_block_ms,
    first_frame_ms,
    main_loop_p50: pct(0.5),
    main_loop_p95: pct(0.95),
    main_loop_p99: pct(0.99),
    main_loop_max: loops.length ? loops[loops.length - 1] : -1,
    peak_rss_kb: peak,
    output_IPC_messages: st.ipcOut,
    output_IPC_bytes: st.ipcOutB,
    output_avg_chunk: st.ipcOut ? st.ipcOutB / st.ipcOut : 0,
    input_IPC_messages: st.ipcIn,
    input_IPC_bytes: st.ipcInB,
    input_avg_chunk: st.ipcIn ? st.ipcInB / st.ipcIn : 0,
  };
  console.log(JSON.stringify(out));
  fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
  fs.writeFileSync(`/tmp/horca-d2-e43-results/bench-${ENGINE}.json`, JSON.stringify(out, null, 2));
  await drainHandle(session.handle);
  try { session.term.destroy(); } catch {}
  session.emulator.dispose();
  app.exit(seen ? 0 : 1);
});
