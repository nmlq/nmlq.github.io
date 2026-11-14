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

  // ---------- filters ----------

  // Filter types offered by the synth-style apps; lowpass24 is two stages.
  const FILTER_TYPES = [
    ['lowpass', 'Low-pass 12 dB'], ['lowpass24', 'Low-pass 24 dB'], ['highpass', 'High-pass'],
    ['bandpass', 'Band-pass'], ['notch', 'Notch'],
  ];

  // Resonance 0–100% -> BiquadFilter Q. Web Audio's low/high-pass Q is in dB;
  // band-pass and notch Q is a unitless bandwidth.
  function filterQ(type, res) {
    const r = res / 100;
    if (type === 'bandpass' || type === 'notch') return 0.5 * Math.pow(2, r * 5.3);
    return -1 + r * 21;
  }

  // ---------- sample helpers (granular) ----------

  // Grain window shapes: n samples that start and end at (or near) zero.
  const GRAIN_SHAPES = [
    ['hann', 'Hann (smooth)'], ['triangle', 'Triangle'], ['tukey', 'Trapezoid'],
    ['gauss', 'Gaussian'], ['perc', 'Percussive'], ['reverse', 'Reverse perc'],
  ];
  function grainWindow(shape, n) {
    n = Math.max(2, n || 256);
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1); // 0..1
      let v;
      switch (shape) {
        case 'triangle': v = 1 - Math.abs(2 * x - 1); break;
        case 'tukey': { // flat top with 25% cosine ramps
          const r = 0.25;
          v = x < r ? 0.5 - 0.5 * Math.cos(Math.PI * x / r) : x > 1 - r ? 0.5 - 0.5 * Math.cos(Math.PI * (1 - x) / r) : 1;
          break;
        }
        case 'gauss': v = Math.exp(-0.5 * Math.pow((x - 0.5) / 0.15, 2)); break;
        case 'perc': v = Math.min(1, x / 0.05) * Math.pow(1 - x, 3); break;    // fast attack, long fall
        case 'reverse': v = Math.min(1, (1 - x) / 0.05) * Math.pow(x, 3); break; // swell, fast cut
        default: v = 0.5 - 0.5 * Math.cos(2 * Math.PI * x);                     // hann
      }
      w[i] = v;
    }
    w[0] = 0;
    w[n - 1] = 0;
    return w;
  }

  // Min / max per column for drawing a waveform `columns` wide.
  function computePeaks(data, columns) {
    const min = new Float32Array(columns), max = new Float32Array(columns);
    const per = data.length / columns;
    for (let c = 0; c < columns; c++) {
      const a = Math.floor(c * per), b = Math.max(a + 1, Math.floor((c + 1) * per));
      let lo = 0, hi = 0;
      for (let i = a; i < b && i < data.length; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[c] = lo;
      max[c] = hi;
    }
    return { min, max };
  }

  function peakOf(data) {
    let p = 0;
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > p) p = a; }
    return p;
  }

  // [start, end) of the part louder than `threshold` (linear), with a little
  // padding so attacks aren't clipped. Returns [0, 0] for silence.
  function trimBounds(data, threshold, pad) {
    threshold = threshold == null ? 0.01 : threshold;
    pad = pad || 0;
    let a = 0, b = data.length;
    while (a < b && Math.abs(data[a]) < threshold) a++;
    if (a === b) return [0, 0];
    while (b > a && Math.abs(data[b - 1]) < threshold) b--;
    return [Math.max(0, a - pad), Math.min(data.length, b + pad)];
  }

  // Scale a copy so the loudest sample reaches `target` (no change for silence).
  function normalize(data, target) {
    const p = peakOf(data), out = new Float32Array(data.length);
    const g = p > 0 ? (target || 0.9) / p : 1;
    for (let i = 0; i < data.length; i++) out[i] = data[i] * g;
    return out;
  }

  // Mono 16-bit PCM WAV file from float samples.
  function encodeWav(samples, sampleRate) {
    const n = samples.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const s = clamp(samples[i], -1, 1);
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return buf;
  }

  // ---------- keyboard ----------

  // Computer keys, as semitones above the lowest C on screen: the Z row plays
  // the first octave, the Q row (with the number row for sharps) the next.
  const KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
    Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
  };
  const CODE_CHARS = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
  const codeChar = (code) => CODE_CHARS[code] || code.replace(/^Key|^Digit/, '');
  // One label per on-screen key: the Z row for the first octave, Q row above.
  const KEY_LABELS = {};
  for (const [code, i] of Object.entries(KEYMAP)) {
    if (i < 12 || !/^(Comma|KeyL|Period|Semicolon|Slash)$/.test(code)) KEY_LABELS[i] = codeChar(code);
  }
  const BLACK_KEYS = [1, 3, 6, 8, 10];
  // Highest lowest-C octave so the top key stays at or below C8.
  const maxOctave = (span) => 8 - span;

  // ---------- subtractive synth voice (Synth, Memory) ----------
  // The knob groups for one voice of nmlq.audio.createSynth. Returns fresh
  // copies; `overrides` ({ key: value }) changes the defaults for an app.
  const fmtRate = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' Hz';
  function synthVoiceGroups(overrides) {
    const groups = [
      {
        title: 'Oscillator 1', params: [
          { key: 'osc1Wave', label: 'Wave', options: WAVES, value: 'sawtooth' },
          { key: 'osc1Oct', label: 'Octave', min: -2, max: 2, step: 1, value: 0, format: fmt.signed },
          { key: 'osc1Level', label: 'Level', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
        ],
      },
      {
        title: 'Oscillator 2', params: [
          { key: 'osc2Wave', label: 'Wave', options: WAVES, value: 'square' },
          { key: 'osc2Oct', label: 'Octave', min: -2, max: 2, step: 1, value: 0, format: fmt.signed },
          { key: 'osc2Semi', label: 'Semitones', min: -12, max: 12, step: 1, value: 0, format: fmt.signed },
          { key: 'osc2Detune', label: 'Detune', min: -50, max: 50, step: 1, value: 7, format: (v) => fmt.signed(v) + '¢' },
          { key: 'osc2Level', label: 'Level', min: 0, max: 100, step: 1, value: 40, format: fmt.pct },
        ],
      },
      {
        title: 'Mixer', params: [
          { key: 'subLevel', label: 'Sub osc', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
          { key: 'noiseLevel', label: 'Noise', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        ],
      },
      {
        title: 'Filter', params: [
          { key: 'filterType', label: 'Type', value: 'lowpass', options: FILTER_TYPES },
          { key: 'cutoff', label: 'Cutoff', min: 30, max: 18000, log: true, value: 1800, format: fmt.hz },
          { key: 'resonance', label: 'Resonance', min: 0, max: 100, step: 1, value: 25, format: fmt.pct },
          { key: 'filterEnvAmt', label: 'Env amount', min: -100, max: 100, step: 1, value: 40, format: fmt.signedPct },
          { key: 'keyTrack', label: 'Key track', min: 0, max: 100, step: 1, value: 50, format: fmt.pct },
        ],
      },
      {
        title: 'Filter envelope', params: [
          { key: 'fAttack', label: 'Attack', min: 1, max: 5000, log: true, value: 5, format: fmt.ms },
          { key: 'fDecay', label: 'Decay', min: 5, max: 5000, log: true, value: 400, format: fmt.ms },
          { key: 'fSustain', label: 'Sustain', min: 0, max: 100, step: 1, value: 30, format: fmt.pct },
          { key: 'fRelease', label: 'Release', min: 5, max: 8000, log: true, value: 400, format: fmt.ms },
        ],
      },
      {
        title: 'Amp envelope', params: [
          { key: 'attack', label: 'Attack', min: 1, max: 5000, log: true, value: 4, format: fmt.ms },
          { key: 'decay', label: 'Decay', min: 5, max: 5000, log: true, value: 300, format: fmt.ms },
          { key: 'sustain', label: 'Sustain', min: 0, max: 100, step: 1, value: 75, format: fmt.pct },
          { key: 'release', label: 'Release', min: 5, max: 8000, log: true, value: 300, format: fmt.ms },
        ],
      },
      {
        title: 'Modulation (LFO)', params: [
          { key: 'lfoWave', label: 'Wave', options: WAVES, value: 'sine' },
          { key: 'lfoRate', label: 'Rate', min: 0.1, max: 20, log: true, value: 5, format: fmtRate },
          { key: 'vibrato', label: 'Vibrato', min: 0, max: 100, step: 1, value: 0, format: (v) => v + '¢' },
          { key: 'lfoFilter', label: 'Filter', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
          { key: 'tremolo', label: 'Tremolo', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        ],
      },
    ];
    if (overrides) {
      for (const g of groups) for (const d of g.params) if (d.key in overrides) d.value = overrides[d.key];
    }
    return groups;
  }
  // Voice settings that createSynth's configure() applies to sounding voices,
  // and the ones its applyGlobal() handles (the rest are read per note).
  const SYNTH_VOICE_KEYS = ['osc1Wave', 'osc1Oct', 'osc1Level', 'osc2Wave', 'osc2Oct', 'osc2Semi', 'osc2Detune', 'osc2Level',
    'subLevel', 'noiseLevel', 'filterType', 'cutoff', 'resonance', 'keyTrack'];
  const SYNTH_GLOBAL_KEYS = ['lfoWave', 'lfoRate', 'vibrato', 'lfoFilter', 'tremolo'];

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
    FILTER_TYPES, filterQ,
    GRAIN_SHAPES, grainWindow, computePeaks, peakOf, trimBounds, normalize, encodeWav,
    KEYMAP, KEY_LABELS, BLACK_KEYS, maxOctave,
    fmtRate, synthVoiceGroups, SYNTH_VOICE_KEYS, SYNTH_GLOBAL_KEYS,
  };
});
