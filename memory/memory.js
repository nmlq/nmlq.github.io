// Memory: a four-pad repeat-the-sequence game.
//
// Four coloured pads sit in a circle, each with its own note. Press Start
// and the game plays a random sequence, lighting each pad as it sounds;
// repeat it by pressing the pads. Each round adds one more random pad to the
// end of the sequence. Repeat the whole sequence at the chosen length to
// win; a wrong pad ends the game (or replays the sequence, if mistakes are
// allowed). Outside a game the pads can be played freely.
//
// Sound: every pad plays one note on the shared subtractive synth voice
// (nmlq.audio.createSynth, the same engine as the Synth app), through the
// shared reverb / echo and compressor. The four notes default to a C major
// 7th chord (C E G B); other chords, any root and octave, or individual notes
// per pad can be picked on the Sound screen, along with every voice setting.
(function () {
  'use strict';

  const N = window.nmlq;
  const { fmt } = N;
  const STORAGE_KEY = 'nmlq-memory-v1';
  const PADS = 4;
  const PAD_NAMES = ['green', 'red', 'blue', 'yellow'];
  // Computer keys for the pads, clockwise from top-left.
  const PAD_KEYS = { KeyQ: 0, KeyW: 1, KeyS: 2, KeyA: 3, Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3 };

  // Four-note chords as semitones above the root.
  const CHORDS = {
    maj7: ['Major 7th', [0, 4, 7, 11]],
    m7: ['Minor 7th', [0, 3, 7, 10]],
    dom7: ['Dominant 7th', [0, 4, 7, 10]],
    maj: ['Major + octave', [0, 4, 7, 12]],
    min: ['Minor + octave', [0, 3, 7, 12]],
    sus4: ['Sus 4', [0, 5, 7, 12]],
    add9: ['Add 9', [0, 4, 7, 14]],
    pent: ['Pentatonic', [0, 2, 4, 7]],
    fifths: ['Stacked fifths', [0, 7, 14, 21]],
  };
  const CHORD_OPTIONS = [...Object.entries(CHORDS).map(([k, [name]]) => [k, name]), ['custom', 'Custom']];
  const NOTE_OPTIONS = [];
  for (let m = 36; m <= 96; m++) NOTE_OPTIONS.push([m, N.noteName(m)]);

  // ---------- parameters ----------

  const GAME_GROUPS = [
    {
      title: 'Game', params: [
        { key: 'length', label: 'Length', min: 2, max: 50, step: 1, value: 12, format: (v) => v + ' steps' },
        { key: 'speed', label: 'Speed', min: 50, max: 300, step: 5, value: 100, format: fmt.pct },
        { key: 'speedUp', label: 'Tempo', value: 'on', options: [['on', 'Speeds up'], ['off', 'Steady']] },
        { key: 'mistakes', label: 'On a mistake', value: 'over', options: [['over', 'Game over'], ['retry', 'Try again']] },
      ],
    },
  ];
  const SOUND_GROUPS = [
    {
      title: 'Notes', params: [
        { key: 'chord', label: 'Chord', value: 'maj7', options: CHORD_OPTIONS },
        { key: 'root', label: 'Root', value: 0, options: N.SHARPS.map((n, i) => [i, n]) },
        { key: 'octave', label: 'Octave', min: 2, max: 6, step: 1, value: 4 },
        ...PAD_NAMES.map((name, i) => ({
          key: 'pad' + i, label: 'Pad ' + (i + 1) + ' (' + name + ')', value: 60 + CHORDS.maj7[1][i], options: NOTE_OPTIONS,
        })),
      ],
    },
    // A soft, bell-like default rather than Synth's bright sawtooth.
    ...N.synthVoiceGroups({
      osc1Wave: 'triangle', osc2Wave: 'sine', osc2Oct: 1, osc2Detune: 0, osc2Level: 20,
      cutoff: 2600, resonance: 10, filterEnvAmt: 30, keyTrack: 70, fDecay: 500,
      decay: 600, sustain: 55, release: 350,
    }),
    {
      title: 'Output', params: [
        { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
        { key: 'reverb', label: 'Reverb', min: 0, max: 100, step: 1, value: 20, format: fmt.pct },
        { key: 'reverbSize', label: 'Reverb length', min: 0.3, max: 8, step: 0.1, value: 2.5, format: (v) => v.toFixed(1) + ' s' },
        { key: 'echo', label: 'Echo', min: 0, max: 100, step: 1, value: 0, format: fmt.pct },
        { key: 'echoTime', label: 'Echo time', min: 30, max: 1000, step: 5, value: 320, format: fmt.ms },
        { key: 'echoFeedback', label: 'Feedback', min: 0, max: 90, step: 1, value: 35, format: fmt.pct },
      ],
    },
  ];
  const DEFS = [...GAME_GROUPS, ...SOUND_GROUPS].flatMap((g) => g.params);
  const DEF = Object.fromEntries(DEFS.map((d) => [d.key, d]));
  // Drop-downs whose values are numbers (selects hand back strings).
  const NUMERIC = new Set(DEFS.filter((d) => d.options && typeof d.options[0][0] === 'number').map((d) => d.key));

  const params = {};
  let best = 0;

  function loadSettings() {
    N.loadDefaults(DEFS, params);
    const saved = N.loadJSON(STORAGE_KEY);
    if (!saved || typeof saved !== 'object') return;
    N.restoreParams(DEFS, params, saved);
    if (Number.isInteger(saved.best) && saved.best >= 0) best = saved.best;
  }
  const saveSettings = () => N.saveJSON(STORAGE_KEY, Object.assign({}, params, { best }));

  const padNote = (i) => params['pad' + i];

  // The pads follow the chord, root and octave unless set one by one.
  function applyChord() {
    const chord = CHORDS[params.chord];
    if (!chord) return;
    const base = 12 * (params.octave + 1) + params.root;
    chord[1].forEach((semi, i) => {
      params['pad' + i] = N.clamp(base + semi, NOTE_OPTIONS[0][0], NOTE_OPTIONS[NOTE_OPTIONS.length - 1][0]);
    });
  }

  // ---------- audio ----------

  const A = { ctx: null, synth: null };

  function ensureAudio() {
    if (!A.ctx) {
      const ac = N.audio.createContext();
      if (!ac || !ac.createConstantSource) return null;
      A.ctx = ac;
      A.space = N.audio.createSpace(ac, params.reverbSize);
      A.master = ac.createGain();
      A.synth = N.audio.createSynth(ac, { output: A.space.input, params });
      A.space.output.connect(A.master).connect(N.audio.compressor(ac, { threshold: -14, knee: 10 })).connect(ac.destination);
      applyGlobal(true);
    }
    return N.audio.resume(A.ctx);
  }

  function applyGlobal(immediate) {
    if (!A.ctx) return;
    N.audio.setParam(A.ctx, A.master.gain, (params.volume / 100) * 0.9, immediate);
    A.space.set({
      reverb: params.reverb / 100, echo: params.echo / 100,
      echoTime: params.echoTime / 1000, echoFeedback: params.echoFeedback / 100,
    }, immediate);
    A.synth.applyGlobal(immediate);
  }

  // Play a note for `seconds` (or until released when omitted).
  function sound(note, seconds) {
    if (!ensureAudio()) return null;
    return A.synth.play(note, seconds, 8);
  }

  // ---------- pads ----------

  const padEls = [...document.querySelectorAll('.pad')];
  const lit = new Array(PADS).fill(0); // how many things light each pad

  function light(i, on) {
    lit[i] = Math.max(0, lit[i] + (on ? 1 : -1));
    padEls[i].classList.toggle('lit', lit[i] > 0);
  }

  function clearLights() {
    lit.fill(0);
    for (const el of padEls) el.classList.remove('lit');
  }

  function labelPads() {
    padEls.forEach((el, i) => {
      const key = Object.keys(PAD_KEYS).find((k) => PAD_KEYS[k] === i).replace('Key', '');
      el.querySelector('.tag').innerHTML = N.noteName(padNote(i)) + '<br><kbd>' + key + '</kbd>';
    });
  }

  // ---------- game ----------

  const G = { state: 'idle', seq: [], pos: 0, timers: [] };
  const statusEl = document.getElementById('status');
  const countEl = document.getElementById('count');
  const ofEl = document.getElementById('of');
  const bestEl = document.getElementById('best');
  const startBtn = document.getElementById('start');

  const later = (ms, fn) => { G.timers.push(setTimeout(fn, ms)); };
  function cancelTimers() {
    for (const t of G.timers) clearTimeout(t);
    G.timers = [];
  }

  function setState(state, status) {
    G.state = state;
    document.body.dataset.state = state;
    if (status != null) statusEl.textContent = status;
    const playing = state === 'demo' || state === 'input' || state === 'wait';
    startBtn.textContent = playing ? 'Stop' : 'Start';
    countEl.textContent = G.seq.length ? String(G.seq.length) : '–';
    ofEl.textContent = 'of ' + params.length;
    bestEl.textContent = 'Best ' + best;
  }

  // Note and gap lengths in ms; the game quickens as the sequence grows.
  function timing() {
    const accel = params.speedUp === 'on' ? Math.min(2, 1 + (G.seq.length - 1) * 0.05) : 1;
    const k = (params.speed / 100) * accel;
    return { on: 420 / k, gap: 110 / k };
  }

  const randomPad = () => Math.floor(Math.random() * PADS);

  function start() {
    if (!ensureAudio()) return;
    stop();
    G.seq = [randomPad()];
    setState('wait', 'Listen…');
    later(500, playSequence);
  }

  function stop(status) {
    cancelTimers();
    releaseHeld();
    clearLights();
    if (A.synth) A.synth.stopAll();
    if (G.state !== 'idle' || status) setState('idle', status || 'Press Start');
  }

  function playSequence() {
    setState('demo', 'Listen…');
    const { on, gap } = timing();
    G.seq.forEach((pad, i) => {
      later(i * (on + gap), () => {
        light(pad, true);
        sound(padNote(pad), on / 1000);
      });
      later(i * (on + gap) + on, () => light(pad, false));
    });
    later(G.seq.length * (on + gap), () => {
      G.pos = 0;
      setState('input', 'Your turn');
    });
  }

  // A pad pressed during the player's turn.
  function check(pad) {
    if (G.state !== 'input') return;
    if (pad !== G.seq[G.pos]) { mistake(); return; }
    G.pos++;
    if (G.pos < G.seq.length) return;
    best = Math.max(best, G.seq.length);
    saveSettings();
    if (G.seq.length >= params.length) { win(); return; }
    setState('wait', 'Good!');
    later(900, () => {
      releaseHeld();
      G.seq.push(randomPad());
      playSequence();
    });
  }

  function mistake() {
    const reached = G.seq.length - 1;
    setState('wait', 'Wrong!');
    later(120, () => {
      releaseHeld();
      // A low, dissonant buzz with every pad lit.
      const low = Math.min(padNote(0), padNote(1), padNote(2), padNote(3)) - 12;
      sound(low, 0.7);
      sound(low + 6, 0.7);
      for (let i = 0; i < PADS; i++) light(i, true);
    });
    later(820, () => { for (let i = 0; i < PADS; i++) light(i, false); });
    if (params.mistakes === 'retry') {
      later(1500, playSequence);
    } else {
      later(900, () => {
        setState('lost', 'Game over · ' + reached + (reached === 1 ? ' step' : ' steps'));
      });
    }
  }

  function win() {
    setState('wait', 'You win!');
    // A quick run round the circle, then all four notes together.
    const order = [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3];
    order.forEach((pad, i) => {
      later(400 + i * 70, () => { light(pad, true); sound(padNote(pad), 0.06); });
      later(400 + i * 70 + 60, () => light(pad, false));
    });
    const end = 400 + order.length * 70 + 80;
    later(end, () => {
      for (let i = 0; i < PADS; i++) { light(i, true); sound(padNote(i), 0.9); }
    });
    later(end + 900, () => {
      for (let i = 0; i < PADS; i++) light(i, false);
      setState('won', 'You win! · ' + G.seq.length + ' steps');
    });
  }

  // ---------- input ----------
  // Each pointer or key holds its pad (lit, note sounding) until released.

  const held = new Map(); // pointerId or key code -> { pad, voice }

  function press(id, pad) {
    if (held.has(id) || G.state === 'demo' || G.state === 'wait') return;
    light(pad, true);
    held.set(id, { pad, voice: sound(padNote(pad)) });
    check(pad);
  }

  function release(id) {
    const h = held.get(id);
    if (!h) return;
    held.delete(id);
    light(h.pad, false);
    if (h.voice && A.synth) A.synth.release(h.voice);
  }

  function releaseHeld() {
    for (const id of [...held.keys()]) release(id);
  }

  padEls.forEach((el, i) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      press('p' + e.pointerId, i);
    });
    el.addEventListener('keydown', (e) => {
      // Enter / Space on a focused pad presses it.
      if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
        e.preventDefault();
        e.stopPropagation();
        press('k' + e.code, i);
      }
    });
    el.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); release('k' + e.code); }
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });
  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, (e) => release('p' + e.pointerId));
  }

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || N.isTypingTarget(e.target)) return;
    if (e.code in PAD_KEYS) {
      if (!e.repeat) press('k' + e.code, PAD_KEYS[e.code]);
      e.preventDefault();
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) startBtn.click();
    } else if (e.code === 'Escape') {
      stop();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code in PAD_KEYS) release('k' + e.code);
  });
  window.addEventListener('blur', releaseHeld);

  startBtn.addEventListener('click', () => {
    const playing = G.state === 'demo' || G.state === 'input' || G.state === 'wait';
    if (playing) stop(); else start();
    startBtn.blur();
  });

  // ---------- settings ----------

  let gamePanel = null, soundPanel = null;
  const VOICE_KEYS = new Set(N.SYNTH_VOICE_KEYS);
  const GLOBAL_KEYS = new Set([...N.SYNTH_GLOBAL_KEYS, 'volume', 'reverb', 'echo', 'echoTime', 'echoFeedback']);
  const NOTE_KEYS = new Set(['chord', 'root', 'octave']);

  function onInput(key, v) {
    params[key] = NUMERIC.has(key) ? Number(v) : v;
    if (NOTE_KEYS.has(key)) {
      if (key !== 'chord' && params.chord === 'custom') params.chord = 'maj7';
      applyChord();
      soundPanel.sync(params);
      labelPads();
    } else if (/^pad\d$/.test(key)) {
      params.chord = 'custom';
      soundPanel.set('chord', 'custom');
      labelPads();
      sound(params[key], 0.35);
    } else if (key === 'length') {
      setState(G.state);
    } else if (A.ctx) {
      if (VOICE_KEYS.has(key)) A.synth.configureAll();
      else if (GLOBAL_KEYS.has(key)) applyGlobal();
      else if (key === 'reverbSize') A.space.setLengthSoon(params.reverbSize);
    }
    saveSettings();
  }

  function buildPanels() {
    gamePanel = N.ui.buildKnobGroups(document.getElementById('game-groups'), GAME_GROUPS, { values: params, onInput });
    soundPanel = N.ui.buildKnobGroups(document.getElementById('sound-groups'), SOUND_GROUPS, { values: params, onInput });
  }

  const soundBtn = document.getElementById('show-sound');
  const soundCard = document.getElementById('sound');
  soundBtn.addEventListener('click', () => {
    soundCard.hidden = !soundCard.hidden;
    soundBtn.setAttribute('aria-pressed', String(!soundCard.hidden));
    if (!soundCard.hidden) soundCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    soundBtn.blur();
  });

  document.getElementById('defaults').addEventListener('click', (e) => {
    const oldSize = params.reverbSize;
    N.loadDefaults(DEFS, params);
    gamePanel.sync(params);
    soundPanel.sync(params);
    labelPads();
    if (A.ctx) {
      A.synth.configureAll();
      if (params.reverbSize !== oldSize) A.space.setLength(params.reverbSize);
      applyGlobal();
    }
    setState(G.state);
    saveSettings();
    e.currentTarget.blur();
  });

  // ---------- start ----------

  N.audio.installUnlock({ ensure: ensureAudio, current: () => A.ctx });

  loadSettings();
  buildPanels();
  labelPads();
  setState('idle');
  // Read by the browser tests.
  window.__memory = { get sequence() { return G.seq.slice(); }, get state() { return G.state; }, DEF };
})();
