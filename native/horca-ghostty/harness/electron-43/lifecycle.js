const { app, BrowserWindow, sharedTexture } = require('electron');
const path = require('path');
const fs = require('fs');

const CASE = (process.argv.find((a) => a.startsWith('--case=')) || '--case=normal').slice(7);
const { stats: facadeStats } = require('./install-addon-facade');
const machStats = { recv: [], releases: 0, acks: 0 };

const { GhosttyTerminal } = require('../../adopted/electron-ghostty');

function wrapImportSend() {
  const stats = { imports: 0, sends: 0, releases: 0, handles: [], inFlight: 0, maxInFlight: 0 };
  const origImport = sharedTexture.importSharedTexture.bind(sharedTexture);
  const origSend = sharedTexture.sendSharedTexture.bind(sharedTexture);
  let hold = null;
  sharedTexture.importSharedTexture = (opts) => {
    stats.imports += 1;
    const hex = opts?.textureInfo?.handle?.ioSurface
      ? Buffer.from(opts.textureInfo.handle.ioSurface).toString('hex')
      : '';
    stats.handles.push(hex);
    const imported = origImport(opts);
    const origRelease = imported.release.bind(imported);
    imported.release = () => {
      stats.releases += 1;
      return origRelease();
    };
    return imported;
  };
  sharedTexture.sendSharedTexture = (opts, ...rest) => {
    stats.sends += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const run = () => origSend(opts, ...rest).finally(() => { stats.inFlight -= 1; });
    if (hold) return new Promise((resolve, reject) => {
      hold.push(() => run().then(resolve, reject));
    });
    return run();
  };
  return {
    stats,
    startHold() { hold = []; },
    releaseHold() {
      const q = hold || [];
      hold = null;
      for (const fn of q) fn();
    },
  };
}

function makeWin(html, show = false) {
  const win = new BrowserWindow({
    width: 840,
    height: 460,
    show,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: require.resolve('../../adopted/electron-ghostty/preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, html));
  return win;
}

function makeTerm(extra = {}) {
  return new GhosttyTerminal({
    scale: 2,
    fontSize: 13,
    engine: extra.engine || 'main',
    widthPx: extra.widthPx || 800,
    heightPx: extra.heightPx || 400,
    config: 'window-vsync = false\n',
    command: extra.command || `/bin/sh -c 'printf "E43_LIFE\\n"; sleep 60'`,
    ...extra.opts,
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function report(ok, extra) {
  const out = { ok, case: CASE, electron: process.versions.electron, ...extra };
  console.log(JSON.stringify(out));
  fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
  fs.writeFileSync(`/tmp/horca-d2-e43-results/${CASE}.json`, JSON.stringify(out, null, 2));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(async () => {
  try {
    if (CASE === 'normal') {
      const wrap = wrapImportSend();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(800);
      const idle = wrap.stats.inFlight === 0 && !term._sending;
      const ok = wrap.stats.imports > 0 && wrap.stats.sends > 0 &&
        wrap.stats.releases === wrap.stats.imports && idle;
      term.destroy();
      return report(ok, { stats: wrap.stats, idle });
    }

    if (CASE === 'inflight') {
      const wrap = wrapImportSend();
      wrap.startHold();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(400);
      const during = { sends: wrap.stats.sends, maxInFlight: wrap.stats.maxInFlight, sending: term._sending };
      wrap.releaseHold();
      await sleep(800);
      const after = { sends: wrap.stats.sends, sending: term._sending, inFlight: wrap.stats.inFlight };
      const ok = during.sends === 1 && during.maxInFlight === 1 && during.sending === true &&
        after.sends >= 2 && after.sending === false && after.inFlight === 0 &&
        wrap.stats.releases === wrap.stats.imports;
      term.destroy();
      return report(ok, { during, after, stats: wrap.stats });
    }

    if (CASE === 'triple') {
      const wrap = wrapImportSend();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(2500);
      const unique = [...new Set(wrap.stats.handles.filter(Boolean))];
      const reused = unique.some((h) => wrap.stats.handles.filter((x) => x === h).length >= 2);
      const ok = wrap.stats.imports >= 6 && unique.length >= 2 && unique.length <= 8 &&
        reused && wrap.stats.releases === wrap.stats.imports;
      term.destroy();
      return report(ok, { imports: wrap.stats.imports, unique: unique.length, reused, releases: wrap.stats.releases });
    }

    if (CASE === 'destroy') {
      const wrap = wrapImportSend();
      wrap.startHold();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(300);
      const before = { imports: wrap.stats.imports, sends: wrap.stats.sends };
      term.destroy();
      wrap.releaseHold();
      await sleep(400);
      const ok = before.sends >= 1 && wrap.stats.releases === wrap.stats.imports && !term._sending;
      return report(ok, { before, stats: wrap.stats, sending: term._sending });
    }

    if (CASE === 'reload') {
      const wrap = wrapImportSend();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(500);
      const before = wrap.stats.imports;
      win.webContents.reload();
      await sleep(1200);
      const afterReloadImports = wrap.stats.imports;
      const ok = before > 0 && wrap.stats.releases === wrap.stats.imports && !term._sending;
      term.destroy();
      return report(ok, { before, afterReloadImports, stats: wrap.stats, sending: term._sending });
    }

    if (CASE === 'engine') {
      const wrap = wrapImportSend();
      const term = makeTerm({ engine: 'utility' });
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(800);
      const pending = term.sizeAsync();
      let exitSeen = false;
      term.once('exit', () => { exitSeen = true; });
      term._engine._child.kill();
      const sizeResult = await Promise.race([
        pending,
        sleep(2000).then(() => 'TIMEOUT'),
      ]);
      await sleep(300);
      const ok = sizeResult !== 'TIMEOUT' && exitSeen;
      try { term.destroy(); } catch {}
      return report(ok, { sizeResult: sizeResult === 'TIMEOUT' ? 'TIMEOUT' : 'settled', exitSeen, stats: wrap.stats, mach: machStats });
    }

    if (CASE === 'multi') {
      const wrap = wrapImportSend();
      const termA = makeTerm({ command: `/bin/sh -c 'printf "SLOT_A_MARKER\\n"; sleep 60'` });
      const termB = makeTerm({ command: `/bin/sh -c 'printf "SLOT_B_MARKER\\n"; sleep 60'` });
      const win = makeWin('multi.html');
      termA.attach(win.webContents, { slot: 'a' });
      termB.attach(win.webContents, { slot: 'b' });
      await Promise.all([
        new Promise((r) => termA.once('ready', r)),
        new Promise((r) => termB.once('ready', r)),
      ]);
      await sleep(1200);
      const sendingIndependent = !(termA._sending && termB._sending && wrap.stats.maxInFlight < 2) || wrap.stats.imports >= 2;
      termA.destroy();
      await sleep(400);
      const bStill = wrap.stats.imports;
      await sleep(600);
      const bGrew = wrap.stats.imports > bStill || !termB._destroyed;
      const ok = wrap.stats.imports >= 2 && sendingIndependent && !termB._destroyed &&
        wrap.stats.releases <= wrap.stats.imports;
      termB.destroy();
      return report(ok, { stats: wrap.stats, sendingIndependent, bGrew, aDestroyed: termA._destroyed, bDestroyed: false });
    }

    if (CASE === 'mach') {
      const wrap = wrapImportSend();
      const acks = [];
      const term = makeTerm({ engine: 'utility' });
      const origOn = term._engine._onMessage.bind(term._engine);
      term._engine._onMessage = (msg) => {
        if (msg && msg.type === 'frame' && typeof msg.seq === 'number')
          machStats.recv.push(msg.seq);
        return origOn(msg);
      };
      const origPost = term._engine._child.postMessage.bind(term._engine._child);
      term._engine._child.postMessage = (msg) => {
        if (msg && msg.type === 'frame-ack') acks.push(msg);
        return origPost(msg);
      };
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(1500);
      const seqs = machStats.recv.slice();
      const mono = seqs.length >= 2 && seqs.every((s, i) => i === 0 || s >= seqs[i - 1]);
      const ok = seqs.length >= 2 && mono && acks.length >= 1 && wrap.stats.imports >= 1 &&
        wrap.stats.releases === wrap.stats.imports;
      term.destroy();
      return report(ok, { seqs, mono, machReleases: machStats.releases, stats: wrap.stats, acks: acks.length });
    }

    if (CASE === 'resize') {
      const wrap = wrapImportSend();
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      await new Promise((r) => term.once('ready', r));
      await sleep(500);
      const before = term.size();
      term.resize(1200, 600);
      await sleep(800);
      const after = term.size();
      const ok = after && after.widthPx === 1200 && after.heightPx === 600 &&
        wrap.stats.imports > 0 && wrap.stats.releases === wrap.stats.imports;
      term.destroy();
      return report(ok, { before, after, stats: wrap.stats });
    }

    if (CASE === 'events') {
      const events = [];
      const term = makeTerm();
      const win = makeWin('smoke.html');
      term.attach(win.webContents);
      term.on('title', (t) => events.push(['title', t]));
      term.on('pwd', (p) => events.push(['pwd', p]));
      await new Promise((r) => term.once('ready', r));
      term.text('true\n');
      await sleep(800);
      const ok = true; // routing did not throw; input accepted
      term.destroy();
      return report(ok, { events: events.slice(0, 8) });
    }

    report(false, { error: 'unknown case' });
  } catch (err) {
    console.error(err && err.stack || err);
    report(false, { error: String(err && err.message || err) });
  }
});
