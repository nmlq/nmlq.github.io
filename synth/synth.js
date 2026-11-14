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
          key: 'filterType', label: 'Type', value: 'lowpass', options: N.FILTER_TYPES,
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
    if (Number.isInteger(saved.octave)) params.octave = clamp(saved.octave, 0, N.maxOctave(params.span));
    if (typeof saved.labels === 'boolean') params.labels = saved.labels;
  }

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
    set(v.fA.Q, N.filterQ(ft, params.resonance));
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

  // ---------- keyboard and strips ----------
  // nmlq.ui.createKeyboard handles touch, mouse, computer keys, octave and
  // sustain, and calls engineOn / engineOff once per sounding note.

  let kb = null;

  function createKeyboard() {
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
  }

  N.ui.makeStrip(document.getElementById('bend'), {
    value: 0.5, spring: 0.5,
    onInput: (v) => { bend = v * 2 - 1; if (Math.abs(bend) < 0.04) bend = 0; applyGlobal(); },
  });
  N.ui.makeStrip(document.getElementById('mod'), {
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
  const spanSel = document.getElementById('span');
  const labelsCb = document.getElementById('labels');

  function setMode(mode) {
    if (mode !== params.mode) {
      // Notes still held keep their keys lit but restart in the new mode.
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
      for (const v of A.voices) configureVoice(v, false);
      if (params.reverbSize !== oldSize) A.space.setLength(params.reverbSize);
      buildDrive();
      applyGlobal();
    }
    saveSettings();
  });

  // ---------- oscilloscope ----------

  const scope = N.ui.createScope(document.getElementById('scope'), {
    analyser: () => A.analyser,
    active: () => !!(A.ctx && A.voices.length),
  });

  // ---------- starting audio ----------

  N.audio.installUnlock({ ensure: ensureAudio, current: () => A.ctx });

  // ---------- start ----------

  loadDefaults();
  loadSettings();
  buildPanel();
  createKeyboard();
  spanSel.value = String(params.span);
  labelsCb.checked = params.labels;
  setMode(params.mode);

  function frame() {
    scope.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
