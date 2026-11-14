// A fully connected graph of nodes laid out on a circle. Every pair of nodes
// is joined by a spring, so with 8 nodes the 28 edges draw an 8-pointed star.
// Physics uses Verlet integration with springs, repulsion, and hard length
// limits so the graph stretches but never comes apart.
//
// Each node is a tone on the circle of fifths (up to 12 nodes = all 12 pitch
// classes). Sound is synthesised with the Web Audio API: oscillators, gain
// envelopes, a low-pass filter, a generated-impulse reverb and a feedback delay.
// All tuning lives in `params` and is editable from the two side panels.
(function () {
  'use strict';

  const SUBSTEPS = 4;
  const DT = 1 / 60 / SUBSTEPS;
  const N = window.nmlq;
  const STORAGE_KEY = 'nmlq-settings-v2';
  const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  // ---------- parameters ----------
  // A `section` entry starts a group (and may switch panel). `value` gives a
  // slider; `toggle` adds an enable checkbox to it. `bool` is a checkbox and
  // `options` is a dropdown.
  const PARAM_DEFS = [
    // ----- left panel: sound -----
    { section: 'Sound', panel: 'sound' },
    { key: 'soundOn', label: 'Sound on', bool: true },
    { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 60, unit: '%' },
    { key: 'wave', label: 'Waveform', options: N.WAVES, select: 'triangle' },
    { key: 'attack', label: 'Attack', min: 2, max: 1000, step: 1, value: 12, unit: 'ms' },
    { key: 'decay', label: 'Decay', min: 0.2, max: 10, step: 0.1, value: 4, unit: 's' },
    { key: 'brightness', label: 'Brightness', min: 0, max: 100, step: 1, value: 40, unit: '%' },
    { key: 'detune', label: 'Chorus (detune)', min: 0, max: 40, step: 1, value: 7, unit: '¢' },
    { key: 'shimmer', label: 'Octave shimmer', min: 0, max: 100, step: 1, value: 20, unit: '%' },
    { key: 'vibrato', label: 'Vibrato depth', min: 1, max: 40, step: 1, value: 6, unit: '¢', toggle: false },

    { section: 'Tuning' },
    { key: 'root', label: 'Root note', options: NOTE_NAMES.map((n, i) => [String(i), n]), select: '0' },
    { key: 'octave', label: 'Octave', min: 1, max: 6, step: 1, value: 3 },
    { key: 'layout', label: 'Pitch layout', options: [['spread', 'Fifths over 2 octaves'], ['compact', 'Within 1 octave'], ['stacked', 'Stacked fifths']], select: 'spread' },
    { key: 'showNotes', label: 'Show note names', bool: true },

    { section: 'Space' },
    { key: 'reverb', label: 'Reverb mix', min: 0, max: 100, step: 1, value: 35, unit: '%', toggle: true },
    { key: 'reverbSize', label: 'Reverb length', min: 0.5, max: 8, step: 0.1, value: 3.5, unit: 's' },
    { key: 'echo', label: 'Echo mix', min: 0, max: 100, step: 1, value: 25, unit: '%', toggle: false },
    { key: 'echoTime', label: 'Echo time', min: 50, max: 1000, step: 5, value: 375, unit: 'ms' },
    { key: 'echoFeedback', label: 'Echo feedback', min: 0, max: 90, step: 1, value: 35, unit: '%' },

    { section: 'Triggers' },
    { key: 'playOnGrab', label: 'Play when grabbed', bool: true },
    { key: 'playOnWall', label: 'Play on wall hit', bool: true },
    { key: 'moveThreshold', label: 'Play on fast movement', min: 200, max: 4000, step: 50, value: 1400, unit: 'px/s', toggle: true },
    { key: 'cooldown', label: 'Retrigger delay', min: 50, max: 1000, step: 10, value: 250, unit: 'ms' },

    { section: 'Chords' },
    {
      key: 'chord', label: 'Chord', select: 'none', options: [
        ['none', 'Single note'], ['fifth', 'Power (1–5)'], ['major', 'Major'], ['minor', 'Minor'],
        ['sus2', 'Sus2'], ['sus4', 'Sus4'], ['maj7', 'Major 7'], ['min7', 'Minor 7'],
        ['add9', 'Add 9'], ['neighbors', 'Circle neighbours'],
      ],
    },
    { key: 'strum', label: 'Strum', min: 0, max: 200, step: 5, value: 35, unit: 'ms' },

    { section: 'Melody' },
    { key: 'melody', label: 'Play melody', bool: false },
    {
      key: 'pattern', label: 'Pattern', select: 'walk', options: [
        ['walk', 'Random walk'], ['circle', 'Around the circle'], ['star', 'Star path'],
        ['updown', 'Up & down'], ['random', 'Random'],
      ],
    },
    { key: 'bpm', label: 'Tempo', min: 40, max: 220, step: 1, value: 84, unit: ' bpm' },
    { key: 'division', label: 'Notes per beat', min: 1, max: 4, step: 1, value: 2 },
    { key: 'rest', label: 'Rests', min: 0, max: 80, step: 1, value: 15, unit: '%' },
    { key: 'downbeat', label: 'On each bar', select: 'bass', options: [['none', 'Nothing'], ['bass', 'Bass note'], ['chord', 'Chord']] },
    { key: 'kick', label: 'Notes kick nodes', min: 0, max: 10, step: 0.5, value: 3, toggle: true },

    // ----- right panel: physics & display -----
    { section: 'Edges', panel: 'physics' },
    { key: 'stiffness', label: 'Elasticity (stiffness)', min: 10, max: 500, step: 1, value: 140, toggle: true },
    { key: 'wobble', label: 'Wobble', min: 0, max: 100, step: 1, value: 60, unit: '%' },
    { key: 'uniform', label: 'Long edges as stiff as short ones', bool: false },
    { key: 'maxStretch', label: 'Max stretch', min: 1.1, max: 5, step: 0.1, value: 2.4, unit: '×', toggle: true },
    { key: 'minSquash', label: 'Min squash', min: 0.05, max: 0.9, step: 0.05, value: 0.25, unit: '×', toggle: true },

    { section: 'Nodes' },
    { key: 'nodeCount', label: 'Points', min: 3, max: 12, step: 1, value: 8 },
    { key: 'size', label: 'Star size', min: 10, max: 45, step: 1, value: 32, unit: '%' },
    { key: 'spacing', label: 'Min spacing', min: 0.1, max: 1.5, step: 0.05, value: 0.55, toggle: true },
    { key: 'repel', label: 'Repulsion strength', min: 0, max: 8000, step: 100, value: 2600 },
    { key: 'nodeRadius', label: 'Node size', min: 3, max: 24, step: 1, value: 11, unit: 'px' },

    { section: 'World' },
    { key: 'friction', label: 'Air friction', min: 0, max: 100, step: 1, value: 8, unit: '%' },
    { key: 'gravity', label: 'Gravity', min: 0, max: 3000, step: 50, value: 800, toggle: false },
    { key: 'centering', label: 'Pull to centre', min: 0, max: 5, step: 0.1, value: 0.6, toggle: true },
    { key: 'bounce', label: 'Walls (bounciness)', min: 0, max: 1, step: 0.05, value: 0.5, toggle: true },
    { key: 'speed', label: 'Simulation speed', min: 0.1, max: 2, step: 0.05, value: 1, unit: '×' },
    { key: 'paused', label: 'Pause simulation', bool: false },

    { section: 'Interaction' },
    { key: 'grab', label: 'Edge grab strength', min: 100, max: 3000, step: 50, value: 900 },
    { key: 'fieldRadius', label: 'Push / pull radius', min: 40, max: 400, step: 5, value: 140, unit: 'px', toggle: true },
    { key: 'fieldStrength', label: 'Push / pull strength', min: 1000, max: 30000, step: 500, value: 9000 },
    { key: 'fling', label: 'Fling nodes on release', bool: true },

    { section: 'Display' },
    { key: 'strainColor', label: 'Colour edges by strain', bool: true },
    { key: 'thinning', label: 'Edges thin when stretched', bool: true },
    { key: 'showNodes', label: 'Show nodes', bool: true },
    { key: 'trails', label: 'Motion trails', bool: false },
  ];

  // Tag every parameter with the panel it lives in.
  {
    let panel = 'sound';
    for (const d of PARAM_DEFS) {
      if (d.section && d.panel) panel = d.panel;
      d.panelName = panel;
    }
  }

  const params = {};   // key -> number | boolean | string
  const enabled = {};  // key -> boolean (only for toggleable sliders)

  // Reset every parameter, or just those of one panel ('sound' / 'physics').
  const loadDefaults = (panel) => N.loadDefaults(PARAM_DEFS, params, enabled, panel ? (d) => d.panelName === panel : null);
  const saveSettings = () => N.saveJSON(STORAGE_KEY, { params, enabled });

  function loadSettings() {
    const saved = N.loadJSON(STORAGE_KEY);
    if (saved) N.restoreParams(PARAM_DEFS, params, saved.params, enabled, saved.enabled);
  }

  // Derived physics values
  const on = (k) => enabled[k] !== false;
  const springK = () => (on('stiffness') ? params.stiffness : 0);
  const springDamp = () => 0.05 + (1 - params.wobble / 100) * 8;
  const airDamp = () => 1 - (params.friction / 100) * 0.02;

  // ---------- state ----------

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');

  let width = 0, height = 0, dpr = 1;
  let radius = 0;
  let nodes = [];
  let edges = [];
  let stepAccumulator = 0;

  const pointer = {
    x: 0, y: 0,
    down: false,
    attract: false,
    mode: null,      // 'node' | 'edge' | 'field'
    node: null,
    edge: null,
    t: 0,
    history: [],     // recent positions, used to fling a released node
  };

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

      audio.pluck = N.audio.createPluck(ac, { output: audio.bus, lfo: audio.lfoGain, maxVoices: 40 });
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

  // Node i sits i steps round the circle of fifths from the root.
  function nodeSemitone(i) {
    const s = i * 7;
    if (params.layout === 'compact') return s % 12;
    if (params.layout === 'stacked') return s;
    return s % 24;
  }

  function nodeFreq(i) {
    const midi = 12 * (params.octave + 1) + parseInt(params.root, 10) + nodeSemitone(i);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function nodeName(i) {
    return NOTE_NAMES[(parseInt(params.root, 10) + i * 7) % 12];
  }

  function playFreq(freq, velocity, when) {
    audio.pluck.play(freq, 0.16 * velocity, when, {
      wave: params.wave, attack: params.attack / 1000, decay: params.decay,
      detune: params.detune, shimmer: params.shimmer / 100,
    });
  }

  const CHORDS = {
    none: [0], fifth: [0, 7], major: [0, 4, 7], minor: [0, 3, 7], sus2: [0, 2, 7],
    sus4: [0, 5, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], add9: [0, 4, 7, 14],
  };

  // Returns [{freq, node}] for a chord built on node i.
  function chordNotes(i, type) {
    const base = nodeFreq(i);
    if (type === 'neighbors') {
      const n = nodes.length;
      const out = [{ freq: base, node: i }];
      if (n > 1) out.push({ freq: nodeFreq((i + 1) % n), node: (i + 1) % n });
      if (n > 2) out.push({ freq: nodeFreq((i + n - 1) % n), node: (i + n - 1) % n });
      return out;
    }
    return (CHORDS[type] || CHORDS.none).map((iv) => ({ freq: base * Math.pow(2, iv / 12), node: iv === 0 ? i : -1 }));
  }

  function glow(i, amount) {
    if (nodes[i]) nodes[i].glow = Math.max(nodes[i].glow, amount);
  }

  // Play node i. opts: { velocity, chord, when, force, freqScale }
  function triggerNode(i, opts) {
    opts = opts || {};
    if (!params.soundOn || !nodes[i]) return;
    const n = nodes[i];
    const now = performance.now();
    if (!opts.force && now - n.lastPlay < params.cooldown) return;
    // Audio only exists after a user gesture has created it.
    if (!audio.ctx) return;
    n.lastPlay = now;
    ensureAudio();
    const velocity = Math.max(0.05, Math.min(1, opts.velocity == null ? 0.8 : opts.velocity));
    const type = opts.chord == null ? params.chord : opts.chord;
    const notes = chordNotes(i, type);
    const t0 = opts.when || audio.ctx.currentTime;
    const scale = opts.freqScale || 1;
    notes.forEach((note, k) => {
      playFreq(note.freq * scale, k === 0 ? velocity : velocity * 0.75, t0 + (k * params.strum) / 1000);
      if (note.node >= 0) glow(note.node, k === 0 ? velocity : velocity * 0.7);
    });
  }

  function strumAll() {
    if (!params.soundOn || !ensureAudio()) return;
    const order = nodes.map((_, i) => i).sort((a, b) => nodeFreq(a) - nodeFreq(b));
    const t0 = audio.ctx.currentTime;
    order.forEach((i, k) => {
      setTimeout(() => glow(i, 0.9), k * 110);
      playFreq(nodeFreq(i), 0.6, t0 + k * 0.11);
    });
  }

  // ---------- melody ----------

  const melody = { nextTime: 0, step: 0, index: 0, dir: 1 };

  function nextMelodyNode() {
    const n = nodes.length;
    let i = melody.index;
    switch (params.pattern) {
      case 'circle': i = (i + 1) % n; break;
      case 'star': i = (i + Math.max(1, Math.floor((n - 1) / 2))) % n; break;
      case 'random': i = Math.floor(Math.random() * n); break;
      case 'updown': {
        const order = nodes.map((_, k) => k).sort((a, b) => nodeFreq(a) - nodeFreq(b));
        let pos = order.indexOf(i) + melody.dir;
        if (pos >= n || pos < 0) { melody.dir *= -1; pos = order.indexOf(i) + melody.dir; }
        i = order[Math.max(0, Math.min(n - 1, pos))];
        break;
      }
      default: { // random walk to a near neighbour on the circle of fifths
        const steps = [-2, -1, -1, 1, 1, 2];
        i = (i + steps[Math.floor(Math.random() * steps.length)] + n * 2) % n;
      }
    }
    melody.index = i;
    return i;
  }

  function kickNode(i) {
    if (!on('kick') || params.kick <= 0) return;
    const n = nodes[i];
    if (!n || isPinned(n)) return;
    let cx = 0, cy = 0;
    for (const m of nodes) { cx += m.x; cy += m.y; }
    cx /= nodes.length; cy /= nodes.length;
    const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
    n.px -= (dx / d) * params.kick;
    n.py -= (dy / d) * params.kick;
  }

  function scheduleMelody() {
    if (!params.melody || !params.soundOn || !audio.ctx || params.paused) {
      melody.nextTime = 0;
      return;
    }
    const ac = audio.ctx;
    const stepDur = 60 / params.bpm / params.division;
    if (melody.nextTime < ac.currentTime) { melody.nextTime = ac.currentTime + 0.05; melody.step = 0; }
    while (melody.nextTime < ac.currentTime + 0.1) {
      const when = melody.nextTime;
      const delayMs = Math.max(0, (when - ac.currentTime) * 1000);
      const barStart = melody.step % (params.division * 4) === 0;
      if (barStart && params.downbeat !== 'none') {
        const root = melody.index;
        const chord = params.downbeat === 'chord' ? (params.chord === 'none' ? 'major' : params.chord) : 'none';
        triggerNode(root, { velocity: 0.55, chord, when, force: true, freqScale: 0.5 });
      }
      if (barStart || Math.random() >= params.rest / 100) {
        const i = nextMelodyNode();
        const accent = melody.step % params.division === 0 ? 0.75 : 0.55;
        triggerNode(i, { velocity: accent, chord: 'none', when, force: true });
        setTimeout(() => kickNode(i), delayMs);
      }
      melody.step++;
      melody.nextTime += stepDur;
    }
  }

  // ---------- setup ----------

  function count() { return params.nodeCount; }

  function computeRadius() {
    radius = Math.max(60, Math.min(width, height) * (params.size / 100));
  }

  function layoutPositions() {
    const cx = width / 2, cy = height / 2, n = count();
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      out.push({ x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius });
    }
    return out;
  }

  function computeRestLengths() {
    // Rest length of each edge is its chord length on the circle, so the
    // relaxed shape is always the regular polygon + star.
    const n = count();
    for (const e of edges) {
      const steps = Math.min(Math.abs(e.a - e.b), n - Math.abs(e.a - e.b));
      e.rest = 2 * radius * Math.sin((Math.PI * steps) / n);
      e.ring = steps; // 1 = outer polygon, larger = inner chords
    }
  }

  function minDist() {
    return 2 * radius * Math.sin(Math.PI / count()) * params.spacing;
  }

  function build() {
    const pos = layoutPositions();
    nodes = pos.map((p) => ({ x: p.x, y: p.y, px: p.x, py: p.y, fx: 0, fy: 0, glow: 0, lastPlay: 0, fast: false }));
    edges = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) edges.push({ a: i, b: j, rest: 0, ring: 0 });
    }
    computeRestLengths();
    melody.index %= nodes.length;
    pointer.down = false;
    pointer.mode = null;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const oldW = width, oldH = height;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeRadius();

    if (!nodes.length) {
      build();
    } else {
      // Shift existing nodes so the graph stays centred, then let springs adapt.
      const dx = (width - oldW) / 2, dy = (height - oldH) / 2;
      for (const n of nodes) { n.x += dx; n.y += dy; n.px += dx; n.py += dy; }
      computeRestLengths();
    }
  }

  // ---------- physics ----------

  function closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax, aby = by - ay;
    const len2 = abx * abx + aby * aby || 1;
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    const x = ax + abx * t, y = ay + aby * t;
    return { t, x, y, d: Math.hypot(px - x, py - y) };
  }

  function isPinned(n) {
    return pointer.down && pointer.mode === 'node' && pointer.node === n;
  }

  function applyForces() {
    for (const n of nodes) { n.fx = 0; n.fy = 0; }

    // Edge springs with damping along the edge direction.
    const k = springK(), damp = springDamp();
    if (k > 0) {
      for (const e of edges) {
        const a = nodes[e.a], b = nodes[e.b];
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        dx /= d; dy /= d;
        const rvx = (b.x - b.px) - (a.x - a.px);
        const rvy = (b.y - b.py) - (a.y - a.py);
        const relVel = (rvx * dx + rvy * dy) / DT;
        const soft = params.uniform ? 1 : e.ring;
        const f = (k * (d - e.rest)) / soft + damp * relVel;
        a.fx += dx * f; a.fy += dy * f;
        b.fx -= dx * f; b.fy -= dy * f;
      }
    }

    // Personal-space repulsion between every pair of nodes.
    if (on('spacing') && params.repel > 0) {
      const md = minDist() * 1.6;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.0001) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = 0.0001; }
          if (d < md) {
            const overlap = (md - d) / (md / 1.6);
            const f = params.repel * overlap * overlap;
            a.fx -= (dx / d) * f; a.fy -= (dy / d) * f;
            b.fx += (dx / d) * f; b.fy += (dy / d) * f;
          }
        }
      }
    }

    // Gentle drift back toward the centre of the screen.
    if (on('centering') && params.centering > 0) {
      let cx = 0, cy = 0;
      for (const n of nodes) { cx += n.x; cy += n.y; }
      cx /= nodes.length; cy /= nodes.length;
      const gx = (width / 2 - cx) * params.centering, gy = (height / 2 - cy) * params.centering;
      for (const n of nodes) { n.fx += gx; n.fy += gy; }
    }

    if (on('gravity')) for (const n of nodes) n.fy += params.gravity;

    // Pointer interaction.
    if (pointer.down) {
      if (pointer.mode === 'edge') {
        const e = pointer.edge, a = nodes[e.a], b = nodes[e.b], t = pointer.t;
        const gxp = a.x + (b.x - a.x) * t, gyp = a.y + (b.y - a.y) * t;
        const fx = (pointer.x - gxp) * params.grab, fy = (pointer.y - gyp) * params.grab;
        a.fx += fx * (1 - t); a.fy += fy * (1 - t);
        b.fx += fx * t; b.fy += fy * t;
      } else if (pointer.mode === 'field' && on('fieldRadius')) {
        const sign = pointer.attract ? -1 : 1, R = params.fieldRadius;
        for (const n of nodes) {
          const dx = n.x - pointer.x, dy = n.y - pointer.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          if (d < R) {
            const s = 1 - d / R;
            const f = sign * params.fieldStrength * s * s;
            n.fx += (dx / d) * f; n.fy += (dy / d) * f;
          }
        }
      }
    }
  }

  function integrate() {
    const keep = airDamp();
    for (const n of nodes) {
      if (isPinned(n)) continue;
      const vx = (n.x - n.px) * keep;
      const vy = (n.y - n.py) * keep;
      n.px = n.x; n.py = n.y;
      n.x += vx + n.fx * DT * DT;
      n.y += vy + n.fy * DT * DT;
    }
  }

  // Hard constraints: edges may not over-stretch or collapse; nodes stay on screen.
  function constrain() {
    const useMax = on('maxStretch'), useMin = on('minSquash');
    if (useMax || useMin) {
      for (let iter = 0; iter < 3; iter++) {
        for (const e of edges) {
          const a = nodes[e.a], b = nodes[e.b];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d = Math.hypot(dx, dy) || 0.0001;
          let target;
          if (useMax && d > e.rest * params.maxStretch) target = e.rest * params.maxStretch;
          else if (useMin && d < e.rest * params.minSquash) target = e.rest * params.minSquash;
          else continue;
          const diff = (d - target) / d;
          const pa = isPinned(a), pb = isPinned(b);
          const wa = pa ? 0 : pb ? 1 : 0.5;
          const wb = pb ? 0 : pa ? 1 : 0.5;
          a.x += dx * diff * wa; a.y += dy * diff * wa;
          b.x -= dx * diff * wb; b.y -= dy * diff * wb;
        }
      }
    }

    if (on('bounce')) {
      const r = params.nodeRadius, e = params.bounce;
      nodes.forEach((n, i) => {
        let impact = 0;
        if (n.x < r) { const v = n.x - n.px; n.x = r; n.px = n.x + v * e; impact = Math.max(impact, Math.abs(v)); }
        if (n.x > width - r) { const v = n.x - n.px; n.x = width - r; n.px = n.x + v * e; impact = Math.max(impact, Math.abs(v)); }
        if (n.y < r) { const v = n.y - n.py; n.y = r; n.py = n.y + v * e; impact = Math.max(impact, Math.abs(v)); }
        if (n.y > height - r) { const v = n.y - n.py; n.y = height - r; n.py = n.y + v * e; impact = Math.max(impact, Math.abs(v)); }
        const speed = impact / DT;
        if (params.playOnWall && speed > 250) triggerNode(i, { velocity: speed / 2000 });
      });
    }
  }

  function substep() {
    if (pointer.down && pointer.mode === 'node') {
      const n = pointer.node;
      n.px = n.x; n.py = n.y;
      n.x += (pointer.x - n.x) * 0.5;
      n.y += (pointer.y - n.y) * 0.5;
    }
    applyForces();
    integrate();
    constrain();
  }

  // Play a node when its speed crosses the threshold (with hysteresis).
  function detectMovement() {
    if (!on('moveThreshold')) return;
    const th = params.moveThreshold;
    nodes.forEach((n, i) => {
      if (isPinned(n)) { n.fast = false; return; }
      const speed = Math.hypot(n.x - n.px, n.y - n.py) / DT;
      if (!n.fast && speed > th) {
        n.fast = true;
        triggerNode(i, { velocity: 0.35 + 0.4 * Math.min(1, speed / (th * 2)) });
      } else if (n.fast && speed < th * 0.6) {
        n.fast = false;
      }
    });
  }

  function step() {
    if (params.paused) {
      // Still let the user drag a node around while paused.
      if (pointer.down && pointer.mode === 'node') {
        const n = pointer.node;
        n.x = n.px = pointer.x; n.y = n.py = pointer.y;
      }
      return;
    }
    // Fixed timestep; speed changes how many substeps run per frame.
    stepAccumulator += SUBSTEPS * params.speed;
    let guard = 0;
    while (stepAccumulator >= 1 && guard++ < SUBSTEPS * 4) {
      substep();
      stepAccumulator -= 1;
    }
    detectMovement();
  }

  // ---------- rendering ----------

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  let colors = {};
  function readColors() {
    colors = { fg: cssVar('--fg'), muted: cssVar('--muted'), accent: cssVar('--accent'), bg: cssVar('--bg') };
  }

  // Edge strain to colour: compressed = cool, relaxed = neutral blue, stretched = warm red.
  function strainColor(strain, alpha) {
    const s = Math.max(-1, Math.min(1, strain * 1.8));
    let h, sat, light;
    if (s >= 0) { h = 220 - 220 * s; sat = 40 + 50 * s; light = 62 - 6 * s; }
    else { h = 220 - 30 * s; sat = 40 - 40 * s; light = 62; }
    return `hsla(${h}, ${sat}%, ${light}%, ${alpha})`;
  }

  // Each pitch class gets a hue, spaced round the circle of fifths.
  function noteHue(i) {
    return ((i * 7 * 30) % 360 + parseInt(params.root, 10) * 30) % 360;
  }

  function draw() {
    if (params.trails) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = colors.bg;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    } else {
      ctx.clearRect(0, 0, width, height);
    }

    // Field indicator
    if (pointer.down && pointer.mode === 'field' && on('fieldRadius')) {
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, params.fieldRadius, 0, Math.PI * 2);
      ctx.strokeStyle = pointer.attract ? 'rgba(120, 220, 160, 0.4)' : 'rgba(255, 140, 120, 0.4)';
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Edges (inner chords first so the outer polygon sits on top)
    const sorted = edges.slice().sort((p, q) => q.ring - p.ring);
    for (const e of sorted) {
      const a = nodes[e.a], b = nodes[e.b];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      const strain = (d - e.rest) / e.rest;
      const grabbed = pointer.down && pointer.mode === 'edge' && pointer.edge === e;
      const lit = Math.min(a.glow, b.glow);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      const base = (grabbed ? 4 : 2.2) + lit * 2;
      ctx.lineWidth = params.thinning ? base / Math.max(0.6, 1 + strain) : base;
      ctx.strokeStyle = grabbed ? colors.accent : params.strainColor ? strainColor(strain, 0.85) : colors.muted;
      ctx.stroke();
    }

    // Grab point on an edge
    if (pointer.down && pointer.mode === 'edge') {
      const e = pointer.edge, a = nodes[e.a], b = nodes[e.b];
      const x = a.x + (b.x - a.x) * pointer.t, y = a.y + (b.y - a.y) * pointer.t;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(pointer.x, pointer.y);
      ctx.strokeStyle = colors.accent;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = colors.accent;
      ctx.fill();
    }

    // Nodes
    let cx = 0, cy = 0;
    for (const n of nodes) { cx += n.x; cy += n.y; }
    cx /= nodes.length; cy /= nodes.length;
    const r = params.nodeRadius;

    nodes.forEach((n, i) => {
      const hue = noteHue(i);
      if (n.glow > 0.02) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 4 + 16 * (1 - n.glow), 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 80%, 62%, ${0.4 * n.glow})`;
        ctx.fill();
      }
      if (params.showNodes) {
        const active = isPinned(n);
        ctx.beginPath();
        ctx.arc(n.x, n.y, active ? r + 3 : r, 0, Math.PI * 2);
        ctx.fillStyle = colors.bg;
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.27);
        ctx.strokeStyle = active ? colors.accent : n.glow > 0.05 ? `hsl(${hue}, 75%, 60%)` : colors.fg;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(n.x, n.y, Math.max(1.5, r * 0.32), 0, Math.PI * 2);
        ctx.fillStyle = active ? colors.accent : `hsl(${hue}, 70%, 60%)`;
        ctx.fill();
      }
      if (params.showNotes) {
        const dx = n.x - cx, dy = n.y - cy, d = Math.hypot(dx, dy) || 1;
        const off = r + 14;
        ctx.font = '600 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = n.glow > 0.05 ? `hsl(${hue}, 75%, 62%)` : colors.muted;
        ctx.fillText(nodeName(i), n.x + (dx / d) * off, n.y + (dy / d) * off);
      }
      // Visual glow fades over (at most) 1.5 s.
      n.glow *= Math.pow(0.02, 1 / (60 * Math.min(1.5, params.decay)));
    });
  }

  // ---------- settings panels ----------

  let controls = null; // { sync } from nmlq.ui.buildParamPanel
  const AUDIO_KEYS = new Set(['soundOn', 'volume', 'brightness', 'reverb', 'echo', 'echoTime', 'echoFeedback', 'vibrato']);

  function onParamChanged(key) {
    if (key === 'nodeCount') build();
    else if (key === 'size') { computeRadius(); computeRestLengths(); }
    else if (AUDIO_KEYS.has(key)) applyAudioParams();
    else if (key === 'reverbSize' && audio.ctx) audio.space.setLengthSoon(params.reverbSize);
    if (key === 'melody' && params.melody) ensureAudio();
    saveSettings();
  }

  for (const btn of document.querySelectorAll('[data-collapse]')) {
    const setCollapsed = N.ui.collapsible(btn, document.getElementById(btn.dataset.collapse));
    if (window.innerWidth <= 640) setCollapsed(true);
  }

  for (const btn of document.querySelectorAll('[data-defaults]')) {
    btn.addEventListener('click', () => {
      const oldCount = params.nodeCount, oldSize = params.size, oldRev = params.reverbSize;
      loadDefaults(btn.dataset.defaults);
      controls.sync();
      if (params.nodeCount !== oldCount) build();
      else if (params.size !== oldSize) { computeRadius(); computeRestLengths(); }
      if (audio.ctx) {
        if (params.reverbSize !== oldRev) audio.space.setLength(params.reverbSize);
        applyAudioParams();
      }
      saveSettings();
    });
  }

  document.getElementById('strum').addEventListener('click', strumAll);

  // ---------- input ----------

  function pick(x, y) {
    let best = -1, bestD = Infinity;
    nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD <= params.nodeRadius + 10) return { mode: 'node', index: best };

    let bestE = null, bestT = 0; bestD = Infinity;
    for (const e of edges) {
      const a = nodes[e.a], b = nodes[e.b];
      const c = closestPointOnSegment(x, y, a.x, a.y, b.x, b.y);
      if (c.d < bestD) { bestD = c.d; bestE = e; bestT = c.t; }
    }
    if (bestD <= 9) return { mode: 'edge', edge: bestE, t: bestT };

    return { mode: 'field' };
  }

  function localPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  // Start audio on the first gesture (with the iOS workarounds).
  N.audio.installUnlock({ ensure: ensureAudio, current: () => audio.ctx, enabled: () => params.soundOn });

  canvas.addEventListener('contextmenu', (ev) => ev.preventDefault());

  canvas.addEventListener('pointerdown', (ev) => {
    canvas.setPointerCapture(ev.pointerId);
    const p = localPos(ev);
    pointer.x = p.x; pointer.y = p.y;
    pointer.down = true;
    pointer.attract = ev.shiftKey || ev.button === 2;
    pointer.history = [{ x: p.x, y: p.y, t: performance.now() }];
    const hit = pick(p.x, p.y);
    pointer.mode = hit.mode;
    pointer.node = hit.mode === 'node' ? nodes[hit.index] : null;
    pointer.edge = hit.edge || null;
    pointer.t = hit.t || 0;
    canvas.classList.add('dragging');

    if (params.playOnGrab) {
      if (hit.mode === 'node') {
        triggerNode(hit.index, { force: true });
      } else if (hit.mode === 'edge') {
        // An edge plays the interval between its two nodes.
        triggerNode(hit.edge.a, { force: true, chord: 'none', velocity: 0.7 });
        triggerNode(hit.edge.b, { force: true, chord: 'none', velocity: 0.7, when: audio.ctx ? audio.ctx.currentTime + params.strum / 1000 : 0 });
      }
    }
  });

  canvas.addEventListener('pointermove', (ev) => {
    const p = localPos(ev);
    pointer.x = p.x; pointer.y = p.y;
    if (pointer.down) {
      pointer.attract = ev.shiftKey || (ev.buttons & 2) !== 0;
      pointer.history.push({ x: p.x, y: p.y, t: performance.now() });
      if (pointer.history.length > 6) pointer.history.shift();
    }
  });

  function release() {
    if (!pointer.down) return;
    const n = pointer.node;
    if (pointer.mode === 'node' && n) {
      if (params.fling && pointer.history.length > 1) {
        // Fling a released node with the pointer's recent velocity.
        const h = pointer.history, first = h[0], last = h[h.length - 1];
        const dt = Math.max(1, last.t - first.t) / 1000;
        n.px = n.x - ((last.x - first.x) / dt) * DT;
        n.py = n.y - ((last.y - first.y) / dt) * DT;
      } else {
        n.px = n.x; n.py = n.y;
      }
      n.fast = true; // don't immediately retrigger from the fling itself
    }
    pointer.down = false;
    pointer.mode = null;
    pointer.node = null;
    pointer.edge = null;
    canvas.classList.remove('dragging');
  }

  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  window.addEventListener('keydown', (ev) => { if (ev.key === 'Shift') pointer.attract = true; });
  window.addEventListener('keyup', (ev) => { if (ev.key === 'Shift') pointer.attract = false; });

  document.getElementById('reset').addEventListener('click', () => {
    computeRadius();
    build();
  });

  document.getElementById('shake').addEventListener('click', () => {
    for (const n of nodes) {
      n.px = n.x - (Math.random() - 0.5) * 30;
      n.py = n.y - (Math.random() - 0.5) * 30;
    }
  });

  window.addEventListener('resize', resize);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

  // ---------- main loop ----------

  loadDefaults();
  loadSettings();
  controls = N.ui.buildParamPanel({
    defs: PARAM_DEFS, params, enabled,
    container: (section) => document.getElementById('controls-' + section.panelName),
    onChange: onParamChanged,
  });
  resize();
  readColors();

  function frame() {
    step();
    scheduleMelody();
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
