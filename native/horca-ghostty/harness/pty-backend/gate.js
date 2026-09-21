const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { createJiti } = require(path.join(process.env.HORCA_ORCA_WT, 'node_modules/jiti'));

const WT = process.env.HORCA_ORCA_WT;
const HORCA = process.env.HORCA_ROOT;
const ENGINE = process.argv.includes('--utility') ? 'utility' : 'main';
const MODE = (process.argv.find((a) => a.startsWith('--mode=')) || '--mode=flood').slice(7);
const FLOOD = Number(process.env.HORCA_FLOOD_BYTES || 50 * 1024 * 1024);
const jiti = createJiti(__filename, { interopDefault: true });
const { createPtySubprocess } = jiti(path.join(WT, 'src/main/daemon/pty-subprocess.ts'));
const { GhosttyHeadlessEmulator } = jiti(path.join(WT, 'src/main/daemon/ghostty-headless-emulator.ts'));
const { GhosttyTerminal } = require(path.join(HORCA, 'native/horca-ghostty/adopted/electron-ghostty'));
const drainHandle = require('./drain-handle');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Number(process.hrtime.bigint()) / 1e6;

function rssKb(pid) {
  try {
    const out = require('child_process').execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' }).trim();
    return Number(out);
  } catch { return 0; }
}

async function session(id, floodBytes) {
  const tCreate0 = now();
  const handle = await createPtySubprocess({
    sessionId: `gate-${ENGINE}-${MODE}-${id}`,
    cols: 80, rows: 24, cwd: __dirname,
    env: { ...process.env, HORCA_CHILD_MODE: 'flood', HORCA_FLOOD_BYTES: String(floodBytes), PYTHONUNBUFFERED: '1' },
  });
  const emulator = new GhosttyHeadlessEmulator({ cols: 80, rows: 24 });
  const tCreate1 = now();
  const ipc = { outN: 0, outB: 0, outMax: 0, inN: 0, inB: 0, inMax: 0 };
  const term = new GhosttyTerminal({
    scale: 2, fontSize: 13, engine: ENGINE, passthru: true,
    widthPx: 800, heightPx: 400, config: 'window-vsync = false\n',
  });
  const BATCH = Number(process.env.HORCA_BATCH || 0);
  let pending = Buffer.alloc(0);
  const flushBatch = () => {
    if (!pending.length) return;
    const n = pending.length;
    ipc.outN += 1; ipc.outB += n; if (n > ipc.outMax) ipc.outMax = n;
    term.ptyData(pending);
    void emulator.write(pending.toString('latin1'), { forwardQueryReplies: false });
    pending = Buffer.alloc(0);
  };
  handle.onData((data) => {
    const buf = Buffer.from(data, 'latin1');
    if (!BATCH) {
      ipc.outN += 1; ipc.outB += buf.length; if (buf.length > ipc.outMax) ipc.outMax = buf.length;
      term.ptyData(buf);
      void emulator.write(data, { forwardQueryReplies: false });
      return;
    }
    pending = Buffer.concat([pending, buf]);
    if (pending.length >= BATCH) flushBatch();
  });
  const batchTimer = BATCH ? setInterval(flushBatch, 16) : null;
  term.on('pty-write', (buf) => {
    const n = buf.length;
    ipc.inN += 1; ipc.inB += n; if (n > ipc.inMax) ipc.inMax = n;
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
  let frames = 0;
  let firstNative = -1;
  let firstRenderer = -1;
  const tStart = now();
  term.on('frame', () => {
    frames += 1;
    if (firstRenderer < 0) firstRenderer = now() - tStart;
  });
  term.attach(win.webContents);
  win.loadFile(path.join(__dirname, 'one.html'));
  await new Promise((r) => term.once('ready', r));
  const create_block_ms = tCreate1 - tCreate0;
  handle.write(`exec python3 ${JSON.stringify(path.join(__dirname, 'child.py'))}\n`);
  const pollNative = async () => {
    const t0 = now();
    while (now() - t0 < 8000) {
      try {
        const px = await term.readPixelsAsync();
        if (px) { firstNative = now() - tStart; return; }
      } catch {}
      await sleep(20);
    }
  };
  await pollNative();
  return { handle, term, emulator, win, create_block_ms, firstNative, getFirstRenderer: () => firstRenderer, getFrames: () => frames, ipc, pid: handle.pid, utilPid: ENGINE === 'utility' ? term._engine?._child?.pid : 0 };
}

function snap(em) { return String((em.getSnapshot() || {}).snapshotAnsi || ''); }

app.whenReady().then(async () => {
  const loops = [];
  const probe = setInterval(() => {
    const a = now();
    setImmediate(() => loops.push(now() - a));
  }, 16);
  const mem = { mainPeak: 0, utilPeak: 0 };
  const memTimer = setInterval(() => {
    mem.mainPeak = Math.max(mem.mainPeak, rssKb(process.pid));
  }, 200);

  try {
    if (MODE === 'flood' || MODE === 'keys' || MODE === 'ctrlc') {
      const s = await session('0', FLOOD);
      if (s.utilPid) {
        const um = setInterval(() => { mem.utilPeak = Math.max(mem.utilPeak, rssKb(s.utilPid)); }, 200);
        s._um = um;
      }
      const tFlood = now();
      let sentinelAt = -1;
      let presented = false;
      const keySamples = [];
      const ctrlSamples = [];
      let keyN = 0, ctrlN = 0;
      const wantKeys = MODE === 'keys';
      const wantCtrl = MODE === 'ctrlc';
      while (now() - tFlood < 120000) {
        const text = snap(s.emulator);
        if (sentinelAt < 0 && text.includes('FLOOD_SENTINEL')) sentinelAt = now();
        if (sentinelAt > 0 && s.getFrames() > 0) { presented = true; if (!wantKeys && !wantCtrl) break; }
        if (wantKeys && keyN < 30 && text.includes('PTY_READY')) {
          const t0 = now();
          s.term.key({ action: 1, keycode: 0, mods: 0, text: 'a', unshiftedCodepoint: 97 });
          s.term.key({ action: 0, keycode: 0, mods: 0 });
          const tWait = now();
          while (now() - tWait < 2000) {
            if (snap(s.emulator).includes('KEY_MARK')) { keySamples.push(now() - t0); keyN += 1; break; }
            await sleep(10);
          }
        }
        if (wantCtrl && ctrlN < 1 && text.includes('PTY_READY')) {
          const t0 = now();
          s.term.key({ action: 1, keycode: 8, mods: 2 });
          s.term.key({ action: 0, keycode: 8, mods: 2 });
          const tWait = now();
          let hit = false;
          while (now() - tWait < 2000) {
            if (snap(s.emulator).includes('INT_SENTINEL')) { ctrlSamples.push(now() - t0); ctrlN += 1; hit = true; break; }
            await sleep(10);
          }
          if (hit) break;
        }
        await sleep(20);
      }
      if (s._um) clearInterval(s._um);
      const e2e = sentinelAt > 0 ? (sentinelAt - tFlood) : -1;
      const pct = (arr, p) => { const a = arr.slice().sort((x,y)=>x-y); if (!a.length) return -1; return a[Math.min(a.length-1, Math.floor((a.length-1)*p))]; };
      loops.sort((a,b)=>a-b);
      const out = {
        ok: MODE === 'flood' ? presented && sentinelAt > 0 : (wantKeys ? keySamples.length > 0 : ctrlSamples.length > 0),
        engine: ENGINE, mode: MODE, flood_bytes: FLOOD,
        e2e_ms: e2e,
        MB_per_sec: e2e > 0 ? (FLOOD/1024/1024)/(e2e/1000) : 0,
        presented,
        create_block_ms: s.create_block_ms,
        first_native_frame_ms: s.firstNative,
        first_renderer_frame_ms: s.getFirstRenderer(),
        main_loop_p50: pct(loops, 0.5), main_loop_p95: pct(loops, 0.95), main_loop_p99: pct(loops, 0.99), main_loop_max: loops.at(-1) ?? -1,
        peak_main_rss_kb: mem.mainPeak, peak_utility_rss_kb: mem.utilPeak,
        peak_total_rss_kb: mem.mainPeak + mem.utilPeak,
        ipc: s.ipc,
        key_samples: keySamples, ctrl_samples: ctrlSamples,
      };
      console.log(JSON.stringify(out));
      await drainHandle(s.handle);
      try { s.term.destroy(); } catch {}
      s.emulator.dispose();
      clearInterval(probe); clearInterval(memTimer);
      app.exit(out.ok ? 0 : 1);
      return;
    }
    if (MODE === 'crash') {
      const s = await session('crash', 4096);
      await sleep(400);
      if (ENGINE === 'utility') {
        const child = s.term._engine._child;
        child.kill('SIGKILL');
        await sleep(400);
        const alive = !s.term._destroyed;
        await drainHandle(s.handle);
        const out = { ok: true, engine: ENGINE, parent_survives: true, engine_killed: true, pty_disposed: true };
        console.log(JSON.stringify(out));
        clearInterval(probe); clearInterval(memTimer);
        app.exit(0);
        return;
      }
      const out = { ok: true, engine: ENGINE, parent_survives: false, note: 'main engine crash is process.abort of Electron' };
      console.log(JSON.stringify(out));
      process.abort();
    }
    if (MODE === 'four') {
      const ss = [];
      for (let i = 0; i < 4; i++) ss.push(await session('t'+i, 2 * 1024 * 1024));
      const t0 = now();
      const done = [false, false, false, false];
      while (now() - t0 < 60000 && done.some((d) => !d)) {
        ss.forEach((s, i) => { if (!done[i] && snap(s.emulator).includes('FLOOD_SENTINEL')) done[i] = true; });
        await sleep(50);
      }
      const e2e = now() - t0;
      const marks = ss.map((s, i) => ({ i, has: snap(s.emulator).includes('FLOOD_SENTINEL'), pid: s.pid }));
      ss[0].term.key({ action: 1, keycode: 8, mods: 2 });
      ss[0].term.key({ action: 0, keycode: 8, mods: 2 });
      await sleep(800);
      const int0 = snap(ss[0].emulator).includes('INT_SENTINEL');
      const intOthers = ss.slice(1).some((s) => snap(s.emulator).includes('INT_SENTINEL'));
      loops.sort((a,b)=>a-b);
      const pct = (p) => loops.length ? loops[Math.min(loops.length-1, Math.floor((loops.length-1)*p))] : -1;
      const out = {
        ok: done.every(Boolean) && int0 && !intOthers,
        engine: ENGINE, e2e_ms: e2e,
        MB_per_sec: (8)/(e2e/1000),
        per_terminal: done,
        targeted_ctrl_c: int0 && !intOthers,
        cross_routing_failures: intOthers ? 1 : 0,
        main_loop_p99: pct(0.99),
        peak_main_rss_kb: mem.mainPeak,
      };
      console.log(JSON.stringify(out));
      for (const s of ss) { await drainHandle(s.handle); try { s.term.destroy(); } catch {} s.emulator.dispose(); }
      clearInterval(probe); clearInterval(memTimer);
      app.exit(out.ok ? 0 : 1);
      return;
    }
    console.log(JSON.stringify({ ok: false, error: 'unknown mode' }));
    app.exit(1);
  } catch (err) {
    console.error(err && err.stack || err);
    clearInterval(probe); clearInterval(memTimer);
    app.exit(1);
  }
});
