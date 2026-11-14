// Minimal headless-Chrome driver over the DevTools protocol (no
// dependencies): Chrome is started with --remote-debugging-pipe and spoken to
// with NUL-separated JSON on file descriptors 3 (to Chrome) and 4 (from it).
'use strict';

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    try {
      const p = execFileSync('which', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (p) return p;
    } catch (e) { /* not found */ }
  }
  return null;
}

async function launch(chromePath) {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmlq-chrome-'));
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
    '--allow-file-access-from-files', '--remote-debugging-pipe', `--user-data-dir=${userDir}`,
    '--window-size=1280,800',
  ];
  // CI runners (and containers) often can't use Chrome's sandbox.
  if (process.env.CI || process.platform === 'linux') args.push('--no-sandbox');
  const proc = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  const toChrome = proc.stdio[3], fromChrome = proc.stdio[4];

  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  let buffer = '';
  fromChrome.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, i));
      buffer = buffer.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${method}: ${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of listeners) l(msg);
      }
    }
  });
  const exited = new Promise((resolve) => proc.on('exit', resolve));
  proc.on('exit', () => {
    for (const { reject, method } of pending.values()) reject(new Error(`Chrome exited during ${method}\n${stderr.slice(-2000)}`));
    pending.clear();
  });

  function send(method, params, sessionId) {
    const id = nextId++;
    const msg = { id, method, params: params || {} };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, method });
      toChrome.write(JSON.stringify(msg) + '\0');
    });
  }

  // Probe that Chrome answers.
  await send('Browser.getVersion');

  async function newPage() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    const waiters = [];
    listeners.push((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push((d.exception && d.exception.description) || d.text);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        // Missing files (e.g. a wrong shared/ path) show up here.
        errors.push('log: ' + msg.params.entry.text + (msg.params.entry.url ? ' ' + msg.params.entry.url : ''));
      }
      for (const w of waiters.slice()) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.params); }
    });
    const cmd = (method, params) => send(method, params, sessionId);
    await cmd('Runtime.enable');
    await cmd('Page.enable');
    await cmd('Log.enable');

    const waitFor = (method, ms = 10000) => new Promise((resolve, reject) => {
      const w = { method, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error(`timeout waiting for ${method}`)); } }, ms);
    });

    return {
      errors,
      async goto(url) {
        const loaded = waitFor('Page.loadEventFired');
        await cmd('Page.navigate', { url });
        await loaded;
      },
      // Evaluate an expression (may return a promise) and return its value.
      async eval(expression) {
        const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          throw new Error((d.exception && d.exception.description) || d.text);
        }
        return r.result.value;
      },
      setViewport: (width, height) => cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }),
      close: () => send('Target.closeTarget', { targetId }),
    };
  }

  async function close() {
    try { await send('Browser.close'); } catch (e) { /* already gone */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    if (proc.exitCode === null) proc.kill('SIGKILL');
    fs.rmSync(userDir, { recursive: true, force: true });
  }

  return { newPage, close };
}

module.exports = { findChrome, launch };
