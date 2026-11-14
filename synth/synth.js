// A basic subtractive synthesizer with an on-screen keyboard.
//
// Each voice: two oscillators (sine / triangle / sawtooth / square, the same
// waveforms as the other apps), a sine sub-oscillator one octave below
// oscillator 1, and white noise, mixed into a filter (low-pass 12 / 24 dB,
// high-pass, band-pass or notch) and an amplifier. The filter and the
// amplifier each have their own ADSR envelope. One global LFO adds vibrato,
// filter wobble and tremolo. Voices run in mono (one note, last-note
// priority, optional legato and glide) or poly (up to 16 notes).
//
// Pitch is handled in cents: every voice has a ConstantSource holding its
// note (relative to A4) that drives the oscillators' detune, so portamento is
// a single glide on that value and the filter can follow it (key tracking).
// Pitch bend, vibrato and the filter LFO are summed into the same detune
// inputs.
(function () {
  'use strict';

  const N = window.nmlq;
  const { clamp, fmt } = N;
  const STORAGE_KEY = 'nmlq-synth-v1';
  const fmtRate = (v) => (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' Hz';

  // ---------- parameters ----------
  // Numbers become knobs, `options` become drop-downs.
  const GROUPS = [
    {
      title: 'Oscillator 1', params: [
        { key: 'osc1Wave', label: 'Wave', options: N.WAVES, value: 'sawtooth' },
        { key: 'osc1Oct', label: 'Octave', min: -2, max: 2, step: 1, value: 0, format: fmt.signed },
        { key: 'osc1Level', label: 'Level', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
      ],
    },
    {
      title: 'Oscillator 2', params: [
        { key: 'osc2Wave', label: 'Wave', options: N.WAVES, value: 'square' },
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
        {
          key: 'filterType', label: 'Type', value: 'lowpass', options: [
            ['lowpass', 'Low-pass 12 dB'], ['lowpass24', 'Low-pass 24 dB'], ['highpass', 'High-pass'],
            ['bandpass', 'Band-pass'], ['notch', 'Notch'],
          ],
        },
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
        { key: 'lfoWave', label: 'Wave', options: N.WAVES, value: 'sine' },
        { key: 'lfoRate', label: 'Rate', min: 0.1, max: 20, log: true, value: 5, format: fmtRate },
        { key: 'vibrato', label: 'Vibrato', min: 0, max: 100, step: 1, value: 0, format: (v) => v + '¢' },
        { key: 'lfoFilter', label: 'Filter', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'tremolo', label: 'Tremolo', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
      ],
    },
    {
      title: 'Voice', params: [
        { key: 'glide', label: 'Portamento', min: 0, max: 2000, step: 5, value: 0, format: fmt.ms },
        { key: 'glideMode', label: 'Glide', value: 'legato', options: [['legato', 'Legato only'], ['always', 'Always']] },
        { key: 'monoEnv', label: 'Mono envelopes', value: 'legato', options: [['legato', 'Legato'], ['retrigger', 'Retrigger']] },
        { key: 'voices', label: 'Poly voices', min: 1, max: 16, step: 1, value: 8 },
        { key: 'bendRange', label: 'Bend range', min: 1, max: 12, step: 1, value: 2, format: (v) => '±' + v + ' st' },
      ],
    },
    {
      title: 'Output', params: [
        { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
        { key: 'drive', label: 'Drive', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'reverb', label: 'Reverb', min: 0, max: 100, step: 1, value: 20, format: fmt.pct },
        { key: 'reverbSize', label: 'Reverb length', min: 0.3, max: 8, step: 0.1, value: 2.5, format: (v) => v.toFixed(1) + ' s' },
        { key: 'echo', label: 'Echo', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'echoTime', label: 'Echo time', min: 30, max: 1000, step: 5, value: 320, format: fmt.ms },
        { key: 'echoFeedback', label: 'Feedback', min: 0, max: 90, step: 1, value: 35, format: fmt.pct },
      ],
    },
  ];
  const DEFS = GROUPS.flatMap((g) => g.params);
  const DEF = Object.fromEntries(DEFS.map((d) => [d.key, d]));
  // Keyboard / mode settings, saved with the rest but not reset by Defaults.
  const LAYOUT_DEFAULTS = { mode: 'poly', octave: 3, span: 3, labels: true };

  const params = {};

  const loadDefaults = () => N.loadDefaults(DEFS, params);
  // Saved flat, together with the layout settings.
  const saveSettings = () => N.saveJSON(STORAGE_KEY, params);

  function loadSettings() {
    Object.assign(params, LAYOUT_DEFAULTS);
    const saved = N.loadJSON(STORAGE_KEY);
    if (!saved || typeof saved !== 'object') return;
    N.restoreParams(DEFS, params, saved);
    if (saved.mode === 'mono' || saved.mode === 'poly') params.mode = saved.mode;
    if ([3, 4, 5].includes(saved.span)) params.span = saved.span;
    if (Number.isInteger(saved.octave)) params.octave = clamp(saved.octave, 0, maxOctave());
    if (typeof saved.labels === 'boolean') params.labels = saved.labels;
  }

  const maxOctave = () => 8 - params.span;
  const cents = (note) => (note - 69) * 100;

  // ---------- audio graph ----------

  const A = { ctx: null, voices: [], driveTimer: 0 };
  let modWheel = 0; // 0..1
  let bend = 0;     // -1..1

  function ensureAudio() {
    if (!A.ctx) {
      const ac = N.audio.createContext();
      if (!ac || !ac.createConstantSource) return null;
      A.ctx = ac;
      A.bus = ac.createGain();
      A.shaper = ac.createWaveShaper();
      A.shaper.oversample = '2x';
      A.post = ac.createGain();
      A.trem = ac.createGain();
      A.space = N.audio.createSpace(ac, params.reverbSize);
      A.master = ac.createGain();
      const comp = N.audio.compressor(ac, { threshold: -14, knee: 10, ratio: 4, attack: 0.005, release: 0.2 });
      A.analyser = ac.createAnalyser();
      A.analyser.fftSize = 2048;
      A.scopeData = new Float32Array(A.analyser.fftSize);

      A.bus.connect(A.shaper).connect(A.post).connect(A.trem).connect(A.space.input);
      A.space.output.connect(A.master).connect(comp).connect(A.analyser).connect(ac.destination);

      // One LFO for every voice: vibrato (cents), filter (cents), tremolo (gain).
      A.lfo = ac.createOscillator();
      A.lfoPitch = ac.createGain();
      A.lfoFilter = ac.createGain();
      A.lfoTrem = ac.createGain();
      A.lfo.connect(A.lfoPitch);
      A.lfo.connect(A.lfoFilter);
      A.lfo.connect(A.lfoTrem).connect(A.trem.gain);
      A.lfo.start();

      // Pitch bend in cents, added to every oscillator's detune.
      A.bend = ac.createConstantSource();
      A.bend.offset.value = 0;
      A.bend.start();

      A.noiseBuf = N.audio.noiseBuffer(ac, 2);
      buildDrive();
      applyGlobal(true);
    }
    return N.audio.resume(A.ctx);
  }

  function buildDrive() {
    const k = params.drive / 100;
    A.shaper.curve = k === 0 ? null : N.tanhCurve(1 + k * 30, 2048);
  }

  function applyGlobal(immediate) {
    if (!A.ctx) return;
    const ac = A.ctx;
    const set = (p, v) => N.audio.setParam(ac, p, v, immediate, 0.03);
    const trem = params.tremolo / 100;
    set(A.master.gain, (params.volume / 100) * 0.9);
    set(A.post.gain, 1 - (params.drive / 100) * 0.55);
    A.space.set({
      reverb: params.reverb / 100, echo: params.echo / 100,
      echoTime: params.echoTime / 1000, echoFeedback: params.echoFeedback / 100,
    }, immediate);
    A.lfo.type = params.lfoWave;
    set(A.lfo.frequency, params.lfoRate);
    set(A.lfoPitch.gain, params.vibrato + modWheel * 60);
    set(A.lfoFilter.gain, (params.lfoFilter / 100) * 3 * 1200);
    set(A.trem.gain, 1 - trem / 2);
    set(A.lfoTrem.gain, trem / 2);
    A.bend.offset.setTargetAtTime(bend * params.bendRange * 100, ac.currentTime, 0.01);
  }

  // Low/high-pass Q is in dB in Web Audio; band-pass and notch Q is unitless.
  function qValue(type, res) {
    const r = res / 100;
    if (type === 'bandpass' || type === 'notch') return 0.5 * Math.pow(2, r * 5.3);
    return -1 + r * 21;
  }

  // ---------- envelopes ----------
  // Shared ADSR helpers track each stage so a retrigger or release can start
  // from wherever the envelope is now.
  const envValue = N.adsrValue;
  const { envStart, envRelease } = N.audio;

  // ---------- voices ----------

  const AMP_PEAK = 0.2;

  function makeVoice(note, t, startCents) {
    const ac = A.ctx;
    const v = { note, born: t, released: false, stolen: false, dead: false, timer: 0, ampEnv: {}, filtEnv: {} };
    v.pitch = ac.createConstantSource();
    v.pitch.offset.setValueAtTime(startCents, t);
    v.o1 = ac.createOscillator();
    v.o2 = ac.createOscillator();
    v.sub = ac.createOscillator();
    v.sub.type = 'sine';
    v.noise = ac.createBufferSource();
    v.noise.buffer = A.noiseBuf;
    v.noise.loop = true;
    v.g1 = ac.createGain();
    v.g2 = ac.createGain();
    v.gs = ac.createGain();
    v.gn = ac.createGain();
    v.fA = ac.createBiquadFilter();
    v.fB = ac.createBiquadFilter();
    v.kt = ac.createGain();
    v.amp = ac.createGain();
    v.amp.gain.value = 0;

    v.o1.connect(v.g1).connect(v.fA);
    v.o2.connect(v.g2).connect(v.fA);
    v.sub.connect(v.gs).connect(v.fA);
    v.noise.connect(v.gn).connect(v.fA);
    v.fA.connect(v.fB).connect(v.amp).connect(A.bus);

    v.oscs = [v.o1, v.o2, v.sub];
    for (const o of v.oscs) {
      v.pitch.connect(o.detune);
      A.bend.connect(o.detune);
      A.lfoPitch.connect(o.detune);
    }
    v.pitch.connect(v.kt);
    for (const f of [v.fA, v.fB]) {
      v.kt.connect(f.detune);
      A.lfoFilter.connect(f.detune);
    }

    configureVoice(v, true);
    v.pitch.start(t);
    for (const o of v.oscs) o.start(t);
    v.noise.start(t, Math.random() * 1.9);
    A.voices.push(v);
    return v;
  }

  // Apply the oscillator / mixer / filter settings to a voice.
  function configureVoice(v, immediate) {
    const t = A.ctx.currentTime;
    const set = (p, val) => (immediate ? p.setValueAtTime(val, t) : p.setTargetAtTime(val, t, 0.02));
    v.o1.type = params.osc1Wave;
    v.o2.type = params.osc2Wave;
    set(v.o1.frequency, 440 * Math.pow(2, params.osc1Oct));
    set(v.sub.frequency, 220 * Math.pow(2, params.osc1Oct));
    set(v.o2.frequency, 440 * Math.pow(2, params.osc2Oct));
    set(v.o2.detune, params.osc2Semi * 100 + params.osc2Detune);
    set(v.g1.gain, (params.osc1Level / 100) * 0.5);
    set(v.g2.gain, (params.osc2Level / 100) * 0.5);
    set(v.gs.gain, (params.subLevel / 100) * 0.5);
    set(v.gn.gain, (params.noiseLevel / 100) * 0.35);
    const ft = params.filterType;
    const lp24 = ft === 'lowpass24';
    v.fA.type = lp24 ? 'lowpass' : ft;
    // The second stage only filters in 24 dB mode; otherwise it is an all-pass.
    v.fB.type = lp24 ? 'lowpass' : 'allpass';
    set(v.fA.frequency, params.cutoff);
    set(v.fB.frequency, params.cutoff);
    set(v.fA.Q, qValue(ft, params.resonance));
    set(v.fB.Q, lp24 ? 0 : 0.7);
    set(v.kt.gain, params.keyTrack / 100);
  }

  function triggerEnvelopes(v, t, fromCurrent) {
    envStart([v.amp.gain], v.ampEnv, t, fromCurrent ? envValue(v.ampEnv, t) : 0,
      AMP_PEAK, AMP_PEAK * params.sustain / 100, params.attack / 1000, params.decay / 1000);
    const peak = (params.filterEnvAmt / 100) * 5 * 1200; // up to ±5 octaves
    envStart([v.fA.detune, v.fB.detune], v.filtEnv, t, fromCurrent ? envValue(v.filtEnv, t) : 0,
      peak, peak * params.fSustain / 100, params.fAttack / 1000, params.fDecay / 1000);
  }

  function releaseVoice(v) {
    if (v.released || v.dead) return;
    v.released = true;
    const now = A.ctx.currentTime;
    const r = params.release / 1000;
    envRelease([v.amp.gain], v.ampEnv, now, r);
    envRelease([v.fA.detune, v.fB.detune], v.filtEnv, now, params.fRelease / 1000);
    clearTimeout(v.timer);
    v.timer = setTimeout(() => killVoice(v), (r * 1.3 + 0.1) * 1000);
  }

  // Fast fade, used for voice stealing and "all off".
  function stealVoice(v) {
    if (v.dead || v.stolen) return;
    v.stolen = v.released = true;
    const now = A.ctx.currentTime;
    envRelease([v.amp.gain], v.ampEnv, now, 0.02);
    clearTimeout(v.timer);
    v.timer = setTimeout(() => killVoice(v), 60);
    if (polyMap.get(v.note) === v) polyMap.delete(v.note);
    if (mono.voice === v) mono.voice = null;
  }

  function killVoice(v) {
    if (v.dead) return;
    v.dead = true;
    clearTimeout(v.timer);
    for (const s of [v.pitch, v.noise, ...v.oscs]) { try { s.stop(); } catch (e) { /* not started */ } }
    for (const o of v.oscs) {
      try { A.bend.disconnect(o.detune); } catch (e) { /* ignore */ }
      try { A.lfoPitch.disconnect(o.detune); } catch (e) { /* ignore */ }
    }
    for (const f of [v.fA, v.fB]) { try { A.lfoFilter.disconnect(f.detune); } catch (e) { /* ignore */ } }
    v.amp.disconnect();
    const i = A.voices.indexOf(v);
    if (i >= 0) A.voices.splice(i, 1);
    if (polyMap.get(v.note) === v) polyMap.delete(v.note);
    if (mono.voice === v) mono.voice = null;
  }

  // ---------- note engine (mono / poly) ----------

  const polyMap = new Map();          // note -> sounding voice (poly)
  const mono = { stack: [], voice: null };
  let lastCents = null;               // where the next glide starts

  const glideTau = () => params.glide / 1000 / 4;

  function engineOn(note) {
    if (!ensureAudio()) return;
    if (params.mode === 'mono') monoOn(note); else polyOn(note);
  }

  function engineOff(note) {
    if (!A.ctx) return;
    if (params.mode === 'mono') monoOff(note); else polyOff(note);
  }

  function polyOn(note) {
    const t = A.ctx.currentTime;
    const target = cents(note);
    let legato = false;
    for (const v of polyMap.values()) if (!v.released) legato = true;
    const glide = params.glide > 0 && lastCents != null && (params.glideMode === 'always' || legato);

    const old = polyMap.get(note);
    if (old) stealVoice(old);
    const live = A.voices.filter((v) => !v.stolen && !v.dead);
    const excess = live.length - params.voices + 1;
    if (excess > 0) {
      // Steal released voices first, then the oldest.
      live.sort((a, b) => (b.released - a.released) || (a.born - b.born));
      for (let i = 0; i < excess; i++) stealVoice(live[i]);
    }

    const v = makeVoice(note, t, glide ? lastCents : target);
    if (glide) v.pitch.offset.setTargetAtTime(target, t, glideTau());
    triggerEnvelopes(v, t, false);
    polyMap.set(note, v);
    lastCents = target;
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
    // Last-note priority: fall back to the previous held note.
    if (mono.stack.length) monoPlay(mono.stack[mono.stack.length - 1], true);
    else if (mono.voice) releaseVoice(mono.voice);
  }

  function monoPlay(note, legato) {
    const t = A.ctx.currentTime;
    const target = cents(note);
    const glide = params.glide > 0 && lastCents != null && (params.glideMode === 'always' || legato);
    let v = mono.voice;
    if (!v || v.dead || v.stolen) {
      v = mono.voice = makeVoice(note, t, glide ? lastCents : target);
      if (glide) v.pitch.offset.setTargetAtTime(target, t, glideTau());
      triggerEnvelopes(v, t, false);
    } else {
      const p = v.pitch.offset;
      p.cancelScheduledValues(t);
      if (glide) p.setTargetAtTime(target, t, glideTau());
      else p.setValueAtTime(target, t);
      if (v.released || !(legato && params.monoEnv === 'legato')) {
        clearTimeout(v.timer);
        v.released = false;
        triggerEnvelopes(v, t, true);
      }
      v.note = note;
    }
    lastCents = target;
  }

  function silenceAll() {
    mono.stack = [];
    if (!A.ctx) return;
    for (const v of A.voices.slice()) stealVoice(v);
    polyMap.clear();
    mono.voice = null;
  }

  // ---------- input state: held keys and sustain ----------

  const phys = new Map();     // note -> number of fingers / keys holding it
  const sustained = new Set(); // released notes kept on by sustain
  let pedal = false;          // Space held
  let latch = false;          // Sustain button
  const sustainOn = () => pedal || latch;

  function noteDown(n) {
    if (n < 0 || n > 127) return;
    const c = phys.get(n) || 0;
    phys.set(n, c + 1);
    if (c === 0) {
      if (sustained.has(n)) { sustained.delete(n); engineOff(n); }
      engineOn(n);
    }
    paintKey(n);
  }

  function noteUp(n) {
    const c = phys.get(n) || 0;
    if (!c) return;
    if (c > 1) { phys.set(n, c - 1); return; }
    phys.delete(n);
    if (sustainOn()) sustained.add(n);
    else engineOff(n);
    paintKey(n);
  }

  function updateSustain() {
    if (!sustainOn() && sustained.size) {
      const list = Array.from(sustained);
      sustained.clear();
      for (const n of list) { engineOff(n); paintKey(n); }
    }
    sustainBtn.setAttribute('aria-pressed', String(sustainOn()));
  }

  function panic() {
    phys.clear();
    sustained.clear();
    pointers.clear();
    keysDown.clear();
    silenceAll();
    paintAllKeys();
  }

  // ---------- on-screen keyboard ----------

  const keysEl = document.getElementById('keys');
  const BLACK = new Set([1, 3, 6, 8, 10]);
  // Computer keys, as semitones above the lowest C on screen.
  const KEYMAP = {
    KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
    Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21,
    Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31,
  };
  const CODE_CHARS = { Comma: ',', Period: '.', Semicolon: ';', Slash: '/', BracketLeft: '[', BracketRight: ']', Equal: '=' };
  const codeChar = (code) => CODE_CHARS[code] || code.replace(/^Key|^Digit/, '');
  // One label per key: the Z row for the first octave, the Q row above it.
  const KEY_LABELS = {};
  for (const [code, i] of Object.entries(KEYMAP)) {
    if (i < 12 || !/^(Comma|KeyL|Period|Semicolon|Slash)$/.test(code)) KEY_LABELS[i] = codeChar(code);
  }

  let keyEls = [];
  const baseNote = () => 12 * (params.octave + 1);

  function buildKeyboard() {
    keysEl.textContent = '';
    keyEls = [];
    const count = params.span * 12 + 1;
    const w = 100 / (params.span * 7 + 1);
    let whites = 0;
    for (let i = 0; i < count; i++) {
      const black = BLACK.has(i % 12);
      const el = document.createElement('div');
      el.className = 'key ' + (black ? 'black' : 'white');
      el.dataset.i = i;
      if (black) {
        el.style.left = (whites * w - w * 0.31) + '%';
        el.style.width = (w * 0.62) + '%';
      } else {
        whites++;
      }
      const kl = document.createElement('span');
      kl.className = 'kl';
      kl.textContent = KEY_LABELS[i] || '';
      const nn = document.createElement('span');
      nn.className = 'nn';
      el.append(kl, nn);
      keysEl.appendChild(el);
      keyEls.push(el);
    }
    labelKeys();
  }

  function labelKeys() {
    const base = baseNote();
    keyEls.forEach((el, i) => {
      const n = base + i;
      const name = N.SHARPS[n % 12] + (Math.floor(n / 12) - 1);
      el.querySelector('.nn').textContent = n % 12 === 0 ? name : '';
      el.setAttribute('aria-label', name);
    });
    document.getElementById('oct-range').textContent = 'C' + params.octave + '–C' + (params.octave + params.span);
    keysEl.classList.toggle('no-labels', !params.labels);
    paintAllKeys();
  }

  function paintKey(n) {
    const el = keyEls[n - baseNote()];
    if (!el) return;
    el.classList.toggle('down', phys.has(n));
    el.classList.toggle('held', !phys.has(n) && sustained.has(n));
  }

  function paintAllKeys() {
    const base = baseNote();
    keyEls.forEach((_, i) => paintKey(base + i));
  }

  function setOctave(o) {
    o = clamp(o, 0, maxOctave());
    if (o === params.octave) return;
    params.octave = o;
    labelKeys();
    saveSettings();
  }

  // ---------- pointer input (multi-touch, slide between keys) ----------

  const pointers = new Map(); // pointerId -> note (or null)

  function noteAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const k = el && el.closest ? el.closest('.key') : null;
    if (!k || !keysEl.contains(k)) return null;
    return baseNote() + parseInt(k.dataset.i, 10);
  }

  keysEl.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    ev.preventDefault();
    const n = noteAtPoint(ev.clientX, ev.clientY);
    pointers.set(ev.pointerId, n);
    if (n != null) noteDown(n);
  });

  window.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    const n = noteAtPoint(ev.clientX, ev.clientY);
    const prev = pointers.get(ev.pointerId);
    if (n === prev) return;
    if (prev != null) noteUp(prev);
    if (n != null) noteDown(n);
    pointers.set(ev.pointerId, n);
  });

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;
    const n = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (n != null) noteUp(n);
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  keysEl.addEventListener('contextmenu', (ev) => ev.preventDefault());

  // ---------- computer keyboard ----------

  const keysDown = new Map(); // event.code -> note

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey || ev.defaultPrevented) return;
    if (N.isTypingTarget(ev.target)) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      if (!pedal) { pedal = true; updateSustain(); }
      return;
    }
    if (ev.key === 'Escape') { panic(); return; }
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') { ev.preventDefault(); if (!ev.repeat) setOctave(params.octave - 1); return; }
    if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!ev.repeat) setOctave(params.octave + 1); return; }
    if (!(ev.code in KEYMAP)) return;
    ev.preventDefault();
    if (ev.repeat || keysDown.has(ev.code)) return;
    const n = baseNote() + KEYMAP[ev.code];
    keysDown.set(ev.code, n);
    noteDown(n);
  });

  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') {
      ev.preventDefault(); // keep Space from clicking a focused button
      if (pedal) { pedal = false; updateSustain(); }
    }
    if (!keysDown.has(ev.code)) return;
    noteUp(keysDown.get(ev.code));
    keysDown.delete(ev.code);
  });

  // Let go of everything if the window loses focus mid-press.
  window.addEventListener('blur', () => {
    for (const n of keysDown.values()) noteUp(n);
    keysDown.clear();
    for (const n of pointers.values()) if (n != null) noteUp(n);
    pointers.clear();
    if (pedal) { pedal = false; updateSustain(); }
  });

  // ---------- pitch bend and mod wheel strips ----------

  function makeStrip(track, o) {
    const thumb = track.querySelector('.thumb');
    let value = o.value;
    const render = () => { thumb.style.top = ((1 - value) * 100) + '%'; };
    const fromEvent = (ev) => {
      const r = track.getBoundingClientRect();
      return clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
    };
    let active = null;
    track.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      track.setPointerCapture(ev.pointerId);
      active = ev.pointerId;
      value = fromEvent(ev);
      render();
      o.onInput(value);
    });
    track.addEventListener('pointermove', (ev) => {
      if (ev.pointerId !== active) return;
      value = fromEvent(ev);
      render();
      o.onInput(value);
    });
    const end = (ev) => {
      if (ev.pointerId !== active) return;
      active = null;
      if (o.spring != null) { value = o.spring; render(); o.onInput(value); }
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    render();
  }

  makeStrip(document.getElementById('bend'), {
    value: 0.5, spring: 0.5,
    onInput: (v) => { bend = v * 2 - 1; if (Math.abs(bend) < 0.04) bend = 0; applyGlobal(); },
  });
  makeStrip(document.getElementById('mod'), {
    value: 0,
    onInput: (v) => { modWheel = v; applyGlobal(); },
  });

  // ---------- front panel ----------

  let panel = null; // { set, sync } from nmlq.ui.buildKnobGroups
  const VOICE_KEYS = new Set(['osc1Wave', 'osc1Oct', 'osc1Level', 'osc2Wave', 'osc2Oct', 'osc2Semi', 'osc2Detune', 'osc2Level',
    'subLevel', 'noiseLevel', 'filterType', 'cutoff', 'resonance', 'keyTrack']);
  const GLOBAL_KEYS = new Set(['volume', 'reverb', 'echo', 'echoTime', 'echoFeedback', 'lfoWave', 'lfoRate', 'vibrato',
    'lfoFilter', 'tremolo', 'bendRange']);

  function onParam(key) {
    if (A.ctx) {
      if (VOICE_KEYS.has(key)) for (const v of A.voices) configureVoice(v, false);
      else if (GLOBAL_KEYS.has(key)) applyGlobal();
      else if (key === 'reverbSize') A.space.setLengthSoon(params.reverbSize);
      else if (key === 'drive') {
        clearTimeout(A.driveTimer);
        A.driveTimer = setTimeout(buildDrive, 30);
        applyGlobal();
      }
    }
    saveSettings();
  }

  function buildPanel() {
    panel = N.ui.buildKnobGroups(document.getElementById('groups'), GROUPS, {
      values: params,
      onInput: (key, v) => { params[key] = v; onParam(key); },
    });
  }

  // ---------- top bar ----------

  const monoBtn = document.getElementById('mono');
  const polyBtn = document.getElementById('poly');
  const sustainBtn = document.getElementById('sustain');
  const spanSel = document.getElementById('span');
  const labelsCb = document.getElementById('labels');

  function setMode(mode) {
    if (mode !== params.mode) {
      // Notes still held keep their keys lit but restart in the new mode.
      silenceAll();
      params.mode = mode;
      saveSettings();
      const held = new Set([...phys.keys(), ...sustained]);
      if (held.size) for (const n of held) engineOn(n);
    }
    monoBtn.setAttribute('aria-pressed', String(mode === 'mono'));
    polyBtn.setAttribute('aria-pressed', String(mode === 'poly'));
  }

  monoBtn.addEventListener('click', () => setMode('mono'));
  polyBtn.addEventListener('click', () => setMode('poly'));
  document.getElementById('oct-down').addEventListener('click', () => setOctave(params.octave - 1));
  document.getElementById('oct-up').addEventListener('click', () => setOctave(params.octave + 1));
  sustainBtn.addEventListener('click', () => { latch = !latch; updateSustain(); });
  document.getElementById('panic').addEventListener('click', panic);

  spanSel.addEventListener('change', () => {
    params.span = parseInt(spanSel.value, 10);
    params.octave = clamp(params.octave, 0, maxOctave());
    buildKeyboard();
    saveSettings();
    spanSel.blur();
  });
  labelsCb.addEventListener('change', () => {
    params.labels = labelsCb.checked;
    keysEl.classList.toggle('no-labels', !params.labels);
    saveSettings();
    labelsCb.blur();
  });

  document.getElementById('defaults').addEventListener('click', () => {
    const oldSize = params.reverbSize;
    loadDefaults();
    panel.sync(params);
    if (A.ctx) {
      for (const v of A.voices) configureVoice(v, false);
      if (params.reverbSize !== oldSize) A.space.setLength(params.reverbSize);
      buildDrive();
      applyGlobal();
    }
    saveSettings();
  });

  // ---------- oscilloscope ----------

  const scope = document.getElementById('scope');
  const sctx = scope.getContext('2d');
  let scopeColor = '';
  const readColor = () => { scopeColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); };
  readColor();
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', readColor);
  }

  function drawScope() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(scope.clientWidth * dpr), h = Math.round(scope.clientHeight * dpr);
    if (!w || !h) return;
    if (scope.width !== w || scope.height !== h) { scope.width = w; scope.height = h; }
    sctx.clearRect(0, 0, w, h);
    sctx.strokeStyle = scopeColor;
    sctx.lineWidth = 1.5 * dpr;
    sctx.beginPath();
    const live = A.ctx && A.voices.length;
    if (!live) {
      sctx.moveTo(0, h / 2);
      sctx.lineTo(w, h / 2);
    } else {
      const data = A.scopeData;
      A.analyser.getFloatTimeDomainData(data);
      // Start on a rising zero crossing so the wave stands still.
      let start = 0;
      for (let i = 1; i < data.length / 2; i++) if (data[i - 1] < 0 && data[i] >= 0) { start = i; break; }
      const n = 700;
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h / 2 - clamp(data[start + i] * 1.6, -1, 1) * (h / 2 - 2 * dpr);
        if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y);
      }
    }
    sctx.stroke();
  }

  // ---------- starting audio ----------

  N.audio.installUnlock({ ensure: ensureAudio, current: () => A.ctx });

  // ---------- start ----------

  loadDefaults();
  loadSettings();
  buildPanel();
  buildKeyboard();
  spanSel.value = String(params.span);
  labelsCb.checked = params.labels;
  setMode(params.mode);

  function frame() {
    drawScope();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
