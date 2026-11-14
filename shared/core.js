// nmlq shared core: pure helpers with no DOM or Web Audio dependency.
//
// Loaded as a classic <script> (works from file:// and GitHub Pages) it adds
// itself to the global `nmlq` object; under Node (tests) it is a CommonJS
// module. Every app loads this first, then shared/audio.js and shared/ui.js.
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.nmlq = Object.assign(root.nmlq || {}, core);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ---------- music ----------

  const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

  // The four oscillator waveforms every app offers, in display order.
  const WAVES = [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Sawtooth'], ['square', 'Square']];

  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // MIDI note -> "C4" (C4 = 60).
  const noteName = (m, names) => (names || SHARPS)[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  // Position on the circle of fifths <-> pitch class (the map is its own inverse).
  const circlePos = (pc) => (((pc * 7) % 12) + 12) % 12;

  // ---------- value formatting ----------

  const fmt = {
    hz: (v) => (v < 1000 ? Math.round(v) + ' Hz' : (v / 1000).toFixed(v < 10000 ? 2 : 1) + ' kHz'),
    // One decimal only for fractional values below 10 ms ("0.5 ms", "4 ms", "1.25 s").
    ms: (v) => (v < 10 && v % 1 ? v.toFixed(1) + ' ms' : v < 1000 ? Math.round(v) + ' ms' : (v / 1000).toFixed(2) + ' s'),
    pct: (v) => Math.round(v) + '%',
    signed: (v) => (v > 0 ? '+' : '') + v,
    signedPct: (v) => (v > 0 ? '+' : '') + Math.round(v) + '%',
    // Slider style: as many decimals as the step, then the unit.
    step: (def, v) => {
      const decimals = def.step < 1 ? (String(def.step).split('.')[1] || '').length : 0;
      return v.toFixed(decimals) + (def.unit || '');
    },
  };

  // ---------- parameter definitions ----------
  // A definition is one of:
  //   { key, label, bool: default }                      checkbox
  //   { key, label, options: [[value, label]…], select|value: default }  drop-down
  //   { key, label, min, max, step?, log?, value, toggle? }  slider / knob
  // Entries without a key (e.g. { section: 'Sound' }) are ignored here.

  function defaultValue(def) {
    if ('bool' in def) return def.bool;
    if ('options' in def) return 'select' in def ? def.select : def.value;
    return def.value;
  }

  // Reset params (and the on/off state of toggleable sliders) to defaults.
  // `filter(def)` limits the reset to some definitions.
  function loadDefaults(defs, params, enabled, filter) {
    for (const d of defs) {
      if (!d.key || (filter && !filter(d))) continue;
      params[d.key] = defaultValue(d);
      if (enabled && 'toggle' in d) enabled[d.key] = d.toggle;
    }
    return params;
  }

  // Validate one saved value against its definition; undefined if invalid.
  function validValue(def, v) {
    if ('bool' in def) return typeof v === 'boolean' ? v : undefined;
    if ('options' in def) return def.options.some((o) => o[0] === v) ? v : undefined;
    if (typeof v !== 'number' || !isFinite(v)) return undefined;
    return clamp(v, def.min, def.max);
  }

  // Copy valid saved values into params / enabled, ignoring anything else.
  function restoreParams(defs, params, saved, enabled, savedEnabled) {
    if (!saved || typeof saved !== 'object') return params;
    for (const d of defs) {
      if (!d.key) continue;
      const v = validValue(d, saved[d.key]);
      if (v !== undefined) params[d.key] = v;
      if (enabled && savedEnabled && d.key in enabled && typeof savedEnabled[d.key] === 'boolean') {
        enabled[d.key] = savedEnabled[d.key];
      }
    }
    return params;
  }

  // ---------- storage ----------
  // localStorage can be missing or throw (private mode, blocked storage).

  function loadJSON(key) {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveJSON(key, value) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------- envelopes ----------

  // Ring-out note (Graph, Fifths): linear attack to `peak`, then exponential
  // decay to 0.0001 over `dec` seconds. v = { t, atk, dec, peak }.
  function pluckValue(v, now) {
    if (now <= v.t) return 0;
    if (v.atk > 0 && now < v.t + v.atk) return v.peak * (now - v.t) / v.atk;
    const p = Math.min(1, (now - v.t - v.atk) / v.dec);
    return v.peak * Math.pow(0.0001 / v.peak, p);
  }

  // ADSR stage tracked by hand so a retrigger or release can start from the
  // current level (Firefox has no cancelAndHoldAtTime). Matches the curves
  // scheduled by nmlq.audio.envStart / envRelease: linear attack, then
  // setTargetAtTime with a time constant of time / 5.
  //   on:  { stage: 'on', t, from, peak, sustain, a, d }
  //   rel: { stage: 'rel', t, level, r }
  function adsrValue(e, now) {
    if (e.stage === 'on') {
      if (now <= e.t) return e.from;
      if (now < e.t + e.a) return e.from + (e.peak - e.from) * (now - e.t) / e.a;
      return e.sustain + (e.peak - e.sustain) * Math.exp(-(now - e.t - e.a) / (e.d / 5));
    }
    if (e.stage === 'rel') return e.level * Math.exp(-(now - e.t) / (e.r / 5));
    return 0;
  }

  // ---------- sample data ----------

  // Soft clipper: tanh(k·x) normalised so ±1 maps to ±1.
  function tanhCurve(k, n) {
    n = n || 2048;
    const curve = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  // Reverb impulse channel: noise with a cubic fade-out.
  function fillImpulse(data, rand) {
    rand = rand || Math.random;
    const len = data.length;
    for (let i = 0; i < len; i++) data[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 3);
    return data;
  }

  function fillNoise(data, rand) {
    rand = rand || Math.random;
    for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
    return data;
  }

  // 0.1 s of 8 kHz mono 8-bit silence as a WAV file (used for the iOS unlock).
  function silentWav() {
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return buf;
  }

  // ---------- knob maths ----------

  // Value <-> 0..1 position for a knob, linear or logarithmic, with steps.
  function knobScale(o) {
    const toNorm = (v) => (o.log ? Math.log(v / o.min) / Math.log(o.max / o.min) : (v - o.min) / (o.max - o.min));
    const fromNorm = (n) => {
      n = clamp(n, 0, 1);
      let v = o.log ? o.min * Math.pow(o.max / o.min, n) : o.min + n * (o.max - o.min);
      if (o.step) v = Math.round(v / o.step) * o.step;
      return clamp(+v.toFixed(4), o.min, o.max);
    };
    return { toNorm, fromNorm };
  }

  // SVG arc on the knob's 40×40 face, angles in degrees clockwise from 12 o'clock.
  function arcPath(a0, a1) {
    const r = 16, p = (a) => [20 + r * Math.sin(a * Math.PI / 180), 20 - r * Math.cos(a * Math.PI / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }

  // ---------- input ----------

  // True when keyboard shortcuts should leave the event alone.
  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return true;
    if (t.tagName !== 'INPUT') return false;
    return /^(text|number|search|email|password|url|tel)$/.test(t.type || 'text');
  }

  return {
    clamp, SHARPS, FLATS, WAVES, midiFreq, noteName, circlePos, fmt,
    defaultValue, loadDefaults, validValue, restoreParams, loadJSON, saveJSON,
    pluckValue, adsrValue, tanhCurve, fillImpulse, fillNoise, silentWav,
    knobScale, arcPath, isTypingTarget,
  };
});
