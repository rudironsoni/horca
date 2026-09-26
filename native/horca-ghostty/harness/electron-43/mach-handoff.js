const { app, BrowserWindow, sharedTexture } = require('electron');
const path = require('path');
const fs = require('fs');
const { stats, reset } = require('./install-addon-facade');
const { GhosttyTerminal } = require('../../adopted/electron-ghostty');

function wrapImportSend() {
  const st = { imports: 0, sends: 0, releases: 0 };
  const origImport = sharedTexture.importSharedTexture.bind(sharedTexture);
  const origSend = sharedTexture.sendSharedTexture.bind(sharedTexture);
  sharedTexture.importSharedTexture = (opts) => {
    st.imports += 1;
    const imported = origImport(opts);
    const origRelease = imported.release.bind(imported);
    imported.release = () => {
      st.releases += 1;
      return origRelease();
    };
    return imported;
  };
  sharedTexture.sendSharedTexture = (opts, ...rest) => origSend(opts, ...rest);
  return st;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  reset();
  const stImport = wrapImportSend();
  const frameMessages = [];
  const seqMatches = [];
  const term = new GhosttyTerminal({
    scale: 2,
    fontSize: 13,
    engine: 'utility',
    widthPx: 800,
    heightPx: 400,
    config: 'window-vsync = false\n',
    command: `/bin/sh -c 'printf "MACH_MARKER\\n"; sleep 60'`,
  });

  const origOn = term._engine._onMessage.bind(term._engine);
  term._engine._onMessage = (msg) => {
    if (msg && msg.type === 'frame') {
      frameMessages.push(msg.seq);
      const before = stats.machReceives.length;
      origOn(msg);
      const during = stats.machReceives.slice(before);
      const hit = during.find((x) => x && x.seq === msg.seq);
      seqMatches.push({ js: msg.seq, recv: hit ? hit.seq : null, calls: during });
      return;
    }
    return origOn(msg);
  };

  const origPost = term._engine._child.postMessage.bind(term._engine._child);
  const acks = [];
  let holdAck = false;
  const held = [];
  term._engine._child.postMessage = (msg) => {
    if (msg && msg.type === 'frame-ack') {
      if (holdAck) {
        held.push(msg);
        return;
      }
      acks.push(msg);
    }
    return origPost(msg);
  };

  const win = new BrowserWindow({
    width: 840, height: 460, show: false,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: require.resolve('../../adopted/electron-ghostty/preload.js'),
    },
  });
  holdAck = true;
  term.attach(win.webContents);
  win.loadFile(path.join(__dirname, 'smoke.html'));
  await new Promise((r) => term.once('ready', r));

  const waitSuccess = async (n, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (seqMatches.filter((p) => p.recv === p.js).length >= n) return;
      await sleep(50);
    }
  };

  await waitSuccess(1, 8000);
  const afterFirst = frameMessages.length;
  await sleep(900);
  const duringHold = frameMessages.length;
  const extraDuringHold = duringHold - afterFirst;
  holdAck = false;
  for (const msg of held) origPost(msg), acks.push(msg);
  held.length = 0;
  await waitSuccess(6, 10000);

  const successful = seqMatches.filter((p) => p.recv === p.js);
  const nonNullReceives = stats.machReceives.filter(Boolean);
  const mono = stats.receiveSeqs.length >= 2 &&
    stats.receiveSeqs.every((s, i) => i === 0 || s > stats.receiveSeqs[i - 1]);
  const seqAllMatch = successful.length >= 6 &&
    successful.every((p) => p.recv === p.js);
  const receivesEqualReleases = nonNullReceives.length === stats.machReleases;
  const backpressure = extraDuringHold === 0;
  const skipped = frameMessages.length - successful.length;

  const ok = seqAllMatch && mono && receivesEqualReleases && backpressure &&
    acks.length >= successful.length &&
    stImport.imports === stImport.releases &&
    nonNullReceives.length >= 6;

  const out = {
    ok,
    electron: process.versions.electron,
    frame_messages: frameMessages.length,
    frame_message_seqs: frameMessages,
    mach_receives: nonNullReceives.length,
    mach_receive_seqs: stats.receiveSeqs.slice(),
    null_receives: stats.machReceives.filter((x) => x == null).length,
    seq_matches: successful.length,
    mach_releases: stats.machReleases,
    frame_acks: acks.length,
    receives_equal_releases: receivesEqualReleases,
    ack_backpressure: backpressure,
    extra_frames_during_hold: extraDuringHold,
    sharedTexture_imported: stImport.imports,
    sharedTexture_released: stImport.releases,
    skipped_presentations: skipped,
  };
  console.log(JSON.stringify(out));
  fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
  fs.writeFileSync('/tmp/horca-d2-e43-results/mach-handoff.json', JSON.stringify(out, null, 2));
  try { term.destroy(); } catch {}
  app.exit(ok ? 0 : 1);
});
