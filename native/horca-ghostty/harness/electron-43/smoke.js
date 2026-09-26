const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { GhosttyTerminal } = require('../../adopted/electron-ghostty');

app.whenReady().then(() => {
  const term = new GhosttyTerminal({
    scale: 2,
    fontSize: 13,
    engine: 'main',
    widthPx: 800,
    heightPx: 400,
    config: 'window-vsync = false\n',
    command: `/bin/sh -c 'printf "E43_SMOKE_MARKER\\n"; sleep 60'`,
  });

  const win = new BrowserWindow({
    width: 840,
    height: 460,
    show: false,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: require.resolve('../../adopted/electron-ghostty/preload.js'),
    },
  });
  term.attach(win.webContents);

  let framesPresented = 0;
  let imports = 0;
  let releases = 0;
  const { sharedTexture } = require('electron');
  const origImport = sharedTexture.importSharedTexture.bind(sharedTexture);
  sharedTexture.importSharedTexture = (opts) => {
    imports += 1;
    const imported = origImport(opts);
    const origRelease = imported.release.bind(imported);
    imported.release = () => {
      releases += 1;
      return origRelease();
    };
    return imported;
  };
  term.on('frame', () => { framesPresented += 1; });
  term.on('present-error', (err) => console.error('present-error', err && err.message));

  win.loadFile(path.join(__dirname, 'smoke.html'));

  term.once('ready', () => { void (async () => {
    const t0 = Date.now();
    const deadline = t0 + 45000;
    let fg = 0;
    while (Date.now() < deadline) {
      const px = term.readPixels ? term.readPixels() : null;
      if (px && px.data) {
        const bg = px.data.readUInt32LE(0);
        fg = 0;
        for (let i = 0; i < px.data.length; i += 4)
          if (px.data.readUInt32LE(i) !== bg) fg++;
        if (fg > 200) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 400));
    let rendererFg = 0;
    try {
      const img = await win.webContents.capturePage();
      const bmp = img.toBitmap();
      const rbg = bmp.readUInt32LE(0);
      for (let i = 0; i < bmp.length; i += 4)
        if (bmp.readUInt32LE(i) !== rbg) rendererFg++;
    } catch (err) {
      console.error('capturePage', err && err.message);
    }
    const size = term.size();
    const ok = fg > 200 && framesPresented > 0 && rendererFg > 200 && imports > 0 && releases > 0;
    const out = {
      ok,
      electron: process.versions.electron,
      foregroundPixels: fg,
      rendererForegroundPixels: rendererFg,
      framesPresented,
      imports,
      releases,
      size,
      elapsedMs: Date.now() - t0,
    };
    console.log(JSON.stringify(out));
    fs.mkdirSync('/tmp/horca-d2-e43-results', { recursive: true });
    fs.writeFileSync('/tmp/horca-d2-e43-results/smoke.json', JSON.stringify(out, null, 2));
    term.destroy();
    app.exit(ok ? 0 : 1);
  })(); });
});
