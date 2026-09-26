'use strict';
/**
 * macOS Ghostty resource-lifetime fixture.
 *
 * Separate from packaged smoke. Creates a headless Ghostty surface,
 * presents a frame, and destroys it, then opens and closes several
 * surfaces the way split/close panes do. It does not cap product panes,
 * sign, or notarize.
 *
 * Pass: live native surface count, retained IOSurface ids, and retained
 * frame/import count return to the baseline. RSS / phys_footprint / GPU
 * working set must sit on a plateau rather than climb every cycle.
 */
const { app, BrowserWindow, sharedTexture } = require('electron');
const fs = require('fs');
const path = require('path');

const ADDON_DIR = path.join(__dirname, '../../adopted/electron-ghostty');
const { load } = require(path.join(ADDON_DIR, 'addon.js'));
const { GhosttyTerminal } = require(ADDON_DIR);
const OUT = process.env.HORCA_GPU_LIFETIME_OUT || '/tmp/horca-gpu-lifetime.json';

const CHURN_CYCLES = 10;
const PANE_STEPS = 4;
const CAP_PROBE = 8;
const PLATEAU_SPAN_BYTES = 96 * 1024 * 1024;
const RELEASE_GROWTH_BYTES = 64 * 1024 * 1024;
const GPU_PLATEAU_KB = 128 * 1024;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.on('window-all-closed', () => {
  // The pane fixture closes its window before the cap probe. Electron's
  // default is to quit here, which would drop the rest of the measurement.
});

const report = {
  ok: false,
  sha: process.env.HORCA_GPU_LIFETIME_SHA || null,
  electron: null,
  baseline: null,
  churn: [],
  panes: [],
  capProbe: null,
  windowBaseline: null,
  settled: null,
  imports: null,
  classification: null,
  error: null,
};

function save() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
}

function wrapImports() {
  const stats = { imports: 0, releases: 0, inFlight: 0, maxInFlight: 0 };
  const origImport = sharedTexture.importSharedTexture.bind(sharedTexture);
  sharedTexture.importSharedTexture = (opts) => {
    stats.imports += 1;
    stats.inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    const imported = origImport(opts);
    const origRelease = imported.release.bind(imported);
    imported.release = () => {
      stats.releases += 1;
      stats.inFlight -= 1;
      return origRelease();
    };
    return imported;
  };
  return stats;
}

function sample(addon) {
  const census = addon.resourceCensus();
  const metrics = app.getAppMetrics();
  const gpu = metrics.filter((metric) => metric.type === 'GPU');
  return {
    liveSurfaces: census.liveSurfaces,
    retainedFrames: census.retainedFrames,
    liveIoSurfaceIds: census.liveIoSurfaceIds,
    retainedIoSurfaceBytes: census.retainedIoSurfaceBytes,
    physFootprint: census.physFootprint,
    rss: process.memoryUsage().rss,
    gpuWorkingSetKb: gpu.reduce(
      (sum, metric) => sum + (metric.memory?.workingSetSize || 0),
      0,
    ),
    gpuPids: gpu.map((metric) => metric.pid),
  };
}

function pump(addon, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) addon.pumpMainQueue();
}

function surfaceOpts() {
  return {
    widthPx: 800,
    heightPx: 400,
    scale: 2,
    fontSize: 13,
    passthru: true,
    config: 'window-vsync = false\n',
  };
}

function presentNative(addon, handle) {
  addon.ptyData(handle, Buffer.from('HORCA_GPU_LIFE\r\n'));
  let frame = null;
  for (let i = 0; i < 50 && !frame; i += 1) {
    addon.tick(handle);
    addon.draw(handle);
    pump(addon, 20);
    frame = addon.frame(handle);
  }
  return frame;
}

function countsBack(sampleRow, baseline) {
  return (
    sampleRow.liveSurfaces === baseline.liveSurfaces &&
    sampleRow.retainedFrames === 0 &&
    sampleRow.liveIoSurfaceIds.length === 0 &&
    sampleRow.retainedIoSurfaceBytes === 0
  );
}

function span(values) {
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}

function memoryOf(row) {
  return row.physFootprint > 0 ? row.physFootprint : row.rss;
}

function classify(imports) {
  const base = report.baseline;
  const end = report.settled;
  if (!base || !end) return null;
  if (report.capProbe && report.capProbe.failedAt != null && report.capProbe.failedAt <= 4) {
    return 'native surface cap';
  }
  if (end.liveSurfaces > base.liveSurfaces) return 'Horca leak';
  if (end.retainedFrames > 0 || end.liveIoSurfaceIds.length > 0) {
    return 'destroy does not release';
  }
  if (imports && imports.imports > 0 && imports.releases !== imports.imports) {
    return 'destroy does not release';
  }
  const tail = report.churn.slice(2).map((row) => memoryOf(row.after));
  const tailGrowth = tail.length >= 2 ? tail[tail.length - 1] - tail[0] : 0;
  const monotonic =
    tail.length >= 2 &&
    tail.every((value, index) => index === 0 || value >= tail[index - 1] - 4 * 1024 * 1024);
  if (monotonic && tailGrowth > RELEASE_GROWTH_BYTES) return 'destroy does not release';
  if (span(tail) > PLATEAU_SPAN_BYTES && tailGrowth > RELEASE_GROWTH_BYTES) {
    return 'destroy does not release';
  }
  const closed = report.panes.filter((row) => row.step.startsWith('close'));
  const lastClose = closed.length > 0 ? closed[closed.length - 1].after : null;
  const gpuGrowth =
    report.windowBaseline && lastClose
      ? lastClose.gpuWorkingSetKb - report.windowBaseline.gpuWorkingSetKb
      : 0;
  if (gpuGrowth > GPU_PLATEAU_KB && end.liveSurfaces === base.liveSurfaces) {
    return 'destroy does not release';
  }
  const presented = report.churn.every((row) => row.presented);
  const returned = report.churn.every((row) => countsBack(row.after, base));
  const panesReturned =
    report.panes.length > 0 && countsBack(report.panes[report.panes.length - 1].after, base);
  if (presented && returned && panesReturned && span(tail) <= PLATEAU_SPAN_BYTES) {
    return 'CI-only pressure';
  }
  return null;
}

async function churn(addon) {
  for (let cycle = 0; cycle < CHURN_CYCLES; cycle += 1) {
    const handle = addon.create(surfaceOpts());
    const during = sample(addon);
    const frame = presentNative(addon, handle);
    const presented = sample(addon);
    addon.destroy(handle);
    pump(addon, 100);
    await sleep(50);
    const after = sample(addon);
    report.churn.push({
      cycle,
      presented: Boolean(frame),
      frameWidth: frame ? frame.width : 0,
      frameHeight: frame ? frame.height : 0,
      during,
      presentedSample: presented,
      after,
    });
    save();
    if (!frame || during.liveSurfaces < 1 || !countsBack(after, report.baseline)) break;
  }
}

function makeWindow() {
  return new BrowserWindow({
    width: 900,
    height: 500,
    show: false,
    webPreferences: {
      sandbox: true,
      backgroundThrottling: false,
      preload: path.join(ADDON_DIR, 'preload.js'),
    },
  });
}

async function openPane(win, addon, imports, slot) {
  const beforeRetained = sample(addon).retainedFrames;
  const beforeImports = imports.imports;
  const term = new GhosttyTerminal({
    ...surfaceOpts(),
    engine: 'main',
    widthPx: 800,
    heightPx: 400,
  });
  term.attach(win.webContents, { slot });
  term.ptyData(Buffer.from(`HORCA_PANE_${slot}\r\n`));
  const start = Date.now();
  while (Date.now() - start < 4000) {
    const now = sample(addon);
    if (now.retainedFrames > beforeRetained && imports.imports > beforeImports) break;
    await sleep(40);
  }
  return term;
}

async function paneFixture(addon, imports) {
  const win = makeWindow();
  await win.loadFile(path.join(__dirname, 'panes.html'));
  report.windowBaseline = sample(addon);
  save();
  const terms = [];
  for (let i = 0; i < PANE_STEPS; i += 1) {
    const slot = `p${i}`;
    const term = await openPane(win, addon, imports, slot);
    terms.push(term);
    report.panes.push({ step: `split ${terms.length}`, after: sample(addon) });
    save();
  }
  while (terms.length > 0) {
    const term = terms.pop();
    term.destroy();
    await sleep(200);
    report.panes.push({ step: `close ${terms.length}`, after: sample(addon) });
    save();
  }
  win.destroy();
  await sleep(200);
}

async function capProbe(addon) {
  const handles = [];
  let failedAt = null;
  try {
    for (let i = 0; i < CAP_PROBE; i += 1) {
      handles.push(addon.create(surfaceOpts()));
      presentNative(addon, handles[handles.length - 1]);
    }
  } catch (err) {
    failedAt = handles.length;
    report.error = String(err && err.message ? err.message : err);
  }
  const peak = sample(addon);
  for (const handle of handles) addon.destroy(handle);
  pump(addon, 150);
  await sleep(100);
  report.capProbe = { requested: CAP_PROBE, created: handles.length, failedAt, peak, after: sample(addon) };
  save();
}

app.whenReady().then(async () => {
  const imports = wrapImports();
  report.imports = imports;
  report.electron = process.versions.electron;
  try {
    const addon = load();
    if (typeof addon.resourceCensus !== 'function') {
      throw new Error('resourceCensus is missing from the Ghostty addon');
    }
    addon.init();
    pump(addon, 50);
    report.baseline = sample(addon);
    save();
    await churn(addon);
    await paneFixture(addon, imports);
    const drainStart = Date.now();
    while (imports.releases < imports.imports && Date.now() - drainStart < 3000) {
      await sleep(50);
    }
    await capProbe(addon);
    pump(addon, 200);
    await sleep(500);
    report.settled = sample(addon);
    report.imports = {
      imports: imports.imports,
      releases: imports.releases,
      inFlight: imports.inFlight,
      maxInFlight: imports.maxInFlight,
    };
    report.classification = classify(report.imports);
    const tail = report.churn.slice(2).map((row) => memoryOf(row.after));
    const countsOk =
      report.churn.length === CHURN_CYCLES &&
      report.churn.every(
        (row) =>
          row.presented &&
          row.presentedSample.retainedFrames >= 1 &&
          row.presentedSample.liveIoSurfaceIds.length >= 1 &&
          countsBack(row.after, report.baseline),
      ) &&
      countsBack(report.panes[report.panes.length - 1].after, report.baseline) &&
      report.panes.some(
        (row) => row.step === `split ${PANE_STEPS}` && row.after.liveSurfaces >= PANE_STEPS,
      ) &&
      countsBack(report.settled, report.baseline) &&
      report.capProbe.created === CAP_PROBE &&
      countsBack(report.capProbe.after, report.baseline);
    const plateauOk = span(tail) <= PLATEAU_SPAN_BYTES;
    const importsOk = imports.imports > 0 && imports.releases === imports.imports && imports.inFlight === 0;
    report.ok = Boolean(countsOk && plateauOk && importsOk && report.classification);
    save();
    console.log(`GPU_LIFETIME ${JSON.stringify(report)}`);
    app.exit(report.ok ? 0 : 1);
  } catch (err) {
    report.error = String(err && err.stack ? err.stack : err);
    report.classification = null;
    save();
    console.error(report.error);
    console.log(`GPU_LIFETIME ${JSON.stringify(report)}`);
    app.exit(1);
  }
});
