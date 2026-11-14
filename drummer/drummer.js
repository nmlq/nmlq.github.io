// A 16-step drum sequencer. Every row uses the same drum sound generator: an
// oscillator with a pitch drop, mixed with white noise, each with its own
// decay, then a filter, drive, level and pan. The presets (kick, snare, hats,
// toms, …) are just starting settings for that one generator.
//
// Click or drag across steps to turn them on and off. Space or the Play
// button starts and stops. Shuffle delays every second 16th note.
(function () {
  'use strict';

  const N = window.nmlq;
  const { clamp } = N;
  const STORAGE_KEY = 'nmlq-drummer-v1';
  const STEPS = 16;

  // ---------- the drum sound generator ----------

  const { hz: fmtHz, ms: fmtMs, pct: fmtPct } = N.fmt;

  // Parameters of one drum sound, grouped as they appear in the editor.
  const SOUND_GROUPS = [
    {
      title: 'Oscillator', params: [
        { key: 'wave', label: 'Wave', options: N.WAVES },
        { key: 'pitch', label: 'Pitch', min: 20, max: 12000, log: true, format: fmtHz },
        { key: 'bend', label: 'Pitch drop', min: 0, max: 48, step: 1, format: (v) => Math.round(v) + ' st' },
        { key: 'bendTime', label: 'Drop time', min: 5, max: 500, log: true, format: fmtMs },
      ],
    },
    {
      title: 'Noise', params: [
        { key: 'noise', label: 'Noise mix', min: 0, max: 100, step: 1, format: fmtPct },
        { key: 'noiseDecay', label: 'Noise decay', min: 5, max: 2000, log: true, format: fmtMs },
      ],
    },
    {
      title: 'Envelope', params: [
        { key: 'attack', label: 'Attack', min: 0, max: 100, step: 0.5, format: fmtMs },
        { key: 'decay', label: 'Decay', min: 5, max: 2000, log: true, format: fmtMs },
      ],
    },
    {
      title: 'Filter', params: [
        { key: 'filter', label: 'Type', options: [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']] },
        { key: 'cutoff', label: 'Cutoff', min: 20, max: 20000, log: true, format: fmtHz },
        { key: 'q', label: 'Resonance', min: 0.1, max: 20, log: true, format: (v) => v.toFixed(1) },
      ],
    },
    {
      title: 'Output', params: [
        { key: 'drive', label: 'Drive', min: 0, max: 100, step: 1, format: fmtPct },
        { key: 'level', label: 'Level', min: 0, max: 100, step: 1, format: fmtPct },
        { key: 'pan', label: 'Pan', min: -100, max: 100, step: 1, format: (v) => (v === 0 ? 'C' : (v < 0 ? 'L' : 'R') + Math.abs(Math.round(v))) },
      ],
    },
  ];
  const SOUND_DEFS = SOUND_GROUPS.flatMap((g) => g.params);

  const BASE = {
    wave: 'sine', pitch: 200, bend: 0, bendTime: 50, noise: 0, noiseDecay: 100,
    attack: 0.5, decay: 200, filter: 'lowpass', cutoff: 18000, q: 0.7, drive: 0, level: 80, pan: 0,
  };

  const PRESETS = {
    kick: { name: 'Bass drum', hue: 0, sound: { wave: 'sine', pitch: 48, bend: 30, bendTime: 55, noise: 6, noiseDecay: 15, decay: 480, cutoff: 3000, drive: 25, level: 95 } },
    snare: { name: 'Snare', hue: 28, sound: { wave: 'triangle', pitch: 185, bend: 7, bendTime: 30, noise: 65, noiseDecay: 190, decay: 110, filter: 'highpass', cutoff: 160, level: 75 } },
    hat: { name: 'Hi-hat', hue: 52, sound: { wave: 'square', pitch: 7800, noise: 88, noiseDecay: 45, decay: 30, filter: 'highpass', cutoff: 7000, q: 1, level: 50, pan: 15 } },
    openhat: { name: 'Open hat', hue: 70, sound: { wave: 'square', pitch: 7800, noise: 88, noiseDecay: 380, decay: 220, filter: 'highpass', cutoff: 6500, q: 1, level: 45, pan: 15 } },
    tom: { name: 'Tom', hue: 140, sound: { wave: 'sine', pitch: 115, bend: 9, bendTime: 120, noise: 10, noiseDecay: 40, decay: 360, cutoff: 3000, level: 80, pan: -20 } },
    hitom: { name: 'High tom', hue: 165, sound: { wave: 'sine', pitch: 175, bend: 9, bendTime: 110, noise: 10, noiseDecay: 35, decay: 300, cutoff: 3500, level: 75, pan: 20 } },
    rim: { name: 'Rimshot', hue: 200, sound: { wave: 'triangle', pitch: 900, noise: 30, noiseDecay: 15, decay: 28, filter: 'highpass', cutoff: 500, q: 2, level: 60 } },
    clap: { name: 'Clap', hue: 280, sound: { noise: 100, noiseDecay: 170, attack: 4, decay: 10, filter: 'bandpass', cutoff: 1200, q: 1.4, level: 80 } },
    cowbell: { name: 'Cowbell', hue: 320, sound: { wave: 'square', pitch: 560, decay: 260, filter: 'bandpass', cutoff: 820, q: 3, level: 55 } },
    blank: { name: 'New drum', hue: 220, sound: {} },
  };

  const DEFAULT_KIT = [
    ['kick', [0, 4, 8, 12]],
    ['snare', [4, 12]],
    ['hat', [0, 2, 4, 6, 8, 10, 12, 14]],
    ['tom', [10, 14, 15]],
  ];

  // ---------- state ----------

  const state = { bpm: 110, shuffle: 0, volume: 75, rows: [], selected: 0 };
  let nextRowId = 1;

  function makeRow(presetKey, steps, name) {
    const p = PRESETS[presetKey] || PRESETS.blank;
    const row = {
      id: nextRowId++,
      name: name || p.name,
      hue: p.hue,
      sound: Object.assign({}, BASE, p.sound),
      steps: new Array(STEPS).fill(false),
      mute: false,
      solo: false,
    };
    for (const s of steps || []) row.steps[s] = true;
    return row;
  }

  function defaultKit() {
    nextRowId = 1;
    state.rows = DEFAULT_KIT.map(([k, steps]) => makeRow(k, steps));
    state.selected = 0;
  }

  function uniqueName(base) {
    const names = new Set(state.rows.map((r) => r.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(base + ' ' + n)) n++;
    return base + ' ' + n;
  }

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      N.saveJSON(STORAGE_KEY, {
        bpm: state.bpm, shuffle: state.shuffle, volume: state.volume, selected: state.selected,
        rows: state.rows.map((r) => ({ name: r.name, hue: r.hue, sound: r.sound, steps: r.steps, mute: r.mute, solo: r.solo })),
      });
    }, 250);
  }


  function load() {
    try {
      const saved = N.loadJSON(STORAGE_KEY);
      if (!saved || !Array.isArray(saved.rows)) return false;
      state.bpm = clamp(Number(saved.bpm) || 110, 40, 240);
      state.shuffle = clamp(Number(saved.shuffle) || 0, 0, 100);
      state.volume = clamp(saved.volume == null ? 75 : Number(saved.volume), 0, 100);
      nextRowId = 1;
      state.rows = saved.rows.map((r) => {
        const row = makeRow('blank', [], String(r.name || 'Drum').slice(0, 40));
        row.hue = Number(r.hue) || 0;
        for (const d of SOUND_DEFS) {
          const v = r.sound && r.sound[d.key];
          if (d.options) { if (d.options.some((o) => o[0] === v)) row.sound[d.key] = v; }
          else if (typeof v === 'number' && isFinite(v)) row.sound[d.key] = clamp(v, d.min, d.max);
        }
        if (Array.isArray(r.steps)) for (let i = 0; i < STEPS; i++) row.steps[i] = !!r.steps[i];
        row.mute = !!r.mute;
        row.solo = !!r.solo;
        return row;
      });
      state.selected = clamp(Number(saved.selected) || 0, 0, Math.max(0, state.rows.length - 1));
      return true;
    } catch (e) { return false; }
  }

  // ---------- audio ----------

  const audio = { ctx: null, master: null, noise: null, curves: {} };

  function ensureAudio() {
    if (!audio.ctx) {
      const ac = N.audio.createContext();
      if (!ac) return null;
      audio.ctx = ac;
      audio.master = ac.createGain();
      audio.master.connect(N.audio.compressor(ac, { threshold: -10, knee: 6, ratio: 4, attack: 0.003, release: 0.15 })).connect(ac.destination);
      // Two seconds of white noise, shared by every hit.
      audio.noise = N.audio.noiseBuffer(ac, 2);
      applyVolume();
    }
    return N.audio.resume(audio.ctx);
  }

  function applyVolume() {
    if (audio.ctx) audio.master.gain.setTargetAtTime(Math.pow(state.volume / 100, 1.5), audio.ctx.currentTime, 0.02);
  }

  function driveCurve(amount) {
    const key = Math.round(amount);
    if (!audio.curves[key]) audio.curves[key] = N.tanhCurve(1 + key / 4, 1024);
    return audio.curves[key];
  }

  // One hit of a drum sound at audio time `when`.
  function hit(sound, when) {
    const ac = audio.ctx;
    const t = Math.max(when || 0, ac.currentTime);
    const atk = Math.max(0.001, sound.attack / 1000);
    const level = sound.level / 100;
    const mix = sound.noise / 100;

    const sum = ac.createGain();
    const filter = ac.createBiquadFilter();
    filter.type = sound.filter;
    filter.frequency.value = Math.min(sound.cutoff, ac.sampleRate / 2 - 100);
    filter.Q.value = sound.q;
    sum.connect(filter);
    let tail = filter;
    if (sound.drive > 0) {
      const shaper = ac.createWaveShaper();
      shaper.curve = driveCurve(sound.drive);
      shaper.oversample = '2x';
      tail.connect(shaper);
      tail = shaper;
    }
    let out = tail;
    if (ac.createStereoPanner && sound.pan !== 0) {
      const pan = ac.createStereoPanner();
      pan.pan.value = sound.pan / 100;
      tail.connect(pan);
      out = pan;
    }
    out.connect(audio.master);

    const envelope = (param, peak, decay) => {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + atk);
      param.exponentialRampToValueAtTime(0.0001, t + atk + decay);
    };

    let last = null, lastEnd = 0;
    if (mix < 1) {
      const dec = sound.decay / 1000;
      const osc = ac.createOscillator();
      osc.type = sound.wave;
      const f = Math.min(sound.pitch, ac.sampleRate / 2 - 100);
      osc.frequency.setValueAtTime(Math.min(f * Math.pow(2, sound.bend / 12), ac.sampleRate / 2 - 100), t);
      if (sound.bend > 0) osc.frequency.exponentialRampToValueAtTime(f, t + sound.bendTime / 1000);
      const g = ac.createGain();
      envelope(g.gain, (1 - mix) * level, dec);
      osc.connect(g).connect(sum);
      osc.start(t);
      osc.stop(t + atk + dec + 0.05);
      last = osc; lastEnd = atk + dec;
    }
    if (mix > 0) {
      const dec = sound.noiseDecay / 1000;
      const src = ac.createBufferSource();
      src.buffer = audio.noise;
      src.loop = true;
      const g = ac.createGain();
      envelope(g.gain, mix * level, dec);
      src.connect(g).connect(sum);
      src.start(t, Math.random() * 1.5);
      src.stop(t + atk + dec + 0.05);
      if (atk + dec > lastEnd) last = src;
    }
    if (last) last.onended = () => out.disconnect();
  }

  // ---------- starting audio ----------

  N.audio.installUnlock({ ensure: ensureAudio, current: () => audio.ctx });

  // ---------- sequencer ----------

  const seq = { playing: false, step: 0, nextTime: 0, timer: 0, queue: [], shown: -1 };
  const LOOKAHEAD = 0.12;

  function audible(row) {
    if (row.mute) return false;
    return !state.rows.some((r) => r.solo) || row.solo;
  }

  function tick() {
    const ac = audio.ctx;
    const stepDur = 60 / state.bpm / 4;
    // If the tab was in the background, skip ahead instead of catching up.
    if (seq.nextTime < ac.currentTime - 0.2) seq.nextTime = ac.currentTime + 0.05;
    while (seq.nextTime < ac.currentTime + LOOKAHEAD) {
      // Shuffle pushes every second 16th later; 100% lands on a triplet-plus feel.
      const t = seq.nextTime + (seq.step % 2 ? (state.shuffle / 100) * stepDur * 0.5 : 0);
      for (const row of state.rows) if (row.steps[seq.step] && audible(row)) hit(row.sound, t);
      seq.queue.push({ step: seq.step, t });
      seq.nextTime += stepDur;
      seq.step = (seq.step + 1) % STEPS;
    }
  }

  function start() {
    if (!ensureAudio()) return;
    seq.playing = true;
    seq.step = 0;
    seq.queue = [];
    seq.nextTime = audio.ctx.currentTime + 0.06;
    tick();
    seq.timer = setInterval(tick, 25);
    updatePlayButton();
  }

  function stop() {
    seq.playing = false;
    clearInterval(seq.timer);
    seq.queue = [];
    showStep(-1);
    updatePlayButton();
  }

  const toggle = () => (seq.playing ? stop() : start());

  const makeKnob = N.ui.makeKnob;

  // ---------- sequencer view ----------

  const seqEl = document.getElementById('seq');
  let numberEls = [];
  const paint = { active: false, value: false, pointerId: null };

  function setStep(row, i, on) {
    if (row.steps[i] === on) return;
    row.steps[i] = on;
    row.cells[i].classList.toggle('on', on);
    row.cells[i].setAttribute('aria-pressed', String(on));
    if (on && !seq.playing && audio.ctx) hit(row.sound, 0);
    save();
  }

  function renderRows() {
    seqEl.textContent = '';

    // Step numbers
    const numRow = document.createElement('div');
    numRow.className = 'row numbers-row';
    numRow.setAttribute('aria-hidden', 'true');
    const numHead = document.createElement('div');
    const nums = document.createElement('div');
    nums.className = 'steps numbers';
    numberEls = [];
    for (let i = 0; i < STEPS; i++) {
      const s = document.createElement('span');
      s.textContent = i + 1;
      if (i % 4 === 0) s.className = 'beat';
      nums.appendChild(s);
      numberEls.push(s);
    }
    numRow.append(numHead, nums);
    seqEl.appendChild(numRow);

    state.rows.forEach((row, index) => {
      const el = document.createElement('div');
      el.className = 'row' + (index === state.selected ? ' selected' : '');
      el.style.setProperty('--hue', row.hue);
      row.el = el;

      const head = document.createElement('div');
      head.className = 'row-head';
      const led = document.createElement('span');
      led.className = 'led';
      row.led = led;

      const name = document.createElement('input');
      name.type = 'text';
      name.value = row.name;
      name.maxLength = 40;
      name.setAttribute('aria-label', 'Drum name');
      name.addEventListener('focus', () => select(index));
      name.addEventListener('input', () => {
        row.name = name.value;
        const title = document.querySelector('#editor h2 span');
        if (title && index === state.selected) title.textContent = row.name;
        save();
      });
      name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') name.blur(); });

      const btn = (label, title, onClick) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-label', title + ': ' + row.name);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(b); });
        return b;
      };
      const preview = btn('▷', 'Play sound', () => { select(index); if (ensureAudio()) hit(row.sound, 0); });
      const mute = btn('M', 'Mute', (b) => { row.mute = !row.mute; b.setAttribute('aria-pressed', String(row.mute)); save(); });
      mute.setAttribute('aria-pressed', String(row.mute));
      const solo = btn('S', 'Solo', (b) => { row.solo = !row.solo; b.setAttribute('aria-pressed', String(row.solo)); save(); });
      solo.setAttribute('aria-pressed', String(row.solo));
      const remove = btn('×', 'Remove row', () => removeRow(index));
      head.append(led, name, preview, mute, solo, remove);
      head.addEventListener('pointerdown', (ev) => { if (ev.target === head || ev.target === led) select(index); });

      const steps = document.createElement('div');
      steps.className = 'steps';
      row.cells = [];
      for (let i = 0; i < STEPS; i++) {
        const c = document.createElement('button');
        c.className = 'step' + (Math.floor(i / 4) % 2 ? ' alt' : '') + (row.steps[i] ? ' on' : '');
        c.dataset.row = index;
        c.dataset.step = i;
        c.setAttribute('aria-label', row.name + ' step ' + (i + 1));
        c.setAttribute('aria-pressed', String(row.steps[i]));
        steps.appendChild(c);
        row.cells.push(c);
      }
      el.append(head, steps);
      seqEl.appendChild(el);
    });
    seq.shown = -1;
  }

  // Click a step to toggle it; drag across steps to paint the same value.
  function cellAt(x, y) {
    const el = document.elementFromPoint(x, y);
    return el && el.classList && el.classList.contains('step') && el.dataset.row != null ? el : null;
  }

  seqEl.addEventListener('pointerdown', (ev) => {
    const c = ev.target.closest && ev.target.closest('.step');
    if (!c || ev.button > 0) return;
    const row = state.rows[+c.dataset.row];
    paint.active = true;
    paint.pointerId = ev.pointerId;
    paint.value = !row.steps[+c.dataset.step];
    setStep(row, +c.dataset.step, paint.value);
    if (+c.dataset.row !== state.selected) select(+c.dataset.row);
  });
  window.addEventListener('pointermove', (ev) => {
    if (!paint.active || ev.pointerId !== paint.pointerId) return;
    const c = cellAt(ev.clientX, ev.clientY);
    if (c) setStep(state.rows[+c.dataset.row], +c.dataset.step, paint.value);
  });
  const endPaint = (ev) => { if (ev.pointerId === paint.pointerId) paint.active = false; };
  window.addEventListener('pointerup', endPaint);
  window.addEventListener('pointercancel', endPaint);
  // Keyboard (Enter) on a focused step.
  seqEl.addEventListener('click', (ev) => {
    if (ev.detail !== 0) return;
    const c = ev.target.closest && ev.target.closest('.step');
    if (!c) return;
    const row = state.rows[+c.dataset.row];
    setStep(row, +c.dataset.step, !row.steps[+c.dataset.step]);
  });

  function select(index) {
    if (index === state.selected && state.rows[index] && state.rows[index].el.classList.contains('selected')) return;
    state.selected = index;
    state.rows.forEach((r, i) => r.el && r.el.classList.toggle('selected', i === index));
    renderEditor();
    save();
  }

  function removeRow(index) {
    state.rows.splice(index, 1);
    if (state.selected >= state.rows.length) state.selected = state.rows.length - 1;
    else if (state.selected > index) state.selected--;
    renderRows();
    renderEditor();
    save();
  }

  function addRow(presetKey) {
    const row = makeRow(presetKey, []);
    row.name = uniqueName(row.name);
    state.rows.push(row);
    state.selected = state.rows.length - 1;
    renderRows();
    renderEditor();
    save();
    if (ensureAudio()) hit(row.sound, 0);
    row.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Playhead and hit lights, in time with what you hear.
  function showStep(step) {
    if (step === seq.shown) return;
    if (seq.shown >= 0) {
      for (const r of state.rows) r.cells && r.cells[seq.shown] && r.cells[seq.shown].classList.remove('now');
      if (numberEls[seq.shown]) numberEls[seq.shown].classList.remove('now');
    }
    seq.shown = step;
    if (step < 0) return;
    if (numberEls[step]) numberEls[step].classList.add('now');
    for (const r of state.rows) {
      if (!r.cells) continue;
      r.cells[step].classList.add('now');
      if (r.steps[step] && audible(r)) {
        r.led.classList.remove('flash');
        void r.led.offsetWidth; // restart the animation
        r.led.classList.add('flash');
      }
    }
  }

  function frame() {
    if (seq.playing && audio.ctx) {
      let latest = null;
      while (seq.queue.length && seq.queue[0].t <= audio.ctx.currentTime) latest = seq.queue.shift();
      if (latest) showStep(latest.step);
    }
    requestAnimationFrame(frame);
  }

  // ---------- sound editor ----------

  const editorEl = document.getElementById('editor');
  let previewTimer = 0;

  function previewSoon(row) {
    if (seq.playing) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { if (ensureAudio()) hit(row.sound, 0); }, 120);
  }

  function renderEditor() {
    editorEl.textContent = '';
    const row = state.rows[state.selected];
    if (!row) {
      editorEl.innerHTML = '<p class="hint" style="margin:0">Add a drum to edit its sound.</p>';
      return;
    }
    editorEl.style.setProperty('--hue', row.hue);

    const head = document.createElement('div');
    head.className = 'editor-head';
    const h = document.createElement('h2');
    h.append('Sound: ');
    const nameSpan = document.createElement('span');
    nameSpan.textContent = row.name;
    h.appendChild(nameSpan);

    const preset = document.createElement('select');
    preset.setAttribute('aria-label', 'Load a preset into this drum');
    preset.appendChild(new Option('Load preset…', ''));
    for (const [k, p] of Object.entries(PRESETS)) preset.appendChild(new Option(p.name, k));
    preset.addEventListener('change', () => {
      const p = PRESETS[preset.value];
      if (!p) return;
      row.sound = Object.assign({}, BASE, p.sound);
      row.hue = p.hue;
      row.el.style.setProperty('--hue', row.hue);
      renderEditor();
      previewSoon(row);
      save();
    });

    const play = document.createElement('button');
    play.textContent = '▷ Play';
    play.addEventListener('click', () => { if (ensureAudio()) hit(row.sound, 0); });
    const clear = document.createElement('button');
    clear.textContent = 'Clear row';
    clear.addEventListener('click', () => { for (let i = 0; i < STEPS; i++) setStep(row, i, false); });
    head.append(h, preset, play, clear);
    editorEl.appendChild(head);

    const groups = document.createElement('div');
    groups.className = 'groups';
    N.ui.buildKnobGroups(groups, SOUND_GROUPS, {
      values: row.sound,
      defaults: BASE,
      onInput: (key, v) => { row.sound[key] = v; save(); },
      onChange: () => previewSoon(row),
    });
    editorEl.appendChild(groups);
  }

  // ---------- transport ----------

  const playBtn = document.getElementById('play');
  const bpmInput = document.getElementById('bpm-input');
  const transportKnobs = document.getElementById('transport-knobs');

  function updatePlayButton() {
    playBtn.textContent = seq.playing ? '■ Stop' : '▶ Play';
    playBtn.setAttribute('aria-pressed', String(seq.playing));
  }
  playBtn.addEventListener('click', toggle);

  const bpmKnob = makeKnob({
    label: 'Tempo', min: 40, max: 240, step: 1, value: state.bpm, def: 110,
    format: (v) => Math.round(v) + ' bpm',
    onInput: (v) => { state.bpm = v; bpmInput.value = v; save(); },
  });
  const shuffleKnob = makeKnob({
    label: 'Shuffle', min: 0, max: 100, step: 1, value: state.shuffle, def: 0, format: fmtPct,
    onInput: (v) => { state.shuffle = v; save(); },
  });
  const volumeKnob = makeKnob({
    label: 'Volume', min: 0, max: 100, step: 1, value: state.volume, def: 75, format: fmtPct,
    onInput: (v) => { state.volume = v; applyVolume(); save(); },
  });
  transportKnobs.append(bpmKnob.el, shuffleKnob.el, volumeKnob.el);

  bpmInput.addEventListener('change', () => {
    const v = clamp(Math.round(Number(bpmInput.value) || state.bpm), 40, 240);
    state.bpm = v;
    bpmInput.value = v;
    bpmKnob.set(v);
    save();
  });
  bpmInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') bpmInput.blur(); });

  const addSel = document.getElementById('add');
  addSel.appendChild(new Option('+ Add drum…', ''));
  for (const [k, p] of Object.entries(PRESETS)) addSel.appendChild(new Option(p.name, k));
  addSel.addEventListener('change', () => {
    if (addSel.value) addRow(addSel.value);
    addSel.value = '';
  });

  document.getElementById('clear').addEventListener('click', () => {
    for (const r of state.rows) for (let i = 0; i < STEPS; i++) if (r.steps[i]) { r.steps[i] = false; r.cells[i].classList.remove('on'); r.cells[i].setAttribute('aria-pressed', 'false'); }
    save();
  });

  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('Replace all rows, sounds and steps with the default kit?')) return;
    defaultKit();
    state.bpm = 110;
    state.shuffle = 0;
    syncTransport();
    renderRows();
    renderEditor();
    save();
  });

  function syncTransport() {
    bpmInput.value = state.bpm;
    bpmKnob.set(state.bpm);
    shuffleKnob.set(state.shuffle);
    volumeKnob.set(state.volume);
  }

  // Space plays / stops, except while typing in a text field.
  const typing = N.isTypingTarget;
  window.addEventListener('keydown', (ev) => {
    if (ev.code !== 'Space' || typing(ev.target) || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    ev.preventDefault();
    if (!ev.repeat) toggle();
  }, { capture: true });
  // Stop a focused button from also being "clicked" by the space bar.
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space' && !typing(ev.target)) ev.preventDefault();
  }, { capture: true });

  // ---------- start ----------

  if (!load()) defaultKit();
  syncTransport();
  renderRows();
  renderEditor();
  updatePlayButton();
  requestAnimationFrame(frame);
})();
