const { app } = require('electron');
const path = require('path');
const WT = process.env.HORCA_ORCA_WT;
const MODE = process.argv.includes('--buffer') ? 'buffer' : 'latin1';
const drainHandle = require('./drain-handle');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CASES = [
  { name: 'ASCII_CONTROL', bytes: Buffer.from([0x03]) },
  { name: 'ESC', bytes: Buffer.from([0x1b, 0x5b, 0x41]) },
  { name: 'DEL', bytes: Buffer.from([0x7f]) },
  { name: 'UTF8_E_ACUTE', bytes: Buffer.from([0xc3, 0xa9]) },
  { name: 'UTF8_EMOJI', bytes: Buffer.from([0xf0, 0x9f, 0x99, 0x82]) },
  { name: 'SPLIT_MULTIBYTE', bytes: Buffer.from([0xc3, 0xa9]), split: [Buffer.from([0xc3]), Buffer.from([0xa9])] },
];

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err && err.stack || err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});
app.whenReady().then(async () => {
  const { createJiti } = require(path.join(WT, 'node_modules/jiti'));
  const jiti = createJiti(__filename, { interopDefault: true });
  const { createPtySubprocess } = jiti(path.join(WT, 'src/main/daemon/pty-subprocess.ts'));
  const results = [];
  const handles = [];
  for (const c of CASES) {
    const handle = await createPtySubprocess({
      sessionId: 'bytes-' + c.name,
      cols: 80, rows: 24, cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });
    let got = '';
    handle.onData((data) => { got += data; });
    handle.write(`exec python3 ${JSON.stringify(path.join(__dirname, 'hex-child.py'))}\n`);
    const t0 = Date.now();
    while (Date.now() - t0 < 4000 && !got.includes('HEX_READY')) await sleep(20);
    const parts = c.split || [c.bytes];
    for (const p of parts) {
      if (MODE === 'latin1') handle.write(p.toString('latin1'));
      else handle.write(p);
    }
    handle.write('END');
    const t1 = Date.now();
    while (Date.now() - t1 < 4000 && !got.includes('HEX ')) await sleep(20);
    const m = got.match(/HEX ([0-9a-f]*)/);
    const ptyHex = m ? m[1] : '';
    const inputHex = c.bytes.toString('hex');
    results.push({ name: c.name, INPUT_BYTES: inputHex, PTY_BYTES: ptyHex, EQUAL: inputHex === ptyHex });
    handles.push(handle);
  }
  const ok = results.every((r) => r.EQUAL);
  console.log(JSON.stringify({ mode: MODE, ok, results }));
  for (const h of handles) {
    await drainHandle(h);
  }
  app.exit(ok ? 0 : 1);
});
