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
// inputs. The voices themselves are nmlq.audio.createSynth (shared/audio.js,
// also used by Memory); this file adds the mono / poly note engine, drive,
// effects and the keyboard.
(function () {
  'use strict';

  const N = window.nmlq;
  const { clamp, fmt } = N;
  const STORAGE_KEY = 'nmlq-synth-v1';

  // ---------- parameters ----------
  // Numbers become knobs, `options` become drop-downs.
  const GROUPS = [
    ...N.synthVoiceGroups(),
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

  // ---------- audio graph ----------
  // The voices come from nmlq.audio.createSynth (shared with Memory); this
  // app adds drive, reverb / echo, the master chain and the scope.

  const A = { ctx: null, synth: null, driveTimer: 0 };
  let modWheel = 0; // 0..1
  let bend = 0;     // -1..1

  function ensureAudio() {
    if (!A.ctx) {
      const ac = N.audio.createContext();
      if (!ac || !ac.createConstantSource) return null;
      A.ctx = ac;
      A.shaper = ac.createWaveShaper();
      A.shaper.oversample = '2x';
      A.post = ac.createGain();
      A.space = N.audio.createSpace(ac, params.reverbSize);
      A.master = ac.createGain();
      const comp = N.audio.compressor(ac, { threshold: -14, knee: 10, ratio: 4, attack: 0.005, release: 0.2 });
      A.analyser = ac.createAnalyser();
      A.analyser.fftSize = 2048;
      A.synth = N.audio.createSynth(ac, { output: A.shaper, params, onFree: forget });

      A.shaper.connect(A.post).connect(A.space.input);
      A.space.output.connect(A.master).connect(comp).connect(A.analyser).connect(ac.destination);

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
    const set = (p, v) => N.audio.setParam(A.ctx, p, v, immediate, 0.03);
    set(A.master.gain, (params.volume / 100) * 0.9);
    set(A.post.gain, 1 - (params.drive / 100) * 0.55);
    A.space.set({
      reverb: params.reverb / 100, echo: params.echo / 100,
      echoTime: params.echoTime / 1000, echoFeedback: params.echoFeedback / 100,
    }, immediate);
    A.synth.applyGlobal(immediate, { vibrato: modWheel * 60, bend: bend * params.bendRange * 100 });
  }

  // A voice was stolen or freed: drop it from the note engine.
  function forget(v) {
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
    const target = A.synth.cents(note);
    let legato = false;
    for (const v of polyMap.values()) if (!v.released) legato = true;
    const glide = params.glide > 0 && lastCents != null && (params.glideMode === 'always' || legato);

    const old = polyMap.get(note);
    if (old) A.synth.steal(old);
    A.synth.makeRoom(params.voices); // released voices first, then the oldest

    const v = A.synth.voice(note, t, glide ? lastCents : target);
    if (glide) v.pitch.offset.setTargetAtTime(target, t, glideTau());
    A.synth.trigger(v, t, false);
    polyMap.set(note, v);
    lastCents = target;
  }

  function polyOff(note) {
    const v = polyMap.get(note);
    if (!v) return;
    polyMap.delete(note);
    A.synth.release(v);
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
    else if (mono.voice) A.synth.release(mono.voice);
  }

  function monoPlay(note, legato) {
    const t = A.ctx.currentTime;
    const target = A.synth.cents(note);
    const glide = params.glide > 0 && lastCents != null && (params.glideMode === 'always' || legato);
    let v = mono.voice;
    if (!v || v.dead || v.stolen) {
      v = mono.voice = A.synth.voice(note, t, glide ? lastCents : target);
      if (glide) v.pitch.offset.setTargetAtTime(target, t, glideTau());
      A.synth.trigger(v, t, false);
    } else {
      const p = v.pitch.offset;
      p.cancelScheduledValues(t);
      if (glide) p.setTargetAtTime(target, t, glideTau());
      else p.setValueAtTime(target, t);
      if (v.released || !(legato && params.monoEnv === 'legato')) {
        clearTimeout(v.timer);
        v.released = false;
        A.synth.trigger(v, t, true);
      }
      v.note = note;
    }
    lastCents = target;
  }

  function silenceAll() {
    mono.stack = [];
    if (!A.ctx) return;
    A.synth.stopAll();
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
  const VOICE_KEYS = new Set(N.SYNTH_VOICE_KEYS);
  const GLOBAL_KEYS = new Set([...N.SYNTH_GLOBAL_KEYS, 'volume', 'reverb', 'echo', 'echoTime', 'echoFeedback', 'bendRange']);

  function onParam(key) {
    if (A.ctx) {
      if (VOICE_KEYS.has(key)) A.synth.configureAll();
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
      A.synth.configureAll();
      if (params.reverbSize !== oldSize) A.space.setLength(params.reverbSize);
      buildDrive();
      applyGlobal();
    }
    saveSettings();
  });

  // ---------- oscilloscope ----------

  const scope = N.ui.createScope(document.getElementById('scope'), {
    analyser: () => A.analyser,
    active: () => !!(A.ctx && A.synth.voices.length),
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
