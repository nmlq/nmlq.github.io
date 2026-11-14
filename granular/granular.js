// A granular synthesizer that plays sounds you record in the browser.
//
// A recording (or a loaded file, or the built-in demo) sits in one of four
// memory slots. Playing a key starts a stream of short "grains": tiny
// windowed snippets read from around the play position of the selected
// sample, each with its own random variation in position, pitch, stereo
// placement, level and direction. Grain size, density, window shape and the
// amount of randomness ("spray") shape the texture; the scan speed moves the
// play position through the sample over time, or Freeze holds it still.
// Each key's grains are transposed relative to C4 (the sample's own pitch).
//
// Grains are scheduled ~100 ms ahead on the audio clock: each is an
// AudioBufferSource with a gain envelope (setValueCurveAtTime) and a stereo
// panner, feeding the voice's ADSR gain, then a shared filter, drive, echo,
// reverb and compressor. The heads-up display draws the sample, the selected
// region, the play position and every grain as it plays.
(function () {
  'use strict';

  const N = window.nmlq;
  const { clamp, fmt } = N;
  const STORAGE_KEY = 'nmlq-granular-v1';
  const SLOT_COUNT = 4;
  const MAX_RECORD_SECONDS = 30;
  const ROOT_NOTE = 60;      // a sample plays at its own pitch on C4
  const LOOKAHEAD = 0.1;     // seconds of grains scheduled ahead
  const fmtDensity = (v) => (v < 10 ? v.toFixed(1) : Math.round(v)) + '/s';
  const fmtCents = (v) => Math.round(v) + '¢';

  // ---------- parameters ----------
  // Numbers become knobs, `options` drop-downs; `toggle` puts an on/off
  // switch on the group (the effects).
  const GROUPS = [
    {
      title: 'Grains', params: [
        { key: 'size', label: 'Size', min: 5, max: 1000, log: true, value: 120, format: fmt.ms },
        { key: 'density', label: 'Density', min: 1, max: 100, log: true, value: 20, format: fmtDensity },
        { key: 'timing', label: 'Timing', value: 'async', options: [['async', 'Random (async)'], ['sync', 'Regular (sync)']] },
        { key: 'shape', label: 'Window', value: 'hann', options: N.GRAIN_SHAPES },
        { key: 'maxGrains', label: 'Max grains', min: 8, max: 128, step: 1, value: 64 },
      ],
    },
    {
      title: 'Position', params: [
        { key: 'position', label: 'Position', min: 0, max: 100, step: 0.5, value: 30, format: fmt.pct },
        { key: 'spray', label: 'Spray', min: 0, max: 100, step: 1, value: 5, format: fmt.pct },
        { key: 'scan', label: 'Scan speed', min: -200, max: 200, step: 1, value: 0, format: fmt.signedPct },
      ],
    },
    {
      title: 'Pitch', params: [
        { key: 'transpose', label: 'Transpose', min: -24, max: 24, step: 1, value: 0, format: (v) => fmt.signed(v) + ' st' },
        { key: 'fine', label: 'Fine', min: -100, max: 100, step: 1, value: 0, format: (v) => fmt.signed(v) + '¢' },
        { key: 'pitchSpray', label: 'Pitch spray', min: 0, max: 1200, step: 1, value: 0, format: fmtCents },
        { key: 'reverse', label: 'Reverse', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'keyTrack', label: 'Keys', value: 'on', options: [['on', 'Follow keys'], ['off', 'Fixed pitch']] },
      ],
    },
    {
      title: 'Spread', params: [
        { key: 'pan', label: 'Stereo', min: 0, max: 100, step: 1, value: 40, format: fmt.pct },
        { key: 'ampSpray', label: 'Level spray', min: 0, max: 100, step: 1, value: 10, format: fmt.pct },
      ],
    },
    {
      title: 'Amp envelope', params: [
        { key: 'attack', label: 'Attack', min: 1, max: 5000, log: true, value: 30, format: fmt.ms },
        { key: 'decay', label: 'Decay', min: 5, max: 5000, log: true, value: 300, format: fmt.ms },
        { key: 'sustain', label: 'Sustain', min: 0, max: 100, step: 1, value: 80, format: fmt.pct },
        { key: 'release', label: 'Release', min: 5, max: 8000, log: true, value: 800, format: fmt.ms },
      ],
    },
    {
      title: 'Modulation (LFO)', params: [
        { key: 'lfoWave', label: 'Wave', options: N.WAVES, value: 'sine' },
        { key: 'lfoRate', label: 'Rate', min: 0.05, max: 20, log: true, value: 0.5, format: (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' Hz' },
        { key: 'lfoPosition', label: 'Position', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'lfoPitch', label: 'Pitch', min: 0, max: 1200, step: 1, value: 0, format: fmtCents },
        { key: 'lfoSize', label: 'Size', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'lfoFilter', label: 'Filter', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
      ],
    },
    {
      title: 'Voice', params: [
        { key: 'glide', label: 'Portamento', min: 0, max: 2000, step: 5, value: 0, format: fmt.ms },
        { key: 'voices', label: 'Poly voices', min: 1, max: 8, step: 1, value: 6 },
        { key: 'bendRange', label: 'Bend range', min: 1, max: 12, step: 1, value: 2, format: (v) => '±' + v + ' st' },
      ],
    },
    {
      title: 'Filter', toggle: 'filterOn', params: [
        { key: 'filterType', label: 'Type', value: 'lowpass', options: N.FILTER_TYPES },
        { key: 'cutoff', label: 'Cutoff', min: 30, max: 18000, log: true, value: 6000, format: fmt.hz },
        { key: 'resonance', label: 'Resonance', min: 0, max: 100, step: 1, value: 15, format: fmt.pct },
      ],
    },
    {
      title: 'Drive', toggle: 'driveOn', params: [
        { key: 'drive', label: 'Drive', min: 0, max: 100, step: 1, value: 30, format: fmt.pct },
      ],
    },
    {
      title: 'Echo', toggle: 'echoOn', params: [
        { key: 'echo', label: 'Mix', min: 0, max: 100, step: 1, value: 30, format: fmt.pct },
        { key: 'echoTime', label: 'Time', min: 30, max: 1000, step: 5, value: 320, format: fmt.ms },
        { key: 'echoFeedback', label: 'Feedback', min: 0, max: 90, step: 1, value: 40, format: fmt.pct },
      ],
    },
    {
      title: 'Reverb', toggle: 'reverbOn', params: [
        { key: 'reverb', label: 'Mix', min: 0, max: 100, step: 1, value: 35, format: fmt.pct },
        { key: 'reverbSize', label: 'Length', min: 0.3, max: 8, step: 0.1, value: 3, format: (v) => v.toFixed(1) + ' s' },
      ],
    },
    {
      title: 'Output', params: [
        { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
      ],
    },
  ];
  // Effect on/off switches are booleans saved with the rest.
  const TOGGLE_DEFS = [
    { key: 'filterOn', label: 'Filter', bool: true },
    { key: 'driveOn', label: 'Drive', bool: false },
    { key: 'echoOn', label: 'Echo', bool: false },
    { key: 'reverbOn', label: 'Reverb', bool: true },
  ];
  const DEFS = GROUPS.flatMap((g) => g.params).concat(TOGGLE_DEFS);
  // Layout / play state, saved but not reset by Defaults.
  const LAYOUT_DEFAULTS = { mode: 'poly', octave: 3, span: 3, labels: true, freeze: false };

  const params = {};
  const loadDefaults = () => N.loadDefaults(DEFS, params);
  const saveSettings = () => N.saveJSON(STORAGE_KEY, params);

  function loadSettings() {
    Object.assign(params, LAYOUT_DEFAULTS);
    const saved = N.loadJSON(STORAGE_KEY);
    if (!saved || typeof saved !== 'object') return;
    N.restoreParams(DEFS, params, saved);
    if (saved.mode === 'mono' || saved.mode === 'poly') params.mode = saved.mode;
    if ([3, 4, 5].includes(saved.span)) params.span = saved.span;
    if (Number.isInteger(saved.octave)) params.octave = clamp(saved.octave, 0, N.maxOctave(params.span));
    if (typeof saved.labels === 'boolean') params.labels = saved.labels;
    if (typeof saved.freeze === 'boolean') params.freeze = saved.freeze;
  }

  // ---------- memory slots ----------
  // Each slot: { name, data (Float32Array, mono), rate, start, end (region
  // as 0..1), buffer / reversed (AudioBuffers, made when audio starts) }.
  // Slots live in memory only; Save WAV downloads one.

  const slots = new Array(SLOT_COUNT).fill(null);
  let current = 0;
  let recordCount = 0;
  const sample = () => slots[current];
  const duration = (s) => s.data.length / s.rate;

  function makeSlot(data, rate, name) {
    return { name, data, rate, start: 0, end: 1, buffer: null, reversed: null, peaks: null };
  }

  // Audio buffers are made lazily: the demo exists before audio is allowed.
  function buffersOf(s) {
    if (!s.buffer && A.ctx) {
      s.buffer = A.ctx.createBuffer(1, s.data.length, s.rate);
      s.buffer.getChannelData(0).set(s.data);
      s.reversed = A.ctx.createBuffer(1, s.data.length, s.rate);
      const r = s.reversed.getChannelData(0), n = s.data.length;
      for (let i = 0; i < n; i++) r[i] = s.data[n - 1 - i];
    }
    return s.buffer ? s : null;
  }

  // Trim silence, normalise and store a recording / file in the current slot.
  function storeSample(raw, rate, name) {
    const [a, b] = N.trimBounds(raw, 0.01, Math.round(rate * 0.02));
    if (b - a < rate * 0.05) {
      setStatus('That was too quiet to use — try again closer to the microphone.');
      return false;
    }
    slots[current] = makeSlot(N.normalize(raw.subarray(a, b), 0.9), rate, name);
    playhead = 0;
    renderSlots();
    setStatus(`${name}: ${duration(slots[current]).toFixed(2)} s in slot ${current + 1}`);
    return true;
  }

  // A short built-in sound so there's something to play straight away:
  // a bell-like C major 7 arpeggio with a breathy noise swell (root C4).
  function demoData(rate) {
    const len = Math.round(rate * 2.6), out = new Float32Array(len);
    const notes = [60, 64, 67, 71, 72];
    notes.forEach((m, k) => {
      const f = N.midiFreq(m), t0 = k * 0.42;
      const s0 = Math.round(t0 * rate);
      for (let i = s0; i < len; i++) {
        const t = (i - s0) / rate;
        const env = Math.min(1, t / 0.008) * Math.exp(-t * 2.2);
        out[i] += env * 0.22 * (Math.sin(2 * Math.PI * f * t) + 0.35 * Math.sin(4 * Math.PI * f * t) + 0.12 * Math.sin(6.02 * Math.PI * f * t));
      }
    });
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      lp += 0.08 * ((Math.random() * 2 - 1) - lp);
      out[i] += lp * 0.5 * Math.sin(Math.PI * t / 2.6);
    }
    return N.normalize(out, 0.9);
  }

  function loadDemo() {
    slots[current] = makeSlot(demoData(44100), 44100, 'Demo');
    playhead = 0;
    renderSlots();
    setStatus(`Demo in slot ${current + 1}: a C major 7 arpeggio — C4 plays it at its own pitch`);
  }

  // ---------- audio graph ----------

  const A = { ctx: null, voices: [], grains: 0, spawned: 0, driveTimer: 0 };
  let bend = 0;     // -1..1
  let modWheel = 0; // 0..1

  function ensureAudio() {
    if (!A.ctx) {
      const ac = N.audio.createContext();
      if (!ac) return null;
      A.ctx = ac;
      A.bus = ac.createGain();
      A.fA = ac.createBiquadFilter();
      A.fB = ac.createBiquadFilter();
      A.shaper = ac.createWaveShaper();
      A.shaper.oversample = '2x';
      A.post = ac.createGain();
      A.space = N.audio.createSpace(ac, params.reverbSize);
      A.master = ac.createGain();
      A.analyser = ac.createAnalyser();
      A.analyser.fftSize = 2048;
      const comp = N.audio.compressor(ac, { threshold: -14, knee: 10, ratio: 4, attack: 0.005, release: 0.2 });
      A.bus.connect(A.fA).connect(A.fB).connect(A.shaper).connect(A.post).connect(A.space.input);
      A.space.output.connect(A.master).connect(comp).connect(A.analyser).connect(ac.destination);

      // Filter LFO in the audio graph; the other LFO targets are read per grain.
      A.lfo = ac.createOscillator();
      A.lfoFilter = ac.createGain();
      A.lfo.connect(A.lfoFilter);
      A.lfoFilter.connect(A.fA.detune);
      A.lfoFilter.connect(A.fB.detune);
      A.lfo.start();

      applyGlobal(true);
      applyFilter(true);
      buildDrive();
      lastTick = ac.currentTime;
      clearInterval(A.timer);
      A.timer = setInterval(tick, 25);
    }
    return N.audio.resume(A.ctx);
  }

  function applyGlobal(immediate) {
    if (!A.ctx) return;
    const ac = A.ctx;
    const set = (p, v) => N.audio.setParam(ac, p, v, immediate, 0.03);
    set(A.master.gain, (params.volume / 100) * 0.9);
    A.space.set({
      reverb: params.reverbOn ? params.reverb / 100 : 0,
      echo: params.echoOn ? params.echo / 100 : 0,
      echoTime: params.echoTime / 1000,
      echoFeedback: params.echoFeedback / 100,
    }, immediate);
    A.lfo.type = params.lfoWave;
    set(A.lfo.frequency, params.lfoRate);
    set(A.lfoFilter.gain, params.filterOn ? (params.lfoFilter / 100) * 3 * 1200 : 0);
  }

  function applyFilter(immediate) {
    if (!A.ctx) return;
    const set = (p, v) => N.audio.setParam(A.ctx, p, v, immediate, 0.02);
    const ft = params.filterType, lp24 = ft === 'lowpass24';
    // Off = two all-pass stages, which leave the level alone.
    A.fA.type = params.filterOn ? (lp24 ? 'lowpass' : ft) : 'allpass';
    A.fB.type = params.filterOn && lp24 ? 'lowpass' : 'allpass';
    set(A.fA.frequency, params.cutoff);
    set(A.fB.frequency, params.cutoff);
    set(A.fA.Q, N.filterQ(ft, params.resonance));
    set(A.fB.Q, lp24 ? 0 : 0.7);
    applyGlobal(immediate);
  }

  function buildDrive() {
    if (!A.ctx) return;
    const k = params.driveOn ? params.drive / 100 : 0;
    A.shaper.curve = k === 0 ? null : N.tanhCurve(1 + k * 30, 2048);
    N.audio.setParam(A.ctx, A.post.gain, 1 - k * 0.55, false, 0.03);
  }

  // ---------- LFO and play position ----------

  function lfoAt(t) {
    const ph = t * params.lfoRate, f = ph - Math.floor(ph);
    switch (params.lfoWave) {
      case 'triangle': return 4 * Math.abs(f - 0.5) - 1;
      case 'sawtooth': return 2 * f - 1;
      case 'square': return f < 0.5 ? 1 : -1;
      default: return Math.sin(2 * Math.PI * ph);
    }
  }

  // The scan moves `playhead` (0..1 of the region) on from the Position knob.
  let playhead = 0;
  let lastTick = 0;
  const wrap01 = (x) => x - Math.floor(x);

  function scanRate(s) {
    if (params.freeze || !s) return 0;
    const len = (s.end - s.start) * duration(s);
    return len > 0 ? (params.scan / 100) / len : 0; // region lengths per second
  }

  // Centre of the grain cloud at audio time t, as 0..1 of the region.
  function centreAt(t) {
    return wrap01(params.position / 100 + playhead + (t - lastTick) * scanRate(sample()));
  }

  // ---------- grains ----------

  const windows = {};
  const windowFor = (shape) => windows[shape] || (windows[shape] = N.grainWindow(shape, 256));
  const hudGrains = []; // recent grains for the display

  function spawnGrain(v, t) {
    const s = sample();
    if (!s || !buffersOf(s) || A.grains >= params.maxGrains) return;
    const ac = A.ctx, dur = duration(s);
    const lfo = lfoAt(t);

    const size = Math.max(0.005, (params.size / 1000) * (1 + lfo * (params.lfoSize / 100) * 0.9));
    const keySemis = params.keyTrack === 'on' ? v.pitchAt(t) - ROOT_NOTE : 0;
    const cents = keySemis * 100 + params.transpose * 100 + params.fine + bend * params.bendRange * 100 +
      (Math.random() * 2 - 1) * params.pitchSpray + lfo * (params.lfoPitch + modWheel * 100);
    const rate = Math.pow(2, cents / 1200);

    const regionLen = s.end - s.start;
    const pos = wrap01(centreAt(t) + (Math.random() * 2 - 1) * (params.spray / 100) * 0.5 + lfo * (params.lfoPosition / 100) * 0.5);
    const startSec = (s.start + pos * regionLen) * dur;
    const span = size * rate; // seconds of the sample the grain reads
    const reverse = Math.random() < params.reverse / 100;
    const offset = reverse ? clamp(dur - startSec - span, 0, Math.max(0, dur - span)) : clamp(startSec, 0, Math.max(0, dur - span));

    const src = ac.createBufferSource();
    src.buffer = reverse ? s.reversed : s.buffer;
    src.playbackRate.value = rate;

    // Level: keep overlapping grains from piling up, then spray.
    const overlap = Math.max(1, (params.density * params.size) / 1000);
    const level = (0.5 / Math.sqrt(overlap)) * (1 - Math.random() * params.ampSpray / 100);
    const win = windowFor(params.shape), curve = new Float32Array(win.length);
    for (let i = 0; i < win.length; i++) curve[i] = win[i] * level;
    const env = ac.createGain();
    env.gain.value = 0;
    env.gain.setValueCurveAtTime(curve, t, size);

    let out = env;
    const panAmt = (Math.random() * 2 - 1) * params.pan / 100;
    if (ac.createStereoPanner && panAmt !== 0) {
      const p = ac.createStereoPanner();
      p.pan.value = panAmt;
      env.connect(p);
      out = p;
    }
    src.connect(env);
    out.connect(v.gain);
    src.start(t, offset);
    src.stop(t + size + 0.02);
    A.grains++;
    A.spawned++;
    src.onended = () => { A.grains--; out.disconnect(); };

    hudGrains.push({ t, size, pos: (reverse ? offset + span : offset) / dur, span: span / dur, reverse, pan: panAmt });
    if (hudGrains.length > 400) hudGrains.splice(0, hudGrains.length - 400);
  }

  // Schedule every voice's grains a little ahead of the audio clock.
  function tick() {
    const ac = A.ctx;
    const now = ac.currentTime;
    playhead = wrap01(playhead + (now - lastTick) * scanRate(sample()));
    lastTick = now;
    for (const v of A.voices) {
      if (v.dead) continue;
      // Back from a background tab: skip ahead instead of catching up.
      if (v.next < now - 0.2) v.next = now;
      while (v.next < now + LOOKAHEAD) {
        spawnGrain(v, Math.max(v.next, now));
        let gap = 1 / params.density;
        if (params.timing === 'async') gap *= 0.2 + Math.random() * 1.6;
        v.next += gap;
      }
    }
  }

  // ---------- voices (mono / poly) ----------

  function makeVoice(note, t, fromNote) {
    const v = {
      note, born: t, next: t, released: false, stolen: false, dead: false, timer: 0, env: {},
      gain: A.ctx.createGain(),
      pitch: { from: fromNote == null ? note : fromNote, to: note, t0: t },
      // Portamento: an exponential glide in (fractional) MIDI notes.
      pitchAt(time) {
        const tau = params.glide / 1000 / 4;
        if (tau <= 0 || time <= this.pitch.t0) return tau <= 0 ? this.pitch.to : this.pitch.from;
        return this.pitch.to + (this.pitch.from - this.pitch.to) * Math.exp(-(time - this.pitch.t0) / tau);
      },
    };
    v.gain.gain.value = 0;
    v.gain.connect(A.bus);
    A.voices.push(v);
    return v;
  }

  function trigger(v, t, fromCurrent) {
    const level = N.adsrValue(v.env, t);
    N.audio.envStart([v.gain.gain], v.env, t, fromCurrent ? level : 0, 1, params.sustain / 100,
      params.attack / 1000, params.decay / 1000);
  }

  function releaseVoice(v) {
    if (v.released || v.dead) return;
    v.released = true;
    const r = params.release / 1000;
    N.audio.envRelease([v.gain.gain], v.env, A.ctx.currentTime, r);
    clearTimeout(v.timer);
    v.timer = setTimeout(() => killVoice(v), (r * 1.3 + 0.05) * 1000);
  }

  function stealVoice(v) {
    if (v.dead || v.stolen) return;
    v.stolen = v.released = true;
    N.audio.envRelease([v.gain.gain], v.env, A.ctx.currentTime, 0.03);
    clearTimeout(v.timer);
    v.timer = setTimeout(() => killVoice(v), 80);
    if (polyMap.get(v.note) === v) polyMap.delete(v.note);
    if (mono.voice === v) mono.voice = null;
  }

  function killVoice(v) {
    if (v.dead) return;
    v.dead = true;
    clearTimeout(v.timer);
    const i = A.voices.indexOf(v);
    if (i >= 0) A.voices.splice(i, 1);
    if (polyMap.get(v.note) === v) polyMap.delete(v.note);
    if (mono.voice === v) mono.voice = null;
    // Let grains already scheduled finish before disconnecting.
    setTimeout(() => v.gain.disconnect(), 1200);
  }

  const polyMap = new Map();
  const mono = { stack: [], voice: null };
  let lastNote = null;

  function engineOn(note) {
    if (!ensureAudio()) return;
    if (!sample()) setStatus('This slot is empty — record, load a file or press Demo.');
    if (params.mode === 'mono') monoOn(note); else polyOn(note);
  }

  function engineOff(note) {
    if (!A.ctx) return;
    if (params.mode === 'mono') monoOff(note); else polyOff(note);
  }

  function polyOn(note) {
    const t = A.ctx.currentTime;
    const old = polyMap.get(note);
    if (old) stealVoice(old);
    const live = A.voices.filter((v) => !v.stolen && !v.dead);
    const excess = live.length - params.voices + 1;
    if (excess > 0) {
      live.sort((a, b) => (b.released - a.released) || (a.born - b.born));
      for (let i = 0; i < excess; i++) stealVoice(live[i]);
    }
    const v = makeVoice(note, t, params.glide > 0 ? lastNote : null);
    trigger(v, t, false);
    polyMap.set(note, v);
    lastNote = note;
  }

  function polyOff(note) {
    const v = polyMap.get(note);
    if (!v) return;
    polyMap.delete(note);
    releaseVoice(v);
  }

  function monoOn(note) {
    const legato = mono.stack.length > 0;
    mono.stack = mono.stack.filter((n) => n !== note);
    mono.stack.push(note);
    monoPlay(note, legato);
  }

  function monoOff(note) {
    const i = mono.stack.indexOf(note);
    if (i < 0) return;
    const wasTop = i === mono.stack.length - 1;
    mono.stack.splice(i, 1);
    if (!wasTop) return;
    if (mono.stack.length) monoPlay(mono.stack[mono.stack.length - 1], true);
    else if (mono.voice) releaseVoice(mono.voice);
  }

  function monoPlay(note, legato) {
    const t = A.ctx.currentTime;
    let v = mono.voice;
    if (!v || v.dead || v.stolen) {
      v = mono.voice = makeVoice(note, t, params.glide > 0 && legato ? lastNote : null);
      trigger(v, t, false);
    } else {
      // Glide from wherever the pitch is now; retrigger unless legato.
      v.pitch = { from: params.glide > 0 ? v.pitchAt(t) : note, to: note, t0: t };
      if (v.released || !legato) {
        clearTimeout(v.timer);
        v.released = false;
        trigger(v, t, true);
      }
      v.note = note;
    }
    lastNote = note;
  }

  function silenceAll() {
    mono.stack = [];
    if (!A.ctx) return;
    for (const v of A.voices.slice()) stealVoice(v);
    polyMap.clear();
    mono.voice = null;
  }

  // ---------- recording ----------
  // Raw samples are captured with a ScriptProcessor (works in every browser
  // and needs no codec), shown live on the display, then trimmed, normalised
  // and stored in the selected slot.

  const rec = { active: false, stream: null, source: null, proc: null, sink: null, chunks: [], length: 0, level: 0, rate: 44100 };
  const recordBtn = document.getElementById('record');

  async function startRecording() {
    const ac = ensureAudio();
    if (!ac) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('Recording needs microphone access, which this browser or page does not allow (try https).');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      setStatus('Microphone access was blocked — allow it in the browser to record.');
      return;
    }
    Object.assign(rec, { active: true, stream, chunks: [], length: 0, level: 0, rate: ac.sampleRate });
    rec.source = ac.createMediaStreamSource(stream);
    rec.proc = ac.createScriptProcessor(4096, 1, 1);
    rec.sink = ac.createGain();
    rec.sink.gain.value = 0; // the processor must reach the destination to run
    rec.source.connect(rec.proc);
    rec.proc.connect(rec.sink).connect(ac.destination);
    rec.proc.onaudioprocess = (e) => {
      if (!rec.active) return;
      const d = e.inputBuffer.getChannelData(0);
      rec.chunks.push(new Float32Array(d));
      rec.length += d.length;
      rec.level = Math.max(rec.level * 0.85, N.peakOf(d));
      if (rec.length >= MAX_RECORD_SECONDS * rec.rate) stopRecording();
    };
    recordBtn.setAttribute('aria-pressed', 'true');
    recordBtn.textContent = '■ Stop';
    setStatus(`Recording into slot ${current + 1}… (up to ${MAX_RECORD_SECONDS} s)`);
  }

  function stopRecording() {
    if (!rec.active) return;
    rec.active = false;
    try { rec.source.disconnect(); rec.proc.disconnect(); rec.sink.disconnect(); } catch (e) { /* ignore */ }
    rec.proc.onaudioprocess = null;
    for (const track of rec.stream.getTracks()) track.stop();
    recordBtn.setAttribute('aria-pressed', 'false');
    recordBtn.textContent = '● Record';
    const data = new Float32Array(rec.length);
    let o = 0;
    for (const c of rec.chunks) { data.set(c, o); o += c.length; }
    rec.chunks = [];
    recordCount++;
    storeSample(data, rec.rate, 'Rec ' + recordCount);
  }

  recordBtn.addEventListener('click', () => (rec.active ? stopRecording() : startRecording()));

  // ---------- files, slots, buttons ----------

  const statusEl = document.getElementById('status');
  const setStatus = (text) => { statusEl.textContent = text; };
  const slotsEl = document.getElementById('slots');
  const slotBtns = [];

  for (let i = 0; i < SLOT_COUNT; i++) {
    const b = document.createElement('button');
    b.className = 'slot';
    b.addEventListener('click', () => {
      if (rec.active) return;
      current = i;
      playhead = 0;
      renderSlots();
      const s = sample();
      setStatus(s ? `Slot ${i + 1}: ${s.name}, ${duration(s).toFixed(2)} s` : `Slot ${i + 1} is empty`);
    });
    slotsEl.appendChild(b);
    slotBtns.push(b);
  }

  function renderSlots() {
    slotBtns.forEach((b, i) => {
      const s = slots[i];
      b.textContent = s ? `${i + 1} · ${s.name.length > 10 ? s.name.slice(0, 9) + '…' : s.name}` : `${i + 1} · empty`;
      b.title = s ? `${s.name} — ${duration(s).toFixed(2)} s` : 'Empty slot';
      b.classList.toggle('empty', !s);
      b.setAttribute('aria-pressed', String(i === current));
      b.setAttribute('aria-label', `Slot ${i + 1}: ${s ? s.name : 'empty'}`);
    });
  }

  document.getElementById('file').addEventListener('change', async (ev) => {
    const input = ev.target, file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const ac = ensureAudio();
    if (!ac) return;
    try {
      const bytes = await file.arrayBuffer();
      const decoded = await new Promise((resolve, reject) => {
        const p = ac.decodeAudioData(bytes, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
      // Mix down to mono.
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const d = decoded.getChannelData(c);
        for (let i = 0; i < d.length; i++) mono[i] += d[i] / decoded.numberOfChannels;
      }
      const max = Math.min(mono.length, MAX_RECORD_SECONDS * 2 * decoded.sampleRate);
      storeSample(mono.subarray(0, max), decoded.sampleRate, file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      setStatus(`Couldn't read ${file.name} as audio.`);
    }
  });

  document.getElementById('demo').addEventListener('click', loadDemo);

  document.getElementById('clear').addEventListener('click', () => {
    if (!sample()) return;
    slots[current] = null;
    renderSlots();
    setStatus(`Slot ${current + 1} cleared`);
  });

  document.getElementById('save').addEventListener('click', () => {
    const s = sample();
    if (!s) { setStatus('Nothing to save in this slot.'); return; }
    const a0 = Math.floor(s.start * s.data.length), a1 = Math.ceil(s.end * s.data.length);
    const blob = new Blob([N.encodeWav(s.data.subarray(a0, a1), s.rate)], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `granular-${s.name.replace(/[^\w-]+/g, '_')}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setStatus(`Saved ${a.download} (the selected region)`);
  });

  const freezeBtn = document.getElementById('freeze');
  function setFreeze(on) {
    if (on && !params.freeze) playhead = wrap01(playhead); // hold where it is
    params.freeze = on;
    freezeBtn.setAttribute('aria-pressed', String(on));
  }
  freezeBtn.addEventListener('click', () => { setFreeze(!params.freeze); saveSettings(); });

  // ---------- heads-up display ----------
  // The sample waveform, the selected region (drag its edges), the play
  // position and spray (click or drag to move it), and every grain as a dot
  // travelling through the part of the sample it reads.

  const hud = document.getElementById('hud');
  const hctx = hud.getContext('2d');
  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    colors = { fg: v('--fg'), muted: v('--muted'), accent: v('--accent'), bg: v('--bg'), rec: v('--rec') };
  }
  readColors();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', readColors);
  }

  function drawWave(ctx, data, w, h, color, x0, x1) {
    const peaks = N.computePeaks(data, Math.max(1, Math.round(x1 - x0)));
    ctx.fillStyle = color;
    const mid = h / 2, amp = h / 2 - 4;
    for (let c = 0; c < peaks.min.length; c++) {
      const y0 = mid - peaks.max[c] * amp, y1 = mid - peaks.min[c] * amp;
      ctx.fillRect(x0 + c, y0, 1, Math.max(1, y1 - y0));
    }
  }

  function drawHud() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(hud.clientWidth * dpr), h = Math.round(hud.clientHeight * dpr);
    if (!w || !h) return;
    if (hud.width !== w || hud.height !== h) { hud.width = w; hud.height = h; }
    const ctx = hctx;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${11 * dpr}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';

    if (rec.active) {
      // Live input, growing from the left, with a level meter.
      const sec = rec.length / rec.rate;
      const data = new Float32Array(rec.length);
      let o = 0;
      for (const c of rec.chunks) { data.set(c, o); o += c.length; }
      const width = Math.max(1, Math.min(w - 16 * dpr, (sec / MAX_RECORD_SECONDS) * w * 4));
      drawWave(ctx, data, w, h, colors.rec, 0, width);
      ctx.fillStyle = colors.rec;
      ctx.fillRect(w - 8 * dpr, h * (1 - Math.min(1, rec.level)), 6 * dpr, h * Math.min(1, rec.level));
      ctx.fillText(`● REC ${sec.toFixed(1)} s / ${MAX_RECORD_SECONDS} s`, 8 * dpr, 6 * dpr);
      return;
    }

    const s = sample();
    if (!s) {
      ctx.fillStyle = colors.muted;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(`Slot ${current + 1} is empty — record, load a file or press Demo`, w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    // Waveform (cached per width), dimmed outside the region.
    if (!s.peaksCanvas || s.peaksCanvas.width !== w || s.peaksCanvas.height !== h || s.peaksColor !== colors.muted) {
      const c = s.peaksCanvas || document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cctx = c.getContext('2d');
      cctx.clearRect(0, 0, w, h);
      drawWave(cctx, s.data, w, h, colors.muted, 0, w);
      s.peaksCanvas = c;
      s.peaksColor = colors.muted;
    }
    ctx.globalAlpha = 0.7;
    ctx.drawImage(s.peaksCanvas, 0, 0);
    ctx.globalAlpha = 1;
    const rx0 = s.start * w, rx1 = s.end * w;
    ctx.fillStyle = colors.bg;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(0, 0, rx0, h);
    ctx.fillRect(rx1, 0, w - rx1, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = colors.accent;
    for (const x of [rx0, rx1]) {
      ctx.fillRect(x - dpr, 0, 2 * dpr, h);
      ctx.fillRect(x - 4 * dpr, 0, 8 * dpr, 10 * dpr);
    }

    // Play position and spray band.
    const now = A.ctx ? A.ctx.currentTime : 0;
    const centre = A.ctx ? centreAt(now) : params.position / 100;
    const cx = rx0 + centre * (rx1 - rx0);
    const sprayW = (params.spray / 100) * (rx1 - rx0);
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(cx - sprayW / 2, 0, sprayW, h);
    ctx.globalAlpha = 0.9;
    ctx.fillRect(cx - dpr / 2, 0, Math.max(1, dpr), h);
    ctx.globalAlpha = 1;

    // Grains: a faint bar for the part each reads, a dot where it is now.
    let live = 0;
    for (let i = hudGrains.length - 1; i >= 0; i--) {
      const g = hudGrains[i];
      if (now > g.t + g.size + 0.25) { hudGrains.splice(i, 1); continue; }
      if (now < g.t) continue;
      const p = Math.min(1, (now - g.t) / g.size);
      const fade = now > g.t + g.size ? 1 - (now - g.t - g.size) / 0.25 : 1;
      const y = h / 2 + g.pan * (h / 2 - 10 * dpr);
      const xa = g.pos * w, xb = (g.reverse ? g.pos - g.span : g.pos + g.span) * w;
      ctx.globalAlpha = 0.25 * fade;
      ctx.fillStyle = colors.accent;
      ctx.fillRect(Math.min(xa, xb), y - 1.5 * dpr, Math.max(1, Math.abs(xb - xa)), 3 * dpr);
      ctx.globalAlpha = fade;
      ctx.beginPath();
      ctx.arc(xa + (xb - xa) * p, y, (p < 1 ? 3.5 : 2) * dpr, 0, Math.PI * 2);
      ctx.fill();
      if (p < 1) live++;
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = colors.muted;
    ctx.fillText(`${s.name} · ${duration(s).toFixed(2)} s`, 8 * dpr, 6 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText(`${live} grains · ${Math.round(centre * 100)}%${params.freeze ? ' · frozen' : ''}`, w - 8 * dpr, 6 * dpr);
    ctx.textAlign = 'left';
    hud.dataset.grains = String(live);
    hud.dataset.spawned = String(A.spawned);
  }

  // Drag the region edges, or click / drag elsewhere to set the position.
  let hudDrag = null;
  function hudFrac(ev) {
    const r = hud.getBoundingClientRect();
    return clamp((ev.clientX - r.left) / r.width, 0, 1);
  }
  hud.addEventListener('pointerdown', (ev) => {
    const s = sample();
    if (!s || rec.active) return;
    ev.preventDefault();
    try { hud.setPointerCapture(ev.pointerId); } catch (e) { /* synthetic */ }
    const x = hudFrac(ev), r = hud.getBoundingClientRect(), near = 10 / r.width;
    if (Math.abs(x - s.start) < near) hudDrag = 'start';
    else if (Math.abs(x - s.end) < near) hudDrag = 'end';
    else hudDrag = 'position';
    hudMove(ev);
  });
  function hudMove(ev) {
    const s = sample();
    if (!hudDrag || !s) return;
    const x = hudFrac(ev);
    if (hudDrag === 'start') s.start = Math.min(x, s.end - 0.01);
    else if (hudDrag === 'end') s.end = Math.max(x, s.start + 0.01);
    else {
      // Position is relative to the region; reset the scan so it lands here.
      const pos = clamp((x - s.start) / (s.end - s.start), 0, 1) * 100;
      params.position = Math.round(pos * 2) / 2;
      playhead = 0;
      panel.set('position', params.position);
      saveSettings();
    }
  }
  hud.addEventListener('pointermove', hudMove);
  const endHud = () => { hudDrag = null; };
  hud.addEventListener('pointerup', endHud);
  hud.addEventListener('pointercancel', endHud);

  // ---------- controls ----------

  let panel = null;
  const FILTER_KEYS = new Set(['filterOn', 'filterType', 'cutoff', 'resonance']);
  const GLOBAL_KEYS = new Set(['volume', 'reverbOn', 'reverb', 'echoOn', 'echo', 'echoTime', 'echoFeedback', 'lfoWave', 'lfoRate', 'lfoFilter']);

  function onParam(key) {
    if (A.ctx) {
      if (FILTER_KEYS.has(key)) applyFilter();
      else if (GLOBAL_KEYS.has(key)) applyGlobal();
      else if (key === 'reverbSize') A.space.setLengthSoon(params.reverbSize);
      else if (key === 'drive' || key === 'driveOn') {
        clearTimeout(A.driveTimer);
        A.driveTimer = setTimeout(buildDrive, 30);
      }
    }
    if (key === 'position') playhead = 0;
    saveSettings();
  }

  let kb = null;
  const monoBtn = document.getElementById('mono');
  const polyBtn = document.getElementById('poly');
  const spanSel = document.getElementById('span');
  const labelsCb = document.getElementById('labels');

  function setMode(mode) {
    if (mode !== params.mode) {
      silenceAll();
      params.mode = mode;
      saveSettings();
      for (const n of kb.held()) engineOn(n);
    }
    monoBtn.setAttribute('aria-pressed', String(mode === 'mono'));
    polyBtn.setAttribute('aria-pressed', String(mode === 'poly'));
  }

  monoBtn.addEventListener('click', () => setMode('mono'));
  polyBtn.addEventListener('click', () => setMode('poly'));
  document.getElementById('oct-down').addEventListener('click', () => kb.shiftOctave(-1));
  document.getElementById('oct-up').addEventListener('click', () => kb.shiftOctave(1));
  document.getElementById('panic').addEventListener('click', () => kb.panic());
  spanSel.addEventListener('change', () => {
    params.span = parseInt(spanSel.value, 10);
    kb.setSpan(params.span);
    params.octave = kb.octave;
    saveSettings();
    spanSel.blur();
  });
  labelsCb.addEventListener('change', () => {
    params.labels = labelsCb.checked;
    kb.setLabels(params.labels);
    saveSettings();
    labelsCb.blur();
  });

  document.getElementById('defaults').addEventListener('click', () => {
    const oldSize = params.reverbSize;
    loadDefaults();
    panel.sync(params);
    if (A.ctx) {
      if (params.reverbSize !== oldSize) A.space.setLength(params.reverbSize);
      applyFilter();
      buildDrive();
    }
    playhead = 0;
    saveSettings();
  });

  N.ui.makeStrip(document.getElementById('bend'), {
    value: 0.5, spring: 0.5,
    onInput: (v) => { bend = v * 2 - 1; if (Math.abs(bend) < 0.04) bend = 0; },
  });
  N.ui.makeStrip(document.getElementById('mod'), { value: 0, onInput: (v) => { modWheel = v; } });

  const scope = N.ui.createScope(document.getElementById('scope'), {
    analyser: () => A.analyser,
    active: () => !!(A.ctx && (A.voices.length || A.grains)),
  });

  N.audio.installUnlock({ ensure: ensureAudio, current: () => A.ctx });

  // ---------- start ----------

  loadDefaults();
  loadSettings();
  panel = N.ui.buildKnobGroups(document.getElementById('groups'), GROUPS, {
    values: params,
    onInput: (key, v) => { params[key] = v; onParam(key); },
  });
  kb = N.ui.createKeyboard({
    keys: document.getElementById('keys'),
    octave: params.octave, span: params.span, labels: params.labels,
    rangeEl: document.getElementById('oct-range'),
    sustainButton: document.getElementById('sustain'),
    onNoteOn: engineOn,
    onNoteOff: engineOff,
    onOctave: (o) => { params.octave = o; saveSettings(); },
    onPanic: silenceAll,
  });
  spanSel.value = String(params.span);
  labelsCb.checked = params.labels;
  setMode(params.mode);
  setFreeze(params.freeze);
  loadDemo();
  setStatus('Demo loaded — play the keys, or record your own sound');

  function frame() {
    drawHud();
    scope.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
