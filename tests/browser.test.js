// Browser tests: load every page in headless Chrome, interact with it, and
// fail on any uncaught exception, console error or missing file.
//
// Chrome is found via CHROME_PATH, the usual macOS location, or PATH. If it
// isn't available the tests are skipped, unless REQUIRE_BROWSER=1 (as in CI).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { findChrome, launch } = require('./helpers/chrome.js');

const ROOT = path.join(__dirname, '..');
const url = (p) => pathToFileURL(path.join(ROOT, p)).href;
const chromePath = findChrome();
const required = process.env.REQUIRE_BROWSER === '1';

// Helpers injected into every page.
const PAGE_HELPERS = `
  window.__t = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    frame: () => new Promise((r) => requestAnimationFrame(() => r())),
    key: (type, code, key) => window.dispatchEvent(new KeyboardEvent(type, { code, key: key || code, bubbles: true, cancelable: true })),
    press: (code, key) => { __t.key('keydown', code, key); __t.key('keyup', code, key); },
    pointer: (el, type, id, dx, dy) => {
      const r = el.getBoundingClientRect();
      const ev = new PointerEvent(type, { pointerId: id, bubbles: true, cancelable: true, isPrimary: id === 1,
        clientX: r.left + (dx == null ? r.width / 2 : dx), clientY: r.top + (dy == null ? r.height / 2 : dy) });
      (type === 'pointerdown' ? el : window).dispatchEvent(ev);
    },
    labels: (sel) => [...document.querySelectorAll(sel)].map((k) => k.getAttribute('aria-label')).join(','),
  };
`;

test('browser', { skip: !chromePath && !required && 'Chrome not found (set CHROME_PATH)' }, async (t) => {
  assert.ok(chromePath, 'Chrome is required (REQUIRE_BROWSER=1) but was not found');
  const browser = await launch(chromePath);
  t.after(() => browser.close());

  // Open a page, inject the helpers, run `fn`, and check for errors.
  async function withPage(file, fn) {
    const page = await browser.newPage();
    try {
      // Start from a clean slate: saved settings would leak between tests.
      await page.goto(url(file));
      await page.eval('localStorage.clear()');
      await page.goto(url(file));
      await page.eval(PAGE_HELPERS);
      await page.eval('__t.wait(150)');
      if (fn) await fn(page);
      await page.eval('__t.wait(100)');
      assert.deepEqual(page.errors, [], `errors on ${file}`);
    } finally {
      await page.close();
    }
  }

  await t.test('landing page lists every app and uses the shared theme', () => withPage('index.html', async (page) => {
    const cards = await page.eval(`[...document.querySelectorAll('a.item')].map((a) => a.getAttribute('href'))`);
    assert.deepEqual(cards, ['graph/', 'fifths/', 'drummer/', 'synth/', 'granular/', 'memory/']);
    const accent = await page.eval(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
    assert.match(accent, /^#[0-9a-f]{6}$/i);
  }));

  await t.test('shared library: knob, knob groups, slider panel, collapsible', () => withPage('synth/index.html', async (page) => {
    const r = await page.eval(`(() => {
      const N = window.nmlq, out = {};
      out.modules = ['audio', 'ui'].filter((m) => N[m]);

      // knob: keyboard, Home/End, double-click reset, set() without callbacks
      const seen = [];
      const k = N.ui.makeKnob({ label: 'Test', min: 0, max: 10, step: 1, value: 5, def: 2,
        onInput: (v) => seen.push(v), onChange: (v) => seen.push('change:' + v) });
      document.body.appendChild(k.el);
      k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      k.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
      k.el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      k.set(7);
      out.knobSeen = seen;
      out.knobAria = [k.el.getAttribute('role'), k.el.getAttribute('aria-valuenow')];

      // knob groups
      const box = document.body.appendChild(document.createElement('div'));
      const values = { w: 'sine', lvl: 50 };
      const changes = [];
      const g = N.ui.buildKnobGroups(box, [{ title: 'G', params: [
        { key: 'w', label: 'Wave', options: N.WAVES, value: 'sine' },
        { key: 'lvl', label: 'Level', min: 0, max: 100, step: 1, value: 50 },
      ] }], { values, onInput: (key, v) => { values[key] = v; changes.push(key + '=' + v); } });
      const sel = box.querySelector('select');
      sel.value = 'square'; sel.dispatchEvent(new Event('change'));
      box.querySelector('.knob').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      g.sync({ w: 'triangle', lvl: 10 });
      out.groups = { titles: box.querySelectorAll('.group-title').length, changes, select: sel.value,
        knobValue: box.querySelector('.knob').getAttribute('aria-valuenow') };

      // a group with an on/off switch
      const fxBox = document.body.appendChild(document.createElement('div'));
      const fx = { echoOn: false, echo: 30 }, fxChanges = [];
      const fxg = N.ui.buildKnobGroups(fxBox, [{ title: 'Echo', toggle: 'echoOn', params: [
        { key: 'echo', label: 'Mix', min: 0, max: 100, step: 1, value: 30 }] }],
        { values: fx, onInput: (key, v) => { fx[key] = v; fxChanges.push(key + '=' + v); } });
      const group = fxBox.querySelector('.group'), sw = fxBox.querySelector('.group-toggle input');
      const offAtStart = group.classList.contains('off');
      sw.click();
      const onAfterClick = !group.classList.contains('off');
      fxg.sync({ echoOn: false });
      out.toggle = { offAtStart, onAfterClick, fxChanges, offAfterSync: group.classList.contains('off'), checked: sw.checked };

      // slider panel with a toggleable slider
      const panelBox = document.body.appendChild(document.createElement('div'));
      const defs = [{ section: 'S' }, { key: 'on', label: 'On', bool: true },
        { key: 'rev', label: 'Reverb', min: 0, max: 100, step: 1, value: 35, unit: '%', toggle: true }];
      const params = {}, enabled = {};
      N.loadDefaults(defs, params, enabled);
      const changed = [];
      const p = N.ui.buildParamPanel({ defs, params, enabled, container: () => panelBox, onChange: (key) => changed.push(key) });
      const [toggle, rangeToggle] = panelBox.querySelectorAll('input[type=checkbox]');
      rangeToggle.click();
      const range = panelBox.querySelector('input[type=range]');
      range.value = '60'; range.dispatchEvent(new Event('input'));
      out.panel = { rows: panelBox.querySelectorAll('.param-row').length, changed, enabled: enabled.rev,
        disabled: panelBox.querySelector('.param-row:last-child').classList.contains('disabled'),
        value: panelBox.querySelector('.param-value').textContent, rev: params.rev };
      params.rev = 10; enabled.rev = true; p.sync();
      out.panel.synced = [range.value, panelBox.querySelector('.param-value').textContent];

      // collapsible
      const pnl = document.createElement('div'), btn = document.createElement('button');
      const states = [];
      const setCollapsed = N.ui.collapsible(btn, pnl, (c) => states.push(c));
      btn.click(); const afterClick = [pnl.classList.contains('collapsed'), btn.textContent];
      setCollapsed(false);
      out.collapse = { afterClick, states, text: btn.textContent };
      return out;
    })()`);
    assert.deepEqual(r.modules, ['audio', 'ui']);
    assert.deepEqual(r.knobSeen, [6, 'change:6', 10, 'change:10', 2, 'change:2']);
    assert.deepEqual(r.knobAria, ['slider', '7']);
    assert.deepEqual(r.groups, { titles: 1, changes: ['w=square', 'lvl=49'], select: 'triangle', knobValue: '10' });
    assert.deepEqual(r.toggle, { offAtStart: true, onAfterClick: true, fxChanges: ['echoOn=true'], offAfterSync: true, checked: false });
    assert.deepEqual(r.panel, { rows: 2, changed: ['rev', 'rev'], enabled: false, disabled: true, value: '60%', rev: 60, synced: ['10', '10%'] });
    assert.deepEqual(r.collapse, { afterClick: [true, 'Show'], states: [true, false], text: 'Hide' });
  }));

  await t.test('graph: panels build, buttons and pointer input work', () => withPage('graph/index.html', async (page) => {
    const rows = await page.eval(`[document.querySelectorAll('#controls-sound .param-row').length, document.querySelectorAll('#controls-physics .param-row').length]`);
    assert.ok(rows[0] > 20 && rows[1] > 15, `rows ${rows}`);
    await page.eval(`(async () => {
      document.getElementById('strum').click();
      const canvas = document.getElementById('stage');
      __t.pointer(canvas, 'pointerdown', 1, 100, 100);
      __t.pointer(canvas, 'pointermove', 1, 200, 160);
      __t.pointer(canvas, 'pointerup', 1, 200, 160);
      document.getElementById('shake').click();
      document.getElementById('reset').click();
      for (const b of document.querySelectorAll('[data-defaults]')) b.click();
      await __t.wait(300);
    })()`);
    const collapsed = await page.eval(`(() => { const b = document.querySelector('[data-collapse="panel-sound"]'); b.click();
      return [document.getElementById('panel-sound').classList.contains('collapsed'), b.textContent]; })()`);
    assert.deepEqual(collapsed, [true, 'Show']);
  }));

  await t.test('fifths: keys play chords, auto-play runs, stop and defaults work', () => withPage('fifths/index.html', async (page) => {
    const r = await page.eval(`(async () => {
      __t.key('keydown', 'Digit1', '1');
      await __t.frame(); await __t.frame();
      const glow = parseFloat(document.querySelector('.chord[data-id="0"]').style.getPropertyValue('--glow'));
      const now = document.getElementById('now').textContent;
      __t.key('keyup', 'Digit1', '1');
      __t.press('KeyQ', 'q');
      await __t.frame();
      const minor = document.getElementById('now').textContent;
      const auto = [...document.querySelectorAll('.param-row')].find((r) => r.textContent.includes('Play chords automatically')).querySelector('input');
      auto.click();
      await __t.wait(400);
      document.getElementById('stop').click();
      document.getElementById('defaults').click();
      __t.press('Escape');
      return { glow, now, minor, autoOff: !auto.checked, rows: document.querySelectorAll('.param-row').length };
    })()`);
    assert.equal(r.glow, 1);
    assert.equal(r.now, 'C');
    assert.equal(r.minor, 'Am');
    assert.equal(r.autoOff, true);
    assert.ok(r.rows > 20);
  }));

  await t.test('drummer: space plays the sequencer, knobs edit sounds', () => withPage('drummer/index.html', async (page) => {
    const r = await page.eval(`(async () => {
      const play = document.getElementById('play');
      document.body.focus();
      __t.key('keydown', 'Space', ' ');
      const playing = play.getAttribute('aria-pressed');
      await __t.wait(500);
      const lit = document.querySelectorAll('.step.now').length;
      __t.key('keydown', 'Space', ' ');
      const stopped = play.getAttribute('aria-pressed');
      const knob = document.querySelector('#editor .knob');
      const before = knob.getAttribute('aria-valuenow');
      knob.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      const after = knob.getAttribute('aria-valuenow');
      const step = document.querySelector('.step:not(.on)');
      __t.pointer(step, 'pointerdown', 1); __t.pointer(step, 'pointerup', 1);
      return { playing, lit, stopped, changed: before !== after, toggled: step.classList.contains('on'),
        knobs: document.querySelectorAll('.knob').length, waves: [...document.querySelector('#editor select:not([aria-label])').options].map((o) => o.value) };
    })()`);
    assert.equal(r.playing, 'true');
    assert.ok(r.lit > 0, 'a step lights up while playing');
    assert.equal(r.stopped, 'false');
    assert.equal(r.changed, true);
    assert.equal(r.toggled, true);
    assert.ok(r.knobs >= 3 + 12, `knobs ${r.knobs}`);
    assert.deepEqual(r.waves, ['sine', 'triangle', 'sawtooth', 'square']);
  }));

  await t.test('synth: keyboard, touch, sustain, octave, mono/poly, knobs', () => withPage('synth/index.html', async (page) => {
    const r = await page.eval(`(async () => {
      const out = {};
      const down = () => __t.labels('.key.down');
      out.keys = document.querySelectorAll('.key').length;
      __t.key('keydown', 'KeyZ'); __t.key('keydown', 'KeyC'); __t.key('keydown', 'KeyB');
      out.chord = down();
      await __t.wait(100);
      __t.key('keyup', 'KeyZ'); __t.key('keyup', 'KeyC'); __t.key('keyup', 'KeyB');
      out.released = down();
      __t.key('keydown', 'Space', ' '); __t.press('KeyQ'); out.held = __t.labels('.key.held');
      __t.key('keyup', 'Space', ' '); out.heldAfter = __t.labels('.key.held');
      __t.press('ArrowRight'); out.octUp = document.getElementById('oct-range').textContent;
      __t.press('ArrowLeft');
      document.getElementById('mono').click();
      __t.key('keydown', 'KeyZ'); __t.key('keydown', 'KeyX'); out.mono = down();
      __t.key('keyup', 'KeyX'); out.monoBack = down(); __t.key('keyup', 'KeyZ');
      document.getElementById('poly').click();
      const whites = document.querySelectorAll('.key.white');
      __t.pointer(whites[0], 'pointerdown', 1, null, whites[0].getBoundingClientRect().height - 5);
      __t.pointer(whites[4], 'pointerdown', 2, null, whites[4].getBoundingClientRect().height - 5);
      out.touch = down();
      const r1 = whites[1].getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: r1.left + r1.width / 2, clientY: r1.bottom - 5 }));
      out.slide = down();
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2 }));
      out.touchUp = down();
      const cutoff = [...document.querySelectorAll('.knob')].find((k) => k.getAttribute('aria-label') === 'Cutoff');
      const before = cutoff.getAttribute('aria-valuenow');
      cutoff.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
      out.cutoffChanged = before !== cutoff.getAttribute('aria-valuenow');
      out.octaveAfterKnob = document.getElementById('oct-range').textContent;
      document.getElementById('defaults').click();
      out.cutoffReset = cutoff.getAttribute('aria-valuenow');
      const span = document.getElementById('span');
      span.value = '5'; span.dispatchEvent(new Event('change'));
      out.keys5 = document.querySelectorAll('.key').length;
      span.value = '3'; span.dispatchEvent(new Event('change'));
      document.getElementById('panic').click();
      return out;
    })()`);
    assert.deepEqual(r, {
      keys: 37, chord: 'C3,E3,G3', released: '', held: 'C4', heldAfter: '', octUp: 'C4–C7',
      mono: 'C3,D3', monoBack: 'C3', touch: 'C3,G3', slide: 'D3,G3', touchUp: '',
      cutoffChanged: true, octaveAfterKnob: 'C3–C6', cutoffReset: '1800', keys5: 61,
    });
  }));

  await t.test('granular: demo plays grains, effects switch, HUD, recording, slots', () => withPage('granular/index.html', async (page) => {
    const r = await page.eval(`(async () => {
      const out = {};
      const hud = document.getElementById('hud');
      const slot = (i) => document.querySelectorAll('.slot')[i];
      const knob = (label) => [...document.querySelectorAll('.knob')].find((k) => k.getAttribute('aria-label') === label);
      const turn = (label, key, times) => { for (let i = 0; i < (times || 1); i++) knob(label).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); };
      out.keys = document.querySelectorAll('.key').length;
      out.demo = slot(0).textContent;

      // Play a chord on the demo sample: grains are spawned and drawn.
      __t.key('keydown', 'KeyZ'); __t.key('keydown', 'KeyC'); __t.key('keydown', 'KeyB');
      out.down = __t.labels('.key.down');
      await __t.wait(500);
      out.spawned = +hud.dataset.spawned;
      out.liveGrains = +hud.dataset.grains;
      __t.key('keyup', 'KeyZ'); __t.key('keyup', 'KeyC'); __t.key('keyup', 'KeyB');

      // Every effect switch, plus extreme grain settings.
      const switches = [...document.querySelectorAll('.group-toggle input')];
      out.effects = switches.map((s) => s.closest('.group-toggle').textContent);
      switches.forEach((s) => s.click());
      out.offGroups = document.querySelectorAll('.group.off').length;
      turn('Reverse', 'End'); turn('Pitch spray', 'PageUp', 3); turn('Spray', 'PageUp', 5);
      turn('Size', 'Home'); turn('Density', 'End'); turn('Scan speed', 'PageUp', 2);
      const windowSel = [...document.querySelectorAll('.field')].find((f) => f.textContent.includes('Window')).querySelector('select');
      windowSel.value = 'perc'; windowSel.dispatchEvent(new Event('change'));
      const before = +hud.dataset.spawned;
      __t.key('keydown', 'KeyQ'); await __t.wait(400); __t.key('keyup', 'KeyQ');
      out.moreGrains = +hud.dataset.spawned > before;
      switches.forEach((s) => s.click());

      // Click the display at 80%: the position knob follows.
      const r = hud.getBoundingClientRect();
      hud.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, bubbles: true, clientX: r.left + r.width * 0.8, clientY: r.top + r.height / 2 }));
      hud.dispatchEvent(new PointerEvent('pointerup', { pointerId: 5, bubbles: true }));
      out.position = knob('Position').getAttribute('aria-valuenow');

      // Freeze, mono, octave.
      document.getElementById('freeze').click();
      out.freeze = document.getElementById('freeze').getAttribute('aria-pressed');
      document.getElementById('mono').click();
      __t.key('keydown', 'KeyZ'); __t.key('keydown', 'KeyX'); out.mono = __t.labels('.key.down');
      __t.key('keyup', 'KeyX'); __t.key('keyup', 'KeyZ');
      document.getElementById('poly').click();
      __t.press('ArrowRight'); out.octave = document.getElementById('oct-range').textContent; __t.press('ArrowLeft');

      // Recording. Headless Chrome can't always open even a fake microphone,
      // so stand in for it: first a refusal, then a stream from an oscillator.
      slot(1).click();
      const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
      document.getElementById('record').click();
      await __t.wait(50);
      out.denied = document.getElementById('status').textContent;
      navigator.mediaDevices.getUserMedia = async () => {
        const ac2 = new AudioContext();
        const osc = ac2.createOscillator(), g = ac2.createGain(), dest = ac2.createMediaStreamDestination();
        g.gain.value = 0.5;
        osc.connect(g).connect(dest);
        osc.start();
        return dest.stream;
      };
      out.emptyText = slot(1).textContent;
      document.getElementById('record').click();
      for (let i = 0; i < 40 && document.getElementById('record').getAttribute('aria-pressed') !== 'true'; i++) await __t.wait(50);
      out.recording = document.getElementById('record').getAttribute('aria-pressed');
      await __t.wait(1600);
      document.getElementById('record').click();
      out.recorded = slot(1).textContent;
      out.status = document.getElementById('status').textContent;
      out.recPressed = document.getElementById('record').getAttribute('aria-pressed');
      navigator.mediaDevices.getUserMedia = realGUM;
      __t.key('keydown', 'KeyV'); await __t.wait(300); __t.key('keyup', 'KeyV');
      out.recGrains = +hud.dataset.spawned;

      // Clear it, then the demo button refills it.
      document.getElementById('clear').click();
      out.cleared = slot(1).textContent;
      document.getElementById('demo').click();
      out.refilled = slot(1).textContent;
      document.getElementById('defaults').click();
      out.reverseReset = knob('Reverse').getAttribute('aria-valuenow');
      document.getElementById('panic').click();
      return out;
    })()`);
    assert.equal(r.keys, 37);
    assert.equal(r.demo, '1 · Demo');
    assert.equal(r.down, 'C3,E3,G3');
    assert.ok(r.spawned > 10, `grains spawned: ${r.spawned}`);
    assert.ok(r.liveGrains > 0, 'grains are drawn on the display');
    assert.deepEqual(r.effects, ['Filter', 'Drive', 'Echo', 'Reverb']);
    assert.equal(r.offGroups, 2, 'filter and reverb switched off, drive and echo on');
    assert.equal(r.moreGrains, true);
    assert.equal(r.position, '80');
    assert.equal(r.freeze, 'true');
    assert.equal(r.mono, 'C3,D3');
    assert.equal(r.octave, 'C4–C7');
    assert.equal(r.emptyText, '2 · empty');
    assert.match(r.denied, /Microphone access was blocked/);
    assert.equal(r.recording, 'true', 'recording started');
    assert.equal(r.recPressed, 'false', 'recording stopped');
    assert.equal(r.recorded, '2 · Rec 1', r.status);
    assert.match(r.status, /Rec 1: \d+\.\d\d s in slot 2/);
    assert.ok(r.recGrains > r.spawned, 'the recording plays');
    assert.equal(r.cleared, '2 · empty');
    assert.equal(r.refilled, '2 · Demo');
    assert.equal(r.reverseReset, '0');
  }));

  await t.test('memory: sequence plays and grows, keys and taps repeat it, win, mistakes, sound screen', () => withPage('memory/index.html', async (page) => {
    const r = await page.eval(`(async () => {
      const out = {}, M = window.__memory;
      const $ = (id) => document.getElementById(id);
      const pad = (i) => document.querySelector('.pad[data-pad="' + i + '"]');
      const tap = (i) => { __t.pointer(pad(i), 'pointerdown', 1); window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 })); };
      const KEYS = ['KeyQ', 'KeyW', 'KeyS', 'KeyA'];
      const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); while (!fn()) { if (Date.now() > end) return false; await __t.wait(15); } return true; };
      const knob = (label) => [...document.querySelectorAll('.knob')].find((k) => k.getAttribute('aria-label') === label);
      const keyOn = (el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      const select = (label) => [...document.querySelectorAll('.field')].find((f) => f.querySelector('span').textContent === label).querySelector('select');
      const choose = (label, v) => { const s = select(label); s.value = v; s.dispatchEvent(new Event('change')); };
      const tags = () => [...document.querySelectorAll('.pad .tag')].map((t) => t.textContent).join(',');

      out.pads = document.querySelectorAll('.pad').length;
      out.tags = tags();
      out.state = document.body.dataset.state;
      out.soundHidden = $('sound').hidden;

      // Free play outside a game lights the pad while held.
      __t.pointer(pad(1), 'pointerdown', 3);
      out.freeLit = pad(1).classList.contains('lit');
      window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 3 }));
      out.freeOff = !pad(1).classList.contains('lit');

      // Quick game: fastest speed, shortest length.
      keyOn(knob('Speed'), 'End');
      keyOn(knob('Length'), 'Home');
      out.of = $('of').textContent;

      const seen = [];
      new MutationObserver((ms) => {
        for (const m of ms) if (m.target.classList.contains('lit') && document.body.dataset.state === 'demo') seen.push(+m.target.dataset.pad);
      }).observe($('board'), { subtree: true, attributes: true, attributeFilter: ['class'] });

      $('start').click();
      out.stopLabel = $('start').textContent;
      out.input1 = await until(() => M.state === 'input');
      out.round1 = { seq: M.sequence, seen: seen.slice(), count: $('count').textContent, status: $('status').textContent };
      tap(M.sequence[0]);
      out.input2 = await until(() => M.state === 'input' && M.sequence.length === 2);
      out.round2 = { prefixKept: M.sequence[0] === out.round1.seq[0], seen: seen.slice(1), seq: M.sequence };
      for (const p of M.sequence) __t.press(KEYS[p]);
      out.won = await until(() => M.state === 'won');
      out.wonStatus = $('status').textContent;
      out.best = $('best').textContent;

      // A wrong pad ends the game.
      $('start').click();
      await until(() => M.state === 'input');
      tap((M.sequence[0] + 1) % 4);
      out.lost = await until(() => M.state === 'lost');
      out.lostStatus = $('status').textContent;

      // With "Try again" the same sequence replays.
      choose('On a mistake', 'retry');
      $('start').click();
      await until(() => M.state === 'input');
      const first = M.sequence[0];
      tap((first + 1) % 4);
      out.replayed = await until(() => M.state === 'demo') && await until(() => M.state === 'input');
      out.retrySeq = M.sequence.length === 1 && M.sequence[0] === first;
      __t.press('Escape');
      out.stopped = [M.state, $('start').textContent, document.querySelectorAll('.pad.lit').length];

      // Sound screen: chords, root, octave and single pad notes.
      $('show-sound').click();
      out.soundShown = [$('sound').hidden, $('show-sound').getAttribute('aria-pressed')];
      out.groups = [...document.querySelectorAll('#sound .group-title')].map((g) => g.textContent);
      choose('Chord', 'm7');
      out.m7 = tags();
      choose('Root', '2');
      keyOn(knob('Octave'), 'ArrowDown');
      out.d3 = tags();
      choose('Pad 4 (yellow)', '84');
      out.custom = [select('Chord').value, tags()];
      const cutoff = knob('Cutoff');
      keyOn(cutoff, 'ArrowUp');
      out.cutoffChanged = cutoff.getAttribute('aria-valuenow') !== '2600';
      $('defaults').click();
      out.reset = [select('Chord').value, tags(), cutoff.getAttribute('aria-valuenow'), $('of').textContent];
      return out;
    })()`);
    assert.equal(r.pads, 4);
    assert.equal(r.tags, 'C4Q,E4W,G4S,B4A', 'C major 7th by default');
    assert.equal(r.state, 'idle');
    assert.equal(r.soundHidden, true);
    assert.equal(r.freeLit, true);
    assert.equal(r.freeOff, true);
    assert.equal(r.of, 'of 2');
    assert.equal(r.stopLabel, 'Stop');
    assert.equal(r.input1, true, 'the first round reaches the player');
    assert.equal(r.round1.seq.length, 1);
    assert.deepEqual(r.round1.seen, r.round1.seq, 'the pads light in sequence order');
    assert.equal(r.round1.count, '1');
    assert.equal(r.round1.status, 'Your turn');
    assert.equal(r.input2, true, 'a correct repeat adds a step');
    assert.equal(r.round2.prefixKept, true);
    assert.deepEqual(r.round2.seen, r.round2.seq);
    assert.equal(r.won, true, 'repeating the full length wins');
    assert.equal(r.wonStatus, 'You win! · 2 steps');
    assert.equal(r.best, 'Best 2');
    assert.equal(r.lost, true);
    assert.equal(r.lostStatus, 'Game over · 0 steps');
    assert.equal(r.replayed, true);
    assert.equal(r.retrySeq, true);
    assert.deepEqual(r.stopped, ['idle', 'Start', 0]);
    assert.deepEqual(r.soundShown, [false, 'true']);
    assert.deepEqual(r.groups, ['Notes', 'Oscillator 1', 'Oscillator 2', 'Mixer', 'Filter', 'Filter envelope', 'Amp envelope', 'Modulation (LFO)', 'Output']);
    assert.equal(r.m7, 'C4Q,D♯4W,G4S,A♯4A');
    assert.equal(r.d3, 'D3Q,F3W,A3S,C4A');
    assert.deepEqual(r.custom, ['custom', 'D3Q,F3W,A3S,C6A']);
    assert.equal(r.cutoffChanged, true);
    assert.deepEqual(r.reset, ['maj7', 'C4Q,E4W,G4S,B4A', '2600', 'of 12']);
  }));

  await t.test('no page scrolls sideways at phone width', async () => {
    for (const file of ['index.html', 'graph/index.html', 'fifths/index.html', 'drummer/index.html', 'synth/index.html', 'granular/index.html', 'memory/index.html']) {
      const page = await browser.newPage();
      try {
        await page.setViewport(390, 844);
        await page.goto(url(file));
        const [scrollW, innerW] = await page.eval('[document.documentElement.scrollWidth, window.innerWidth]');
        assert.ok(scrollW <= innerW, `${file}: content ${scrollW}px wider than ${innerW}px viewport`);
        assert.deepEqual(page.errors, [], `errors on ${file}`);
      } finally {
        await page.close();
      }
    }
  });
});
