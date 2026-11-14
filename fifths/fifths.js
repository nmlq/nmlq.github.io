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

  const N = window.nmlq;
  const STORAGE_KEY = 'nmlq-fifths-v1';
  const MAJOR_NAMES = ['C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'D♭', 'A♭', 'E♭', 'B♭', 'F'];
  const MINOR_NAMES = ['Am', 'Em', 'Bm', 'F♯m', 'C♯m', 'G♯m', 'E♭m', 'B♭m', 'Fm', 'Cm', 'Gm', 'Dm'];
  const { SHARPS, FLATS, midiFreq, circlePos } = N;

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
    { key: 'wave', label: 'Waveform', options: N.WAVES, select: 'triangle' },
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

  const loadDefaults = () => N.loadDefaults(PARAM_DEFS, params, enabled);
  const saveSettings = () => N.saveJSON(STORAGE_KEY, { params, enabled });

  function loadSettings() {
    const saved = N.loadJSON(STORAGE_KEY);
    if (saved) N.restoreParams(PARAM_DEFS, params, saved.params, enabled, saved.enabled);
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


  // ---------- audio ----------
  // Shared building blocks: ring-out "pluck" voices -> low-pass filter ->
  // reverb / echo -> master -> compressor.

  const audio = { ctx: null, bus: null, filter: null, space: null, master: null, lfo: null, lfoGain: null, pluck: null };

  function ensureAudio() {
    if (!audio.ctx) {
      const ac = N.audio.createContext();
      if (!ac) return null;
      audio.ctx = ac;
      audio.bus = ac.createGain();
      audio.filter = ac.createBiquadFilter();
      audio.filter.type = 'lowpass';
      audio.filter.Q.value = 0.6;
      audio.space = N.audio.createSpace(ac, params.reverbSize);
      audio.master = ac.createGain();
      audio.bus.connect(audio.filter).connect(audio.space.input);
      audio.space.output.connect(audio.master).connect(N.audio.compressor(ac, { threshold: -16, knee: 12, ratio: 4 })).connect(ac.destination);

      // Shared vibrato LFO, routed into each voice's detune.
      audio.lfo = ac.createOscillator();
      audio.lfo.frequency.value = 5.2;
      audio.lfoGain = ac.createGain();
      audio.lfo.connect(audio.lfoGain);
      audio.lfo.start();

      audio.pluck = N.audio.createPluck(ac, { output: audio.bus, lfo: audio.lfoGain, maxVoices: 48 });
      applyAudioParams(true);
    }
    return N.audio.resume(audio.ctx);
  }

  function applyAudioParams(immediate) {
    if (!audio.ctx) return;
    const ac = audio.ctx;
    const set = (param, v) => N.audio.setParam(ac, param, v, immediate, 0.05);
    set(audio.master.gain, params.soundOn ? (params.volume / 100) * 0.9 : 0);
    set(audio.filter.frequency, 250 * Math.pow(64, params.brightness / 100));
    audio.space.set({
      reverb: on('reverb') ? params.reverb / 100 : 0,
      echo: on('echo') ? params.echo / 100 : 0,
      echoTime: params.echoTime / 1000,
      echoFeedback: params.echoFeedback / 100,
    }, immediate);
    set(audio.lfoGain.gain, on('vibrato') ? params.vibrato : 0);
  }

  // One note. Returns a voice that can be released early.
  function playFreq(freq, peak, when) {
    return audio.pluck.play(freq, peak, when, {
      wave: params.wave, attack: params.attack / 1000, decay: params.decay,
      detune: params.detune, shimmer: params.shimmer / 100,
    });
  }

  const releaseVoice = (v, seconds) => audio.pluck.release(v, seconds);

  function stopAll() {
    if (!audio.ctx) return;
    audio.pluck.stopAll(0.08);
    for (const id in active) active[id] = [];
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

  N.audio.installUnlock({ ensure: ensureAudio, current: () => audio.ctx, enabled: () => params.soundOn });

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
    if (N.isTypingTarget(ev.target)) return;
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

  let controls = null; // { sync } from nmlq.ui.buildParamPanel
  const AUDIO_KEYS = new Set(['soundOn', 'volume', 'brightness', 'reverb', 'echo', 'echoTime', 'echoFeedback', 'vibrato']);

  function onParamChanged(key) {
    if (AUDIO_KEYS.has(key)) applyAudioParams();
    else if (key === 'reverbSize' && audio.ctx) audio.space.setLengthSoon(params.reverbSize);
    else if (key === 'showKeys' || key === 'showNotes' || key === 'showShape') applyDisplay();
    else if (key === 'auto' && params.auto) { auto.fresh = true; ensureAudio(); }
    else if (key === 'style' && shape.id >= 0) { setShape(shape.id); setCenter(shape.id); }
    if (key === 'soundOn' && !params.soundOn) stopAll();
    saveSettings();
  }

  const panel = document.getElementById('panel');
  const setCollapsed = N.ui.collapsible(document.getElementById('collapse'), panel,
    (collapsed) => document.body.classList.toggle('panel-open', !collapsed));

  document.getElementById('defaults').addEventListener('click', () => {
    const oldRev = params.reverbSize;
    loadDefaults();
    controls.sync();
    applyDisplay();
    if (audio.ctx) {
      if (params.reverbSize !== oldRev) audio.space.setLength(params.reverbSize);
      applyAudioParams();
    }
    saveSettings();
  });

  document.getElementById('stop').addEventListener('click', () => {
    stopAll();
    if (params.auto) {
      params.auto = false;
      controls.sync();
      saveSettings();
    }
  });

  // ---------- start ----------

  loadDefaults();
  loadSettings();
  buildWheel();
  controls = N.ui.buildParamPanel({
    defs: PARAM_DEFS, params, enabled,
    container: () => document.getElementById('controls'),
    onChange: onParamChanged,
  });
  applyDisplay();
  setCollapsed(window.innerWidth <= 640);

  function frame(now) {
    scheduleAuto();
    updateGlow(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
