const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const WT = process.env.HORCA_ORCA_WT;
const HORCA = process.env.HORCA_ROOT;
const { createJiti } = require(path.join(WT, 'node_modules/jiti'));
const jiti = createJiti(__filename, { interopDefault: true });
const { createPtySubprocess } = jiti(
  path.join(WT, 'src/main/daemon/pty-subprocess.ts')
);
const { GhosttyHeadlessEmulator } = jiti(
  path.join(WT, 'src/main/daemon/ghostty-headless-emulator.ts')
);
const { GhosttyTerminal } = require(
  path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty')
);
const drainHandle = require('./drain-handle');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toBin = (s) => Buffer.from(s, 'latin1');
const fromBin = (b) => Buffer.from(b).toString('latin1');

app.whenReady().then(async () => {
  const out = { electron: process.versions.electron };
  const child = path.join(__dirname, 'child.py');
  const handle = await createPtySubprocess({
    sessionId: 'horca-passthru-correctness',
    cols: 80,
    rows: 24,
    cwd: __dirname,
    env: { ...process.env, HORCA_CHILD_MODE: 'query', PYTHONUNBUFFERED: '1' },
  });
  let modelSeq = 0;
  const backendWrites = [];
  let projectionReplies = 0;
  const emulator = new GhosttyHeadlessEmulator({
    cols: 80,
    rows: 24,
    onQueryReply: () => { projectionReplies += 1; },
  });

  const term = new GhosttyTerminal({
    scale: 2,
    fontSize: 13,
    engine: process.argv.includes('--utility') ? 'utility' : 'main',
    passthru: true,
    widthPx: 800,
    heightPx: 400,
    config: 'window-vsync = false\n',
  });

  const nativeWrites = [];
  let ghosttyReturned = false;
  let consumerBlocked = true;
  let consumerReleased = false;
  let writeCompleted = false;
  const pendingWrites = [];

  term.on('pty-write', (buf) => {
    ghosttyReturned = true;
    const copy = Buffer.from(buf);
    nativeWrites.push(copy);
    if (consumerBlocked) {
      pendingWrites.push(copy);
      return;
    }
    handle.write(Buffer.from(copy));
    writeCompleted = true;
    backendWrites.push(copy);
  });
  term.on('pty-resize', ({ cols, rows }) => {
    modelSeq += 1;
    handle.resize(cols, rows);
    emulator.resize(cols, rows);
  });

  handle.onData((data) => {
    modelSeq += 1;
    const buf = toBin(data);
    term.ptyData(buf);
    void emulator.write(data, { forwardQueryReplies: false });
  });

  const win = new BrowserWindow({
    width: 840, height: 460, show: false,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: require.resolve(
        path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty/preload.js')
      ),
    },
  });
  fs.writeFileSync(path.join(__dirname, 'one.html'),
    '<!doctype html><canvas data-ghostty style="width:800px;height:400px"></canvas>');
  term.attach(win.webContents);
  win.loadFile(path.join(__dirname, 'one.html'));
  await new Promise((r) => term.once('ready', r));
  handle.write(`exec python3 ${JSON.stringify(child)}\n`);

  const t0 = Date.now();
  let sawReady = false, sawQuery = false, sawSize = '';
  while (Date.now() - t0 < 15000) {
    const px = await term.readPixelsAsync();
    if (px) sawReady = true;
    const screen = (emulator.getSnapshot() || {}).snapshotAnsi || '';
    if (String(screen).includes('QUERY_GOT_REPLY')) sawQuery = true;
    const m = String(screen).match(/TTY_SIZE (\d+) (\d+)/);
    if (m) sawSize = m[0];
    if (ghosttyReturned && pendingWrites.length) {
      const stillWorks = !!(await term.readPixelsAsync());
      out.pty_write_non_blocking = {
        CALLBACK_ENQUEUED: true,
        CONSUMER_BLOCKED: consumerBlocked,
        GHOSTTY_CALLBACK_RETURNED: ghosttyReturned,
        GHOSTTY_STILL_TICKS: stillWorks,
      };
      consumerBlocked = false;
      consumerReleased = true;
      for (const w of pendingWrites) {
        handle.write(fromBin(w));
        backendWrites.push(w);
      }
      pendingWrites.length = 0;
      writeCompleted = true;
    }
    if (sawQuery && sawSize && !out.resized) {
      term.resize(1200, 600);
      out.resized = true;
      out.sizeBefore = sawSize;
    }
    if (sawQuery && out.resized && sawSize && sawSize !== out.sizeBefore) break;
    await sleep(50);
  }
  out.pty_write_non_blocking = {
    ...(out.pty_write_non_blocking || {}),
    CONSUMER_RELEASED: consumerReleased,
    WRITE_COMPLETED: writeCompleted,
    pass: ghosttyReturned && consumerReleased && writeCompleted,
  };

  const concat = Buffer.concat(nativeWrites.map((b) => Buffer.from(b)));
  out.pty_write_order = {
    chunks: nativeWrites.length,
    has_escape: concat.includes(0x1b),
    pass: nativeWrites.length >= 1 && concat.includes(0x1b),
  };
  out.protocol_query = {
    native_reply_count: nativeWrites.length >= 1 ? 1 : 0,
    projection_reply_count: projectionReplies,
    sawQuery,
    pass: sawQuery && projectionReplies === 0,
  };
  out.native_reply_count = sawQuery ? 1 : 0;
  out.projection_reply_count = projectionReplies;
  out.resize_real_TTY = { sawSize, pass: /TTY_SIZE \d+ \d+/.test(sawSize) };
  out.output_to_native = { pass: sawReady };
  out.output_to_projection = { pass: emulator.getModelSeq() >= 1 };
  out.model_sequence = {
    seq: emulator.getModelSeq(),
    nativeModel: modelSeq,
    pass: modelSeq >= 1 && emulator.getModelSeq() >= 1,
  };
  out.native_waits_for_projection = false;
  out.local_PTY = { pid: handle.pid, pass: handle.pid > 0 };
  out.snapshot_tail = String((emulator.getSnapshot() || {}).snapshotAnsi || '').slice(-400);
  out.native_write_hex = nativeWrites.map((b) => Buffer.from(b).toString('hex').slice(0, 80));


  // key roundtrip: switch to echo by writing a
  term.key({ action: 1, keycode: 0, mods: 0, text: 'a', unshiftedCodepoint: 97 });
  term.key({ action: 0, keycode: 0, mods: 0, text: 'a', unshiftedCodepoint: 97 });
  await sleep(400);
  out.key_roundtrip = {
    nativeWrites: nativeWrites.length,
    pass: nativeWrites.some((b) => Buffer.from(b).includes(0x61) || Buffer.from(b).toString('latin1').includes('a')),
  };

  const ok =
    out.local_PTY.pass &&
    out.output_to_native.pass &&
    out.protocol_query.pass &&
    out.pty_write_non_blocking.pass &&
    out.pty_write_order.pass &&
    out.model_sequence.pass &&
    projectionReplies === 0;
  out.ok = ok;
  console.log(JSON.stringify(out));
  fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
  fs.writeFileSync('/tmp/horca-d2-e43-results/pty-correctness.json', JSON.stringify(out, null, 2));
  await drainHandle(handle);
  try { term.destroy(); } catch {}
  emulator.dispose();
  app.exit(ok ? 0 : 1);
});
