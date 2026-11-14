// Unit tests for shared/core.js (pure helpers).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../shared/core.js');

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('clamp keeps values inside the range', () => {
  assert.equal(N.clamp(5, 0, 10), 5);
  assert.equal(N.clamp(-1, 0, 10), 0);
  assert.equal(N.clamp(11, 0, 10), 10);
});

test('midiFreq: A4 = 440 Hz, octaves double', () => {
  close(N.midiFreq(69), 440);
  close(N.midiFreq(81), 880);
  close(N.midiFreq(57), 220);
  close(N.midiFreq(60), 261.6255653005986);
});

test('noteName uses C4 = 60 and handles octaves', () => {
  assert.equal(N.noteName(60), 'C4');
  assert.equal(N.noteName(69), 'A4');
  assert.equal(N.noteName(61), 'C♯4');
  assert.equal(N.noteName(61, N.FLATS), 'D♭4');
  assert.equal(N.noteName(12), 'C0');
  assert.equal(N.noteName(48), 'C3');
});

test('circlePos maps the circle of fifths and is its own inverse', () => {
  assert.deepEqual([0, 1, 2, 3].map(N.circlePos), [0, 7, 2, 9]);
  for (let pc = 0; pc < 12; pc++) assert.equal(N.circlePos(N.circlePos(pc)), pc);
});

test('WAVES are the four oscillator types in display order', () => {
  assert.deepEqual(N.WAVES.map((w) => w[0]), ['sine', 'triangle', 'sawtooth', 'square']);
});

test('note name tables have 12 entries each', () => {
  assert.equal(N.SHARPS.length, 12);
  assert.equal(N.FLATS.length, 12);
});

test('formatters', () => {
  assert.equal(N.fmt.hz(440), '440 Hz');
  assert.equal(N.fmt.hz(1800), '1.80 kHz');
  assert.equal(N.fmt.hz(12000), '12.0 kHz');
  assert.equal(N.fmt.ms(0), '0 ms');
  assert.equal(N.fmt.ms(0.5), '0.5 ms');
  assert.equal(N.fmt.ms(4), '4 ms');
  assert.equal(N.fmt.ms(300), '300 ms');
  assert.equal(N.fmt.ms(1250), '1.25 s');
  assert.equal(N.fmt.pct(69.6), '70%');
  assert.equal(N.fmt.signed(7), '+7');
  assert.equal(N.fmt.signed(-3), '-3');
  assert.equal(N.fmt.signed(0), '0');
  assert.equal(N.fmt.signedPct(40), '+40%');
  assert.equal(N.fmt.step({ step: 0.1, unit: 's' }, 4), '4.0s');
  assert.equal(N.fmt.step({ step: 1, unit: '%' }, 60), '60%');
  assert.equal(N.fmt.step({ step: 0.05 }, 0.25), '0.25');
});

const DEFS = [
  { section: 'Sound' },
  { key: 'soundOn', label: 'Sound on', bool: true },
  { key: 'wave', label: 'Waveform', options: N.WAVES, select: 'triangle' },
  { key: 'mode', label: 'Mode', options: [['a', 'A'], ['b', 'B']], value: 'b' },
  { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 60 },
  { key: 'reverb', label: 'Reverb', min: 0, max: 100, step: 1, value: 35, toggle: true },
  { key: 'vibrato', label: 'Vibrato', min: 1, max: 40, step: 1, value: 6, toggle: false },
];

test('defaultValue reads bool / select / value', () => {
  assert.equal(N.defaultValue(DEFS[1]), true);
  assert.equal(N.defaultValue(DEFS[2]), 'triangle');
  assert.equal(N.defaultValue(DEFS[3]), 'b');
  assert.equal(N.defaultValue(DEFS[4]), 60);
});

test('loadDefaults fills params and toggle state, skipping sections', () => {
  const params = {}, enabled = {};
  N.loadDefaults(DEFS, params, enabled);
  assert.deepEqual(params, { soundOn: true, wave: 'triangle', mode: 'b', volume: 60, reverb: 35, vibrato: 6 });
  assert.deepEqual(enabled, { reverb: true, vibrato: false });
});

test('loadDefaults with a filter only resets matching definitions', () => {
  const params = { volume: 10, wave: 'square' };
  N.loadDefaults(DEFS, params, null, (d) => d.key === 'volume');
  assert.deepEqual(params, { volume: 60, wave: 'square' });
});

test('restoreParams accepts valid values, clamps numbers, rejects junk', () => {
  const params = {}, enabled = {};
  N.loadDefaults(DEFS, params, enabled);
  N.restoreParams(DEFS, params, {
    soundOn: 'yes',        // wrong type -> ignored
    wave: 'sawtooth',      // valid option
    mode: 'z',             // unknown option -> ignored
    volume: 250,           // clamped
    reverb: NaN,           // not finite -> ignored
    vibrato: '12',         // wrong type -> ignored
    extra: 1,              // unknown key -> ignored
  }, enabled, { reverb: false, vibrato: 'on', volume: false });
  assert.deepEqual(params, { soundOn: true, wave: 'sawtooth', mode: 'b', volume: 100, reverb: 35, vibrato: 6 });
  assert.deepEqual(enabled, { reverb: false, vibrato: false });
  assert.ok(!('volume' in enabled), 'only toggleable keys get an enabled flag');
});

test('restoreParams tolerates missing or broken saved data', () => {
  const params = { volume: 60 };
  for (const saved of [null, undefined, 'x', 42]) {
    N.restoreParams(DEFS, params, saved);
    assert.equal(params.volume, 60);
  }
});

test('loadJSON / saveJSON survive missing and throwing storage', () => {
  const had = 'localStorage' in globalThis;
  const old = globalThis.localStorage;
  try {
    const store = {};
    globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } };
    assert.equal(N.saveJSON('k', { a: 1 }), true);
    assert.deepEqual(N.loadJSON('k'), { a: 1 });
    assert.equal(N.loadJSON('missing'), null);
    store.bad = '{not json';
    assert.equal(N.loadJSON('bad'), null);

    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(N.loadJSON('k'), null);
    assert.equal(N.saveJSON('k', 1), false);
  } finally {
    if (had) globalThis.localStorage = old; else delete globalThis.localStorage;
  }
});

test('pluckValue: linear attack, exponential decay to 0.0001', () => {
  const v = { t: 1, atk: 0.1, dec: 2, peak: 0.2 };
  assert.equal(N.pluckValue(v, 0.5), 0);
  close(N.pluckValue(v, 1.05), 0.1);
  close(N.pluckValue(v, 1.1), 0.2);
  close(N.pluckValue(v, 3.1), 0.0001);
  close(N.pluckValue(v, 10), 0.0001);
  assert.ok(N.pluckValue(v, 2) < 0.2 && N.pluckValue(v, 2) > 0.0001);
});

test('adsrValue: attack from current level, decay towards sustain, release to 0', () => {
  const on = { stage: 'on', t: 0, from: 0.05, peak: 0.2, sustain: 0.1, a: 0.1, d: 0.5 };
  close(N.adsrValue(on, 0), 0.05);
  close(N.adsrValue(on, 0.05), 0.125);
  close(N.adsrValue(on, 0.1), 0.2);
  // After the decay time the level is within e^-5 of the sustain level.
  close(N.adsrValue(on, 0.6), 0.1 + 0.1 * Math.exp(-5));
  close(N.adsrValue(on, 100), 0.1, 1e-12);

  const rel = { stage: 'rel', t: 1, level: 0.1, r: 0.3 };
  close(N.adsrValue(rel, 1), 0.1);
  close(N.adsrValue(rel, 1.3), 0.1 * Math.exp(-5));
  assert.equal(N.adsrValue({}, 5), 0);
});

test('adsrValue is continuous across the attack/decay boundary', () => {
  const e = { stage: 'on', t: 0, from: 0, peak: 1, sustain: 0.5, a: 0.2, d: 1 };
  close(N.adsrValue(e, 0.2 - 1e-9), N.adsrValue(e, 0.2), 1e-6);
});

test('tanhCurve is odd, monotonic and normalised to ±1', () => {
  const c = N.tanhCurve(5, 1025);
  assert.equal(c.length, 1025);
  close(c[0], -1, 1e-6);
  close(c[1024], 1, 1e-6);
  close(c[512], 0, 1e-6);
  for (let i = 1; i < c.length; i++) assert.ok(c[i] >= c[i - 1]);
  for (let i = 0; i < 512; i++) close(c[i], -c[1024 - i], 1e-6);
});

test('fillImpulse fades from noise to silence', () => {
  let k = 0;
  const rand = () => [1, 0][k++ % 2]; // alternates +1, -1
  const d = N.fillImpulse(new Float32Array(1000), rand);
  close(d[0], 1, 1e-6);
  close(d[1], -Math.pow(1 - 1 / 1000, 3), 1e-6);
  assert.ok(Math.abs(d[999]) < 1e-7);
  const r = N.fillImpulse(new Float32Array(500));
  for (const x of r) assert.ok(x >= -1 && x <= 1);
});

test('fillNoise stays within [-1, 1]', () => {
  const d = N.fillNoise(new Float32Array(2000));
  let nonzero = 0;
  for (const x of d) { assert.ok(x >= -1 && x <= 1); if (x !== 0) nonzero++; }
  assert.ok(nonzero > 1900);
});

test('silentWav is a valid 8 kHz mono 8-bit WAV of silence', () => {
  const buf = N.silentWav();
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(str(12, 4), 'fmt ');
  assert.equal(str(36, 4), 'data');
  assert.equal(v.getUint32(4, true), buf.byteLength - 8);
  assert.equal(v.getUint16(22, true), 1);      // mono
  assert.equal(v.getUint32(24, true), 8000);   // sample rate
  assert.equal(v.getUint16(34, true), 8);      // bits per sample
  assert.equal(v.getUint32(40, true), buf.byteLength - 44);
  for (const b of new Uint8Array(buf, 44)) assert.equal(b, 128);
});

test('knobScale: linear round trip with steps', () => {
  const { toNorm, fromNorm } = N.knobScale({ min: -12, max: 12, step: 1 });
  assert.equal(toNorm(0), 0.5);
  assert.equal(fromNorm(0.5), 0);
  assert.equal(fromNorm(0.52), 0);
  assert.equal(fromNorm(-1), -12);
  assert.equal(fromNorm(2), 12);
  for (let v = -12; v <= 12; v++) assert.equal(fromNorm(toNorm(v)), v);
});

test('knobScale: logarithmic for frequencies and times', () => {
  const { toNorm, fromNorm } = N.knobScale({ min: 20, max: 20000, log: true });
  close(toNorm(20), 0);
  close(toNorm(20000), 1);
  close(toNorm(Math.sqrt(20 * 20000)), 0.5);
  close(fromNorm(0.5), Math.sqrt(20 * 20000), 1e-3);
  for (const v of [30, 440, 1800, 9000]) close(fromNorm(toNorm(v)), v, 1e-3);
});

test('arcPath draws arcs on the 40×40 knob face', () => {
  assert.match(N.arcPath(-135, 135), /^M[\d.]+ [\d.]+A16 16 0 1 1 [\d.]+ [\d.]+$/);
  assert.match(N.arcPath(0, 90), /A16 16 0 0 1 /);
  assert.equal(N.arcPath(0, 90), 'M20.00 4.00A16 16 0 0 1 36.00 20.00');
});

test('isTypingTarget: text fields yes, buttons and checkboxes no', () => {
  const t = (tagName, type) => ({ tagName, type });
  assert.equal(N.isTypingTarget(t('INPUT', 'text')), true);
  assert.equal(N.isTypingTarget(t('INPUT', 'number')), true);
  assert.equal(N.isTypingTarget(t('INPUT', undefined)), true);
  assert.equal(N.isTypingTarget(t('TEXTAREA')), true);
  assert.equal(N.isTypingTarget(t('SELECT')), true);
  assert.equal(N.isTypingTarget(t('INPUT', 'checkbox')), false);
  assert.equal(N.isTypingTarget(t('INPUT', 'range')), false);
  assert.equal(N.isTypingTarget(t('BUTTON')), false);
  assert.equal(N.isTypingTarget(t('DIV')), false);
  assert.equal(N.isTypingTarget(null), false);
  assert.equal(N.isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('FILTER_TYPES and filterQ (dB for low/high-pass, unitless for band-pass/notch)', () => {
  assert.deepEqual(N.FILTER_TYPES.map((f) => f[0]), ['lowpass', 'lowpass24', 'highpass', 'bandpass', 'notch']);
  close(N.filterQ('lowpass', 0), -1);
  close(N.filterQ('lowpass', 100), 20);
  close(N.filterQ('highpass', 50), 9.5);
  close(N.filterQ('bandpass', 0), 0.5);
  close(N.filterQ('notch', 100), 0.5 * Math.pow(2, 5.3));
});

test('grainWindow: every shape starts and ends at 0 and stays within 0..1', () => {
  assert.deepEqual(N.GRAIN_SHAPES.map((s) => s[0]), ['hann', 'triangle', 'tukey', 'gauss', 'perc', 'reverse']);
  for (const [shape] of N.GRAIN_SHAPES) {
    const w = N.grainWindow(shape, 257);
    assert.equal(w.length, 257);
    assert.equal(w[0], 0, shape);
    assert.equal(w[256], 0, shape);
    for (const v of w) assert.ok(v >= 0 && v <= 1, `${shape} ${v}`);
    assert.ok(Math.max(...w) > 0.8, `${shape} reaches near full level`);
  }
  close(N.grainWindow('hann', 257)[128], 1);
  close(N.grainWindow('triangle', 257)[128], 1);
  assert.equal(N.grainWindow('tukey', 257)[128], 1);
  const perc = N.grainWindow('perc', 101), rev = N.grainWindow('reverse', 101);
  assert.ok(perc.indexOf(Math.max(...perc)) < 20, 'percussive peaks early');
  assert.ok(rev.indexOf(Math.max(...rev)) > 80, 'reverse percussive peaks late');
  assert.equal(N.grainWindow('nope', 2).length, 2, 'unknown shapes fall back to Hann');
});

test('computePeaks gives min / max per column', () => {
  const data = new Float32Array([0, 0.5, -0.25, 1, -1, 0.1, 0.2, 0.3]);
  const p = N.computePeaks(data, 4);
  assert.deepEqual([...p.max], [0.5, 1, 0.10000000149011612, 0.30000001192092896]);
  assert.deepEqual([...p.min], [0, -0.25, -1, 0]);
  assert.equal(N.computePeaks(new Float32Array(3), 10).max.length, 10, 'more columns than samples');
});

test('peakOf, trimBounds and normalize', () => {
  const d = new Float32Array([0, 0.001, 0, 0.5, -0.8, 0.3, 0.002, 0]);
  close(N.peakOf(d), 0.8, 1e-6);
  assert.deepEqual(N.trimBounds(d, 0.01), [3, 6]);
  assert.deepEqual(N.trimBounds(d, 0.01, 2), [1, 8]);
  assert.deepEqual(N.trimBounds(new Float32Array(10), 0.01), [0, 0], 'silence');
  const n = N.normalize(d, 0.9);
  close(N.peakOf(n), 0.9, 1e-6);
  close(n[3] / n[4], d[3] / d[4], 1e-6);
  assert.notEqual(n, d, 'returns a copy');
  assert.deepEqual([...N.normalize(new Float32Array(3))], [0, 0, 0]);
});

test('encodeWav writes 16-bit mono PCM and clips to ±1', () => {
  const buf = N.encodeWav(new Float32Array([0, 1, -1, 0.5, 2, -2]), 48000);
  const v = new DataView(buf);
  const str = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(str(0, 4), 'RIFF');
  assert.equal(str(8, 4), 'WAVE');
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 96000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 12);
  assert.equal(buf.byteLength, 56);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => v.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16383, 32767, -32768]);
});

test('keyboard map: Z row then Q row, labels, black keys, octave limit', () => {
  assert.equal(N.KEYMAP.KeyZ, 0);
  assert.equal(N.KEYMAP.KeyM, 11);
  assert.equal(N.KEYMAP.KeyQ, 12);
  assert.equal(N.KEYMAP.Comma, 12);
  assert.equal(N.KEYMAP.BracketRight, 31);
  assert.equal(N.KEY_LABELS[0], 'Z');
  assert.equal(N.KEY_LABELS[12], 'Q', 'the Q row labels the second octave');
  assert.equal(N.KEY_LABELS[30], '=');
  assert.deepEqual(N.BLACK_KEYS, [1, 3, 6, 8, 10]);
  for (const [code, i] of Object.entries(N.KEYMAP)) {
    const isBlack = N.BLACK_KEYS.includes(i % 12);
    if (/^Digit|^Key[SDGHJL]$|^Semicolon$|^Equal$/.test(code)) assert.ok(isBlack, `${code} is a black key`);
  }
  assert.equal(N.maxOctave(3), 5);
  assert.equal(N.maxOctave(5), 3);
});

test('synthVoiceGroups: the shared synth voice settings, with per-app defaults', () => {
  const groups = N.synthVoiceGroups();
  assert.deepEqual(groups.map((g) => g.title),
    ['Oscillator 1', 'Oscillator 2', 'Mixer', 'Filter', 'Filter envelope', 'Amp envelope', 'Modulation (LFO)']);
  const defs = groups.flatMap((g) => g.params);
  const keys = defs.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length, 'keys are unique');
  for (const k of [...N.SYNTH_VOICE_KEYS, ...N.SYNTH_GLOBAL_KEYS]) assert.ok(keys.includes(k), k);
  for (const d of defs) {
    if (d.options) assert.ok(d.options.some((o) => o[0] === d.value), `${d.key} default is an option`);
    else assert.ok(d.value >= d.min && d.value <= d.max, `${d.key} default in range`);
    if (d.log) assert.ok(d.min > 0, `${d.key} log knob needs min > 0`);
  }
  const byKey = Object.fromEntries(defs.map((d) => [d.key, d]));
  assert.equal(byKey.osc1Wave.value, 'sawtooth');
  assert.equal(byKey.cutoff.value, 1800);
  assert.equal(byKey.osc1Wave.options, N.WAVES);
  assert.equal(byKey.filterType.options, N.FILTER_TYPES);

  // Overrides change only that call's copy.
  const mine = N.synthVoiceGroups({ osc1Wave: 'triangle', cutoff: 2600 }).flatMap((g) => g.params);
  assert.equal(mine.find((d) => d.key === 'osc1Wave').value, 'triangle');
  assert.equal(mine.find((d) => d.key === 'cutoff').value, 2600);
  assert.equal(N.synthVoiceGroups().flatMap((g) => g.params).find((d) => d.key === 'cutoff').value, 1800);
  assert.equal(N.fmtRate(5), '5.00 Hz');
  assert.equal(N.fmtRate(12), '12.0 Hz');
});
