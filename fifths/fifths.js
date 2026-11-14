// A circle of fifths you can play. The outer ring holds the 12 major chords,
// the inner ring their relative minors. Each chord is a button: click / tap
// it, or press its key (number row = majors, Q row = minors). Sliding a finger
// or the mouse across the wheel plays each chord you pass over.
//
// Sound uses the same Web Audio synth as the graph app: two detuned
// oscillators per note plus an optional octave shimmer, a soft envelope, a
// low-pass filter, a generated-impulse reverb and a feedback delay.
(function () {
  'use strict';

  const STORAGE_KEY = 'nmlq-fifths-v1';
  const MAJOR_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
  const MINOR_NAMES = ['Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm'];
  const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

  // Chord ids: 0–11 are the majors clockwise from C, 12–23 the minors below them.
  const KEY_CODES = [
    'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal',
    'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight',
  ];
  const KEY_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']'];

  // ---------- parameters ----------
  const PARAM_DEFS = [
    { section: 'Sound' },
    { key: 'soundOn', label: 'Sound on', bool: true },
    { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 60, unit: '%' },
    { key: 'wave', label: 'Waveform', options: [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Sawtooth'], ['square', 'Square']], select: 'triangle' },
    { key: 'attack', label: 'Attack', min: 2, max: 1000, step: 1, value: 12, unit: 'ms' },
    { key: 'decay', label: 'Decay', min: 0.2, max: 10, step: 0.1, value: 4, unit: 's' },
    { key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, value: 40, unit: '%' },
    { key: 'detune', label: 'Chorus (detune)', min: 0, max: 40, step: 1, value: 7, unit: '¢' },
    { key: 'shimmer', label: 'Octave shimmer', min: 0, max: 100, step: 1, value: 20, unit: '%' },
    { key: 'vibrato', label: 'Vibrato depth', min: 1, max: 40, step: 1, value: 6, unit: '¢', toggle: false },

    { section: 'Chords' },
    {
      key: 'style', label: 'Chord type', select: 'triad', options: [
        ['triad', 'Triads'], ['seventh', 'Major 7 / minor 7'], ['dom', 'Dominant 7 / minor 7'],
        ['add9', 'Add 9'], ['sus2', 'Sus2'], ['sus4', 'Sus4'], ['power', 'Power (1–5–8)'],
      ],
    },
    { key: 'voicing', label: 'Voicing', select: 'smooth', options: [['smooth', 'Smooth (nearest notes)'], ['close', 'Root position'], ['open', 'Open (spread)']] },
    { key: 'octave', label: 'Octave', min: 2, max: 6, step: 1, value: 4 },
    { key: 'bass', label: 'Add bass note', bool: true },
    { key: 'strum', label: 'Strum', min: 0, max: 200, step: 5, value: 25, unit: 'ms' },
    { key: 'direction', label: 'Strum direction', select: 'up', options: [['up', 'Up'], ['down', 'Down'], ['alternate', 'Alternate']] },

    { section: 'Playing' },
    { key: 'damp', label: 'Stop when released', bool: false },
    { key: 'release', label: 'Release time', min: 20, max: 2000, step: 10, value: 300, unit: 'ms' },
    { key: 'slide', label: 'Slide across chords', bool: true },

    { section: 'Space' },
    { key: 'reverb', label: 'Reverb mix', min: 0, max: 100, step: 1, value: 35, unit: '%', toggle: true },
    { key: 'reverbSize', label: 'Reverb length', min: 0.5, max: 8, step: 0.1, value: 3.5, unit: 's' },
    { key: 'echo', label: 'Echo mix', min: 0, max: 100, step: 1, value: 25, unit: '%', toggle: false },
    { key: 'echoTime', label: 'Echo time', min: 50, max: 1000, step: 5, value: 375, unit: 'ms' },
    { key: 'echoFeedback', label: 'Echo feedback', min: 0, max: 90, step: 1, value: 35, unit: '%' },

    { section: 'Auto-play' },
    { key: 'auto', label: 'Play chords automatically', bool: false },
    {
      key: 'pattern', label: 'Progression', select: 'walk', options: [
        ['walk', 'Wander to neighbours'], ['pop', 'I – V – vi – IV'], ['fifties', 'I – vi – IV – V'],
        ['circle', 'Clockwise (fifths)'], ['fourths', 'Anticlockwise (fourths)'], ['random', 'Random'],
      ],
    },
    { key: 'bpm', label: 'Tempo', min: 40, max: 200, step: 1, value: 72, unit: ' bpm' },
    { key: 'beats', label: 'Beats per chord', min: 1, max: 8, step: 1, value: 4 },
    { key: 'autoStyle', label: 'Play as', select: 'block', options: [['block', 'Chords'], ['arp', 'Arpeggio']] },
    { key: 'arpRate', label: 'Arpeggio notes per beat', min: 1, max: 4, step: 1, value: 2 },

    { section: 'Display' },
    { key: 'showKeys', label: 'Show keyboard keys', bool: true },
    { key: 'showNotes', label: 'Show chord notes', bool: true },
    { key: 'showShape', label: 'Show chord shape', bool: true },
  ];

  const params = {};
  const enabled = {};
  const on = (k) => enabled[k] !== false;

  function loadDefaults() {
    for (const d of PARAM_DEFS) {
      if (!d.key) continue;
      if ('bool' in d) params[d.key] = d.bool;
      else if ('options' in d) params[d.key] = d.select;
      else {
        params[d.key] = d.value;
        if ('toggle' in d) enabled[d.key] = d.toggle;
      }
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ params, enabled })); } catch (e) { /* ignore */ }
  }

  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved) return;
      for (const d of PARAM_DEFS) {
        if (!d.key) continue;
        const v = saved.params && saved.params[d.key];
        if (typeof v !== typeof params[d.key]) continue;
        if (typeof v === 'number') params[d.key] = Math.min(d.max, Math.max(d.min, v));
        else if (d.options) { if (d.options.some((o) => o[0] === v)) params[d.key] = v; }
        else params[d.key] = v;
        if (saved.enabled && d.key in enabled && d.key in saved.enabled) enabled[d.key] = !!saved.enabled[d.key];
      }
    } catch (e) { /* ignore */ }
  }

  // ---------- music ----------

  const STYLES = {
    triad: [[0, 4, 7], [0, 3, 7]],
    seventh: [[0, 4, 7, 11], [0, 3, 7, 10]],
    dom: [[0, 4, 7, 10], [0, 3, 7, 10]],
    add9: [[0, 4, 7, 14], [0, 3, 7, 14]],
    sus2: [[0, 2, 7], [0, 2, 7]],
    sus4: [[0, 5, 7], [0, 5, 7]],
    power: [[0, 7, 12], [0, 7, 12]],
  };

  const isMinor = (id) => id >= 12;
  const ringIndex = (id) => id % 12;
  const rootPc = (id) => (ringIndex(id) * 7 + (isMinor(id) ? 9 : 0)) % 12;
  const chordName = (id) => (isMinor(id) ? MINOR_NAMES : MAJOR_NAMES)[ringIndex(id)];
  // Position of a pitch class on the circle (inverse of pc = 7 * i).
  const circlePos = (pc) => (pc * 7) % 12;

  function spelling(id) {
    const i = ringIndex(id);
    const flat = isMinor(id) ? i >= 6 : i >= 7;
    return flat ? FLATS : SHARPS;
  }

  function chordIntervals(id) {
    return (STYLES[params.style] || STYLES.triad)[isMinor(id) ? 1 : 0];
  }

  // Returns ascending MIDI notes for a chord.
  function chordMidi(id) {
    const base = 12 * (params.octave + 1);
    const root = rootPc(id);
    let notes = chordIntervals(id).map((iv) => {
      if (params.voicing === 'smooth') {
        // Every chord sits in the same narrow range, so changes move smoothly.
        const pc = (root + iv) % 12;
        return base + (pc > 6 ? pc - 12 : pc) + (iv >= 12 ? 12 : 0);
      }
      return base + root + iv;
    });
    if (params.voicing === 'open' && notes.length >= 3) notes[1] += 12;
    if (params.bass) notes.push(base - 12 + root - (params.voicing === 'smooth' && root > 6 ? 12 : 0));
    notes = Array.from(new Set(notes)).sort((a, b) => a - b);
    return notes;
  }

  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- audio ----------

  const audio = {
    ctx: null,
    bus: null, filter: null, dry: null, wet: null, convolver: null,
    delay: null, feedback: null, echoWet: null, master: null,
    lfo: null, lfoGain: null,
    voices: [],
    reverbTimer: 0,
  };

  function ensureAudio() {
    if (!audio.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ac = new AC();
      audio.ctx = ac;
      audio.bus = ac.createGain();
      audio.filter = ac.createBiquadFilter();
      audio.filter.type = 'lowpass';
      audio.filter.Q.value = 0.6;
      audio.dry = ac.createGain();
      audio.wet = ac.createGain();
      audio.convolver = ac.createConvolver();
      audio.delay = ac.createDelay(2);
      audio.feedback = ac.createGain();
      audio.echoWet = ac.createGain();
      audio.master = ac.createGain();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 4;

      audio.bus.connect(audio.filter);
      audio.filter.connect(audio.dry).connect(audio.master);
      audio.filter.connect(audio.convolver).connect(audio.wet).connect(audio.master);
      audio.filter.connect(audio.delay);
      audio.delay.connect(audio.feedback).connect(audio.delay);
      audio.delay.connect(audio.echoWet).connect(audio.master);
      audio.echoWet.connect(audio.convolver);
      audio.master.connect(comp).connect(ac.destination);

      audio.lfo = ac.createOscillator();
      audio.lfo.frequency.value = 5.2;
      audio.lfoGain = ac.createGain();
      audio.lfo.connect(audio.lfoGain);
      audio.lfo.start();

      buildImpulse();
      applyAudioParams(true);
    }
    // iOS can also report 'interrupted' (e.g. after a call or app switch).
    if (audio.ctx.state !== 'running') audio.ctx.resume().catch(() => {});
    return audio.ctx;
  }

  function buildImpulse() {
    const ac = audio.ctx;
    const len = Math.max(1, Math.floor(ac.sampleRate * params.reverbSize));
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    audio.convolver.buffer = buf;
  }

  function applyAudioParams(immediate) {
    if (!audio.ctx) return;
    const t = audio.ctx.currentTime;
    const set = (param, v) => (immediate ? param.setValueAtTime(v, t) : param.setTargetAtTime(v, t, 0.05));
    const rev = on('reverb') ? params.reverb / 100 : 0;
    const echo = on('echo') ? params.echo / 100 : 0;
    set(audio.master.gain, params.soundOn ? (params.volume / 100) * 0.9 : 0);
    set(audio.filter.frequency, 250 * Math.pow(64, params.brightness / 100));
    set(audio.dry.gain, 1 - rev * 0.45);
    set(audio.wet.gain, rev * 1.2);
    set(audio.echoWet.gain, echo * 0.8);
    set(audio.delay.delayTime, params.echoTime / 1000);
    set(audio.feedback.gain, params.echoFeedback / 100);
    set(audio.lfoGain.gain, on('vibrato') ? params.vibrato : 0);
  }

  // One note. Returns a voice that can be released early.
  function playFreq(freq, peak, when) {
    const ac = audio.ctx;
    const t = Math.max(when || 0, ac.currentTime);
    const atk = params.attack / 1000;
    const dec = params.decay;
    const end = t + atk + dec;

    const env = ac.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + atk);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    env.connect(audio.bus);

    const oscs = [];
    const addOsc = (type, f, detune, level) => {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      audio.lfoGain.connect(o.detune);
      const g = ac.createGain();
      g.gain.value = level;
      o.connect(g).connect(env);
      o.start(t);
      o.stop(end + 0.05);
      oscs.push(o);
    };
    addOsc(params.wave, freq, -params.detune / 2, 0.5);
    addOsc(params.wave, freq, params.detune / 2, 0.5);
    if (params.shimmer > 0) addOsc('sine', freq * 2, 0, (params.shimmer / 100) * 0.35);

    const voice = { env, oscs, t, atk, dec, peak, end, released: false };
    oscs[0].onended = () => {
      env.disconnect();
      for (const o of oscs) { try { audio.lfoGain.disconnect(o.detune); } catch (e) { /* not connected */ } }
      const idx = audio.voices.indexOf(voice);
      if (idx >= 0) audio.voices.splice(idx, 1);
    };
    audio.voices.push(voice);

    while (audio.voices.length > 48) releaseVoice(audio.voices.shift(), 0.12);
    return voice;
  }

  // Envelope level at time `now`, so a release starts from where the note is.
  function envValue(v, now) {
    if (now <= v.t) return 0;
    if (now < v.t + v.atk) return v.peak * (now - v.t) / v.atk;
    const p = Math.min(1, (now - v.t - v.atk) / v.dec);
    return v.peak * Math.pow(0.0001 / v.peak, p);
  }

  function releaseVoice(v, seconds) {
    const ac = audio.ctx;
    const now = ac.currentTime;
    if (v.released || now >= v.end) return;
    v.released = true;
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(envValue(v, now), now);
    g.setTargetAtTime(0, now, seconds / 4);
    for (const o of v.oscs) { try { o.stop(now + seconds); } catch (e) { /* already stopping */ } }
  }

  function stopAll() {
    if (!audio.ctx) return;
    for (const v of audio.voices.slice()) releaseVoice(v, 0.08);
    for (const id in active) active[id] = [];
  }

  // ---------- iOS audio unlock ----------
  // On iPhone (Safari and Chrome both use WebKit) Web Audio is muted by the
  // ring/silent switch unless the page's audio session is "playback", and the
  // context only starts inside certain gestures (touchend / click).
  let iosUnlocked = false;
  let silentEl = null;

  function silentWavUrl() {
    const n = 800, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    str(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }

  function unlockAudio() {
    if (!params.soundOn) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
    const ac = ensureAudio();
    if (!ac) return;
    if (!iosUnlocked) {
      try {
        if (!silentEl) {
          silentEl = document.createElement('audio');
          silentEl.setAttribute('playsinline', '');
          silentEl.src = silentWavUrl();
        }
        const p = silentEl.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* ignore */ }
      try {
        const src = ac.createBufferSource();
        src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
        src.connect(ac.destination);
        src.start(0);
      } catch (e) { /* ignore */ }
    }
    if (ac.state === 'running') iosUnlocked = true;
  }

  // ---------- playing chords ----------

  const glow = new Array(24).fill(0);   // per chord button
  const dotGlow = new Array(12).fill(0); // per pitch class on the inner clock
  const holds = new Array(24).fill(0);  // how many fingers / keys hold each chord
  const active = {};                    // chord id -> voices from held presses
  let shape = { id: -1, glow: 0 };
  let strumUp = true;

  function noteOrder(notes) {
    if (params.direction === 'down') return notes.slice().reverse();
    if (params.direction === 'alternate') {
      const up = strumUp;
      strumUp = !strumUp;
      return up ? notes.slice() : notes.slice().reverse();
    }
    return notes.slice();
  }

  // Light a chord, its notes and its shape (now, or when it is heard).
  function flash(id, when) {
    const show = () => {
      glow[id] = 1;
      for (const iv of chordIntervals(id)) dotGlow[(rootPc(id) + iv) % 12] = 1;
      shape = { id, glow: 1 };
      setShape(id);
      setCenter(id);
    };
    const delay = audio.ctx && when ? (when - audio.ctx.currentTime) * 1000 : 0;
    if (delay > 15) setTimeout(show, delay); else show();
  }

  function playChord(id, opts) {
    opts = opts || {};
    if (!params.soundOn) return [];
    const ac = ensureAudio();
    if (!ac) return [];
    const velocity = opts.velocity == null ? 0.8 : opts.velocity;
    const notes = noteOrder(chordMidi(id));
    const peak = 0.13 * velocity * Math.sqrt(3 / Math.max(3, notes.length));
    const t0 = opts.when || ac.currentTime;
    const voices = notes.map((m, k) => playFreq(midiFreq(m), peak, t0 + (k * params.strum) / 1000));
    flash(id, t0);
    return voices;
  }

  function press(id) {
    holds[id]++;
    const voices = playChord(id);
    (active[id] = active[id] || []).push(...voices);
    auto.current = id;
    auto.key = ringIndex(id);
    auto.step = 0;
    auto.fresh = false;
  }

  function release(id) {
    if (holds[id] <= 0) return;
    holds[id]--;
    if (holds[id] === 0) {
      if (params.damp && audio.ctx) for (const v of active[id] || []) releaseVoice(v, params.release / 1000);
      active[id] = [];
    }
  }

  // ---------- auto-play ----------

  const auto = { next: 0, step: 0, current: 0, key: 0, fresh: true };

  function nextAutoChord() {
    if (auto.fresh) { auto.fresh = false; return auto.current; }
    const c = auto.current, ring = isMinor(c) ? 12 : 0, i = ringIndex(c), k = auto.key;
    let id;
    switch (params.pattern) {
      case 'pop': id = [k, (k + 1) % 12, 12 + k, (k + 11) % 12][++auto.step % 4]; break;
      case 'fifties': id = [k, 12 + k, (k + 11) % 12, (k + 1) % 12][++auto.step % 4]; break;
      case 'circle': id = ring + (i + 1) % 12; break;
      case 'fourths': id = ring + (i + 11) % 12; break;
      case 'random': id = Math.floor(Math.random() * 24); break;
      default: {
        const options = [ring + (i + 1) % 12, ring + (i + 11) % 12, (12 - ring) + i];
        id = options[Math.floor(Math.random() * options.length)];
      }
    }
    auto.current = id;
    return id;
  }

  function scheduleAuto() {
    if (!params.auto || !params.soundOn || !audio.ctx) { auto.next = 0; return; }
    const ac = audio.ctx;
    const beat = 60 / params.bpm;
    if (auto.next < ac.currentTime) auto.next = ac.currentTime + 0.05;
    while (auto.next < ac.currentTime + 0.1) {
      const id = nextAutoChord();
      const when = auto.next;
      if (params.autoStyle === 'arp') {
        const notes = chordMidi(id);
        const steps = params.beats * params.arpRate;
        // Up then back down, without repeating the top and bottom notes.
        const cycle = notes.length > 1 ? notes.concat(notes.slice(1, -1).reverse()) : notes;
        const peak = 0.12;
        for (let k = 0; k < steps; k++) {
          playFreq(midiFreq(cycle[k % cycle.length]), k % params.arpRate === 0 ? peak : peak * 0.75, when + (k * beat) / params.arpRate);
        }
        flash(id, when);
      } else {
        playChord(id, { when, velocity: 0.7 });
      }
      auto.next += beat * params.beats;
    }
  }

  // ---------- the wheel ----------

  const wheel = document.getElementById('wheel');
  const shapeEl = document.getElementById('shape');
  const dotsEl = document.getElementById('dots');
  const nowEl = document.getElementById('now');
  const notesEl = document.getElementById('notes');
  const buttons = [];
  const dots = [];
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DOT_R = 16;

  const angleOf = (pos) => (-90 + pos * 30) * Math.PI / 180;
  const hueOf = (pos) => (pos * 30) % 360;

  function buildWheel() {
    for (let id = 0; id < 24; id++) {
      const i = ringIndex(id), r = isMinor(id) ? 27.5 : 41, a = angleOf(i);
      const b = document.createElement('button');
      b.className = 'chord ' + (isMinor(id) ? 'minor' : 'major');
      b.dataset.id = id;
      b.style.left = (50 + r * Math.cos(a)) + '%';
      b.style.top = (50 + r * Math.sin(a)) + '%';
      b.style.setProperty('--hue', hueOf(i));
      b.style.setProperty('--glow', 0);
      b.setAttribute('aria-label', (isMinor(id) ? MINOR_NAMES[i].replace('m', ' minor') : MAJOR_NAMES[i] + ' major') + ', key ' + KEY_LABELS[id]);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = chordName(id);
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = KEY_LABELS[id];
      b.append(name, key);
      wheel.appendChild(b);
      buttons.push(b);
    }
    for (let pos = 0; pos < 12; pos++) {
      const c = document.createElementNS(SVG_NS, 'circle');
      const a = angleOf(pos);
      c.setAttribute('class', 'dot');
      c.setAttribute('cx', 50 + DOT_R * Math.cos(a));
      c.setAttribute('cy', 50 + DOT_R * Math.sin(a));
      c.setAttribute('r', 1.4);
      c.style.setProperty('--hue', hueOf(pos));
      c.style.setProperty('--glow', 0);
      dotsEl.appendChild(c);
      dots.push(c);
    }
  }

  // The chord's notes joined on the small inner clock of pitch classes.
  function setShape(id) {
    const positions = Array.from(new Set(chordIntervals(id).map((iv) => circlePos((rootPc(id) + iv) % 12)))).sort((a, b) => a - b);
    shapeEl.setAttribute('points', positions.map((p) => {
      const a = angleOf(p);
      return (50 + DOT_R * Math.cos(a)).toFixed(2) + ',' + (50 + DOT_R * Math.sin(a)).toFixed(2);
    }).join(' '));
    shapeEl.style.setProperty('--hue', hueOf(ringIndex(id)));
  }

  function setCenter(id) {
    nowEl.textContent = chordName(id);
    const names = spelling(id);
    notesEl.textContent = chordIntervals(id).map((iv) => names[(rootPc(id) + iv) % 12]).join(' · ');
  }

  function applyDisplay() {
    wheel.classList.toggle('hide-keys', !params.showKeys);
    wheel.classList.toggle('hide-notes', !params.showNotes);
    wheel.classList.toggle('hide-shape', !params.showShape);
  }

  // Glow fades over (at most) 1.5 s, or stays lit while held.
  let lastFrame = performance.now();
  function updateGlow(now) {
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const fade = Math.pow(0.02, dt / Math.min(1.5, params.decay));
    const heldPcs = new Set();
    for (let id = 0; id < 24; id++) {
      if (holds[id] > 0) for (const iv of chordIntervals(id)) heldPcs.add((rootPc(id) + iv) % 12);
    }
    for (let id = 0; id < 24; id++) {
      glow[id] = settle(holds[id] > 0 ? 1 : glow[id] * fade);
      paint(buttons[id], glow[id]);
    }
    for (let pc = 0; pc < 12; pc++) {
      dotGlow[pc] = settle(heldPcs.has(pc) ? 1 : dotGlow[pc] * fade);
      paint(dots[circlePos(pc)], dotGlow[pc]);
    }
    shape.glow = settle(shape.id >= 0 && holds[shape.id] > 0 ? 1 : shape.glow * fade);
    paint(shapeEl, shape.glow);
  }

  const settle = (g) => (g < 0.003 ? 0 : g);
  // Only touch the DOM when the value visibly changes.
  function paint(el, g) {
    const s = g.toFixed(3);
    if (el._glow !== s) { el._glow = s; el.style.setProperty('--glow', s); }
  }

  // ---------- input ----------

  // Browsers only allow audio after a user gesture; iOS only honours some of
  // these as unlock gestures, so listen to all of them.
  for (const type of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
    window.addEventListener(type, unlockAudio, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audio.ctx && audio.ctx.state !== 'running') {
      audio.ctx.resume().catch(() => {});
    }
  });

  const pointers = new Map(); // pointerId -> chord id it is holding (or -1)

  function chordAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const b = el && el.closest ? el.closest('.chord') : null;
    return b ? parseInt(b.dataset.id, 10) : -1;
  }

  wheel.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const id = chordAt(ev.clientX, ev.clientY);
    pointers.set(ev.pointerId, id);
    if (id >= 0) { ev.preventDefault(); press(id); }
  });

  window.addEventListener('pointermove', (ev) => {
    if (!pointers.has(ev.pointerId) || !params.slide) return;
    const id = chordAt(ev.clientX, ev.clientY);
    const prev = pointers.get(ev.pointerId);
    if (id === prev) return;
    if (prev >= 0) release(prev);
    if (id >= 0) press(id);
    pointers.set(ev.pointerId, id);
  });

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;
    const id = pointers.get(ev.pointerId);
    pointers.delete(ev.pointerId);
    if (id >= 0) release(id);
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);

  // Keyboard activation of a focused chord button (Enter / Space).
  wheel.addEventListener('click', (ev) => {
    if (ev.detail !== 0) return; // real clicks are handled by pointer events
    const b = ev.target.closest('.chord');
    if (!b) return;
    const id = parseInt(b.dataset.id, 10);
    press(id);
    release(id);
  });

  wheel.addEventListener('contextmenu', (ev) => ev.preventDefault());

  const keysDown = new Map(); // event.code -> chord id

  window.addEventListener('keydown', (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === 'SELECT' || tag === 'TEXTAREA' || (tag === 'INPUT' && ev.target.type === 'text')) return;
    if (ev.key === 'Escape') { stopAll(); return; }
    const id = KEY_CODES.indexOf(ev.code);
    if (id < 0) return;
    ev.preventDefault();
    if (ev.repeat || keysDown.has(ev.code)) return;
    keysDown.set(ev.code, id);
    press(id);
  });

  window.addEventListener('keyup', (ev) => {
    if (!keysDown.has(ev.code)) return;
    release(keysDown.get(ev.code));
    keysDown.delete(ev.code);
  });

  // Let go of everything if the window loses focus mid-press.
  window.addEventListener('blur', () => {
    for (const id of keysDown.values()) release(id);
    keysDown.clear();
    for (const id of pointers.values()) if (id >= 0) release(id);
    pointers.clear();
  });

  // ---------- settings panel ----------

  const rowRefs = {};
  const AUDIO_KEYS = new Set(['soundOn', 'volume', 'brightness', 'reverb', 'echo', 'echoTime', 'echoFeedback', 'vibrato']);

  function formatValue(def, v) {
    const decimals = def.step < 1 ? (String(def.step).split('.')[1] || '').length : 0;
    return v.toFixed(decimals) + (def.unit || '');
  }

  function onParamChanged(key) {
    if (AUDIO_KEYS.has(key)) applyAudioParams();
    else if (key === 'reverbSize' && audio.ctx) {
      clearTimeout(audio.reverbTimer);
      audio.reverbTimer = setTimeout(buildImpulse, 200);
    } else if (key === 'showKeys' || key === 'showNotes' || key === 'showShape') applyDisplay();
    else if (key === 'auto' && params.auto) { auto.fresh = true; ensureAudio(); }
    else if (key === 'style' && shape.id >= 0) { setShape(shape.id); setCenter(shape.id); }
    if (key === 'soundOn' && !params.soundOn) stopAll();
    saveSettings();
  }

  function buildControls() {
    const container = document.getElementById('controls');
    for (const def of PARAM_DEFS) {
      if (def.section) {
        const h = document.createElement('div');
        h.className = 'section-title';
        h.textContent = def.section;
        container.appendChild(h);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'row';
      const head = document.createElement('div');
      head.className = 'row-head';
      const label = document.createElement('label');
      const text = document.createElement('span');
      text.className = 'label-text';
      text.textContent = def.label;
      const ref = { row };

      if ('bool' in def) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => { params[def.key] = cb.checked; onParamChanged(def.key); });
        label.append(cb, text);
        head.appendChild(label);
        row.appendChild(head);
        ref.checkbox = cb;
      } else if ('options' in def) {
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', def.label);
        for (const [value, name] of def.options) {
          const opt = document.createElement('option');
          opt.value = value;
          opt.textContent = name;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { params[def.key] = sel.value; onParamChanged(def.key); });
        label.appendChild(text);
        head.append(label, sel);
        row.appendChild(head);
        ref.select = sel;
      } else {
        if ('toggle' in def) {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.title = 'Enable / disable';
          cb.addEventListener('change', () => {
            enabled[def.key] = cb.checked;
            row.classList.toggle('disabled', !cb.checked);
            onParamChanged(def.key);
          });
          label.appendChild(cb);
          ref.checkbox = cb;
        }
        label.appendChild(text);
        const valueEl = document.createElement('span');
        valueEl.className = 'value';
        head.append(label, valueEl);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = def.min;
        input.max = def.max;
        input.step = def.step;
        input.setAttribute('aria-label', def.label);
        input.addEventListener('input', () => {
          params[def.key] = parseFloat(input.value);
          valueEl.textContent = formatValue(def, params[def.key]);
          onParamChanged(def.key);
        });
        row.append(head, input);
        Object.assign(ref, { input, valueEl });
      }
      rowRefs[def.key] = ref;
      container.appendChild(row);
    }
  }

  function syncControls() {
    for (const def of PARAM_DEFS) {
      if (!def.key) continue;
      const ref = rowRefs[def.key];
      if ('bool' in def) ref.checkbox.checked = params[def.key];
      else if ('options' in def) ref.select.value = params[def.key];
      else {
        ref.input.value = params[def.key];
        ref.valueEl.textContent = formatValue(def, params[def.key]);
        if (ref.checkbox) {
          ref.checkbox.checked = enabled[def.key];
          ref.row.classList.toggle('disabled', !enabled[def.key]);
        }
      }
    }
  }

  const panel = document.getElementById('panel');
  const collapseBtn = document.getElementById('collapse');
  function setCollapsed(collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('panel-open', !collapsed);
    collapseBtn.textContent = collapsed ? 'Show' : 'Hide';
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  collapseBtn.addEventListener('click', () => setCollapsed(!panel.classList.contains('collapsed')));

  document.getElementById('defaults').addEventListener('click', () => {
    const oldRev = params.reverbSize;
    loadDefaults();
    syncControls();
    applyDisplay();
    if (audio.ctx) {
      if (params.reverbSize !== oldRev) buildImpulse();
      applyAudioParams();
    }
    saveSettings();
  });

  document.getElementById('stop').addEventListener('click', () => {
    stopAll();
    if (params.auto) {
      params.auto = false;
      syncControls();
      saveSettings();
    }
  });

  // ---------- start ----------

  loadDefaults();
  loadSettings();
  buildWheel();
  buildControls();
  syncControls();
  applyDisplay();
  setCollapsed(window.innerWidth <= 640);

  function frame(now) {
    scheduleAuto();
    updateGlow(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
