const { app } = require('electron');
require('fs').writeSync(1, 'SCRIPT_LOADED\n');
const path = require('path');
const fs = require('fs');

const WT = process.env.HORCA_ORCA_WT;
const MODE = process.env.HORCA_SHUTDOWN_MODE || 'single';
let createPtySubprocess;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seq = [];
const sessionIds = [];
const handles = new Map();
const mark = (e, sessionId) => {
  const entry = { n: seq.length + 1, e, t: Date.now() };
  if (sessionId) entry.sessionId = sessionId;
  seq.push(entry);
};

function firstN(event, sessionId) {
  for (const entry of seq) {
    if (entry.e !== event) continue;
    if (sessionId && entry.sessionId !== sessionId) continue;
    return entry.n;
  }
  return 0;
}

function exitPrecedesDispose(ids) {
  if (!ids.length) return false;
  return ids.every((sessionId) => {
    const exitN = firstN('NATIVE_NODE_PTY_EXIT', sessionId);
    const disposeN = firstN('SUBPROCESS_HANDLE_DISPOSED', sessionId);
    return exitN > 0 && disposeN > 0 && exitN < disposeN;
  });
}

// Completion order, not a timer. Electron may quit only after this is true.
function shutdownOrderOk() {
  const prevented = seq.filter((entry) => entry.e === 'QUIT_PREVENTED_TEARDOWN');
  const begun = firstN('TERMINAL_HOST_SHUTDOWN_BEGUN');
  const resolved = firstN('TERMINAL_HOST_SHUTDOWN_RESOLVED');
  if (!begun || !resolved || prevented.length < 1) return false;
  if (!(prevented[0].n < begun && begun < resolved)) return false;
  // adversarial must quit again while dispose is in flight. One quit is a fail.
  if (MODE === 'adversarial') {
    if (prevented.length < 2) return false;
    if (!(prevented[1].n > begun && prevented[1].n < resolved)) return false;
  }
  if (!exitPrecedesDispose(sessionIds)) return false;
  return sessionIds.every((sessionId) => {
    const disposeN = firstN('SUBPROCESS_HANDLE_DISPOSED', sessionId);
    return disposeN > 0 && disposeN < resolved;
  });
}

process.on('uncaughtException', (err) => {
  console.error('uncaughtException', err && err.stack || err);
  app.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection', err);
});

function instrumentHandle(handle, sessionId) {
  const origDispose = handle.dispose.bind(handle);
  const origOnExit = handle.onExit.bind(handle);
  handle.dispose = () => {
    mark('SUBPROCESS_HANDLE_DISPOSED', sessionId);
    return origDispose();
  };
  handle.onExit = (cb) =>
    origOnExit((code, cause) => {
      mark('NATIVE_NODE_PTY_EXIT', sessionId);
      cb(code, cause);
    });
  return handle;
}

async function spawnSubprocess(opts) {
  const handle = instrumentHandle(
    await createPtySubprocess({
      ...opts,
      cwd: opts.cwd || __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...(opts.env || {}) },
    }),
    opts.sessionId
  );
  handles.set(opts.sessionId, handle);
  sessionIds.push(opts.sessionId);
  return handle;
}

function waitUntil(pred, ms) {
  const t0 = Date.now();
  return (async () => {
    while (Date.now() - t0 < ms) {
      if (pred()) return true;
      await sleep(10);
    }
    return pred();
  })();
}

async function attachSession(host, id, extra) {
  let output = '';
  let consumerExit = 0;
  const result = await host.createOrAttach({
    sessionId: id,
    cols: 80,
    rows: 24,
    cwd: __dirname,
    ...(extra || {}),
    streamClient: {
      onData: (data) => {
        output += data;
      },
      onExit: () => {
        consumerExit += 1;
      },
    },
  });
  return { result, getOutput: () => output, getConsumerExit: () => consumerExit };
}

async function bufferRoundtrip(host, id, getOutput) {
  const payload = Buffer.from([0xc3, 0xa9]);
  host.write(id, 'exec python3 ' + JSON.stringify(path.join(__dirname, 'hex-child.py')) + '\n');
  const ready = await waitUntil(() => getOutput().includes('HEX_READY'), 4000);
  if (!ready) throw new Error('no HEX_READY');
  handles.get(id).write(payload);
  handles.get(id).write('END');
  const hexOk = await waitUntil(() => getOutput().includes('HEX c3a9'), 4000);
  if (!hexOk) throw new Error('buffer bytes not preserved: ' + getOutput().slice(-200));
}

let hostShutdownResolved = false;
let host = null;
let quitArmed = false;
let disposeInFlight = false;

function armWillQuitBarrier() {
  app.on('will-quit', (event) => {
    if (quitArmed) {
      // A later quit while dispose is running must not let Electron leave.
      // pty.node delivers exit on a ThreadSafeFunction; freeing the
      // environment first aborts in ThrowAsJavaScriptException.
      if (disposeInFlight) {
        event.preventDefault();
        mark('QUIT_PREVENTED_TEARDOWN');
      }
      return;
    }
    event.preventDefault();
    mark('QUIT_PREVENTED_TEARDOWN');
    quitArmed = true;
    disposeInFlight = true;
    mark('TERMINAL_HOST_SHUTDOWN_BEGUN');
    const run = host ? host.dispose() : Promise.resolve();
    run
      .then(() => {
        hostShutdownResolved = true;
        mark('TERMINAL_HOST_SHUTDOWN_RESOLVED');
        const ok = shutdownOrderOk();
        console.log(
          JSON.stringify({
            ok,
            mode: MODE,
            seq,
            hostShutdownResolved,
          })
        );
        if (!ok) {
          app.exit(1);
          return;
        }
        // Host shutdown has resolved. This quit is the one that may exit.
        disposeInFlight = false;
        app.quit();
      })
      .catch((err) => {
        disposeInFlight = false;
        console.error('host.dispose', err && err.stack || err);
        app.exit(1);
      });
  });
}

app.whenReady().then(async () => {
  fs.writeSync(1, 'WHEN_READY\n');
  console.log('WHEN_READY');
  const { createJiti } = require(path.join(WT, 'node_modules/jiti'));
  const jiti = createJiti(__filename, { interopDefault: true });
  createPtySubprocess = jiti(path.join(WT, 'src/main/daemon/pty-subprocess.ts')).createPtySubprocess;
  const { TerminalHost } = jiti(path.join(WT, 'src/main/daemon/terminal-host.ts'));
  fs.writeSync(1, 'JITI_LOADED\n');
  if (MODE === 'whenready') {
    console.log(JSON.stringify({ ok: true, mode: MODE, seq }));
    app.exit(0);
    return;
  }
  host = new TerminalHost({ spawnSubprocess });
  armWillQuitBarrier();

  const sessions = [];
  const count = MODE === 'four' ? 4 : 1;
  for (let i = 0; i < count; i++) {
    const id = 'shut-' + MODE + '-' + i;
    if (MODE === 'natural') {
      const s = await attachSession(host, id, {
        command: 'printf NAT_READY\\n; exit 0',
      });
      sessions.push({ id, ...s });
      const exited = await waitUntil(() => s.getConsumerExit() > 0, 4000);
      if (!exited) throw new Error('natural child did not exit');
    } else if (MODE === 'inflight') {
      const s = await attachSession(host, id);
      sessions.push({ id, ...s });
      host.write(id, 'exec python3 -c "import sys,time\\nwhile True:\\n sys.stdout.write(\\"TICK\\\\n\\")\\n sys.stdout.flush()\\n time.sleep(0.02)"\n');
      const ticking = await waitUntil(() => s.getOutput().includes('TICK'), 4000);
      if (!ticking) throw new Error('inflight child produced no TICK');
    } else {
      const s = await attachSession(host, id);
      sessions.push({ id, ...s });
      await bufferRoundtrip(host, id, s.getOutput);
    }
  }

  if (MODE === 'race') {
    const s = sessions[0];
    host.write(s.id, '\x03');
  }

  if (MODE === 'adversarial') {
    // Second quit is synchronous, before dispose can resolve, so will-quit
    // runs again while shutdown is in flight and must preventDefault.
    app.quit();
    app.quit();
    return;
  }
  app.quit();
}).catch((err) => {
  console.error('whenReady', err && err.stack || err);
  app.exit(1);
});
