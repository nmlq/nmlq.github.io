// Unit tests for shared/audio.js, run in Node against a small fake
// AudioContext that records connections and parameter automation.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// ---------- fake Web Audio ----------

class FakeParam {
  constructor(value) { this.value = value; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); this.value = v; return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['linear', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { this.events.push(['exp', v, t]); return this; }
  setTargetAtTime(v, t, tau) { this.events.push(['target', v, t, tau]); this.value = v; return this; }
  cancelScheduledValues(t) { this.events.push(['cancel', t]); return this; }
}

class FakeNode {
  constructor(ctx, kind, params) {
    this.ctx = ctx;
    this.kind = kind;
    this.outputs = [];
    for (const [k, v] of Object.entries(params || {})) this[k] = new FakeParam(v);
  }
  connect(dest) { this.outputs.push(dest); return dest; }
  disconnect(dest) {
    if (dest === undefined) { this.outputs = []; return; }
    const i = this.outputs.indexOf(dest);
    if (i < 0) throw new Error('not connected');
    this.outputs.splice(i, 1);
  }
}

class FakeSource extends FakeNode {
  start(t) { this.started = t; }
  stop(t) { this.stopped = t === undefined ? "now" : t; }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'running';
    this.destination = new FakeNode(this, 'destination');
    this.created = [];
  }
  track(n) { this.created.push(n); return n; }
  createGain() { return this.track(new FakeNode(this, 'gain', { gain: 1 })); }
  createDelay() { return this.track(new FakeNode(this, 'delay', { delayTime: 0 })); }
  createConvolver() { return this.track(new FakeNode(this, 'convolver')); }
  createDynamicsCompressor() {
    return this.track(new FakeNode(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 }));
  }
  createOscillator() { return this.track(new FakeSource(this, 'oscillator', { frequency: 440, detune: 0 })); }
  createBufferSource() { return this.track(new FakeSource(this, 'buffer-source')); }
  createConstantSource() { return this.track(new FakeSource(this, 'constant-source', { offset: 1 })); }
  createBiquadFilter() { return this.track(new FakeNode(this, 'biquad', { frequency: 350, Q: 1, detune: 0, gain: 0 })); }
  createBuffer(channels, length, sampleRate) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, getChannelData: (c) => data[c] };
  }
  resume() { this.resumed = true; this.state = 'running'; return Promise.resolve(); }
}

// ---------- load the library like a browser would ----------

globalThis.self = globalThis;
globalThis.nmlq = require('../shared/core.js');
require(path.join(__dirname, '..', 'shared', 'audio.js'));
const N = globalThis.nmlq;
const A = N.audio;

const reaches = (from, to, seen = new Set()) => {
  if (from === to) return true;
  if (seen.has(from) || !from.outputs) return false;
  seen.add(from);
  return from.outputs.some((n) => reaches(n, to, seen));
};

test('nmlq.audio exposes the shared building blocks', () => {
  for (const name of ['createContext', 'resume', 'setParam', 'compressor', 'noiseBuffer', 'impulseBuffer',
    'createSpace', 'createPluck', 'createSynth', 'envStart', 'envRelease', 'installUnlock']) {
    assert.equal(typeof A[name], 'function', name);
  }
});

test('createContext returns null without Web Audio, and uses it when present', () => {
  assert.equal(A.createContext(), null);
  globalThis.AudioContext = FakeContext;
  try {
    assert.ok(A.createContext() instanceof FakeContext);
  } finally {
    delete globalThis.AudioContext;
  }
});

test('resume only resumes a context that is not running', () => {
  const ac = new FakeContext();
  A.resume(ac);
  assert.equal(ac.resumed, undefined);
  ac.state = 'interrupted';
  A.resume(ac);
  assert.equal(ac.resumed, true);
  assert.equal(A.resume(null), null);
});

test('setParam jumps when immediate, glides otherwise', () => {
  const ac = new FakeContext();
  ac.currentTime = 2;
  const p = new FakeParam(0);
  A.setParam(ac, p, 1, true);
  A.setParam(ac, p, 0.5, false);
  A.setParam(ac, p, 0.25, false, 0.1);
  assert.deepEqual(p.events, [['set', 1, 2], ['target', 0.5, 2, 0.03], ['target', 0.25, 2, 0.1]]);
});

test('compressor applies defaults and overrides', () => {
  const ac = new FakeContext();
  const c = A.compressor(ac);
  assert.equal(c.threshold.value, -16);
  assert.equal(c.knee.value, 12);
  assert.equal(c.ratio.value, 4);
  const d = A.compressor(ac, { threshold: -10, knee: 6, attack: 0.003, release: 0.15 });
  assert.equal(d.threshold.value, -10);
  assert.equal(d.release.value, 0.15);
});

test('noise and impulse buffers have the right shape', () => {
  const ac = new FakeContext();
  const noise = A.noiseBuffer(ac, 2);
  assert.equal(noise.numberOfChannels, 1);
  assert.equal(noise.length, 16000);
  const imp = A.impulseBuffer(ac, 0.5);
  assert.equal(imp.numberOfChannels, 2);
  assert.equal(imp.length, 4000);
  assert.ok(Math.abs(imp.getChannelData(1)[3999]) < 1e-6);
  assert.equal(A.impulseBuffer(ac, 0).length, 1, 'never an empty buffer');
});

test('createSpace wires dry, reverb and echo paths to the output', () => {
  const ac = new FakeContext();
  const s = A.createSpace(ac, 1.5);
  assert.equal(s.convolver.buffer.length, 12000);
  assert.ok(s.input.outputs.includes(s.dry));
  assert.ok(s.input.outputs.includes(s.convolver));
  assert.ok(s.input.outputs.includes(s.delay));
  assert.ok(s.delay.outputs.includes(s.feedback) && s.feedback.outputs.includes(s.delay), 'echo feedback loop');
  assert.ok(s.echoWet.outputs.includes(s.convolver), 'echo feeds the reverb');
  for (const n of [s.dry, s.wet, s.echoWet]) assert.ok(reaches(n, s.output));
});

test('createSpace.set uses the shared mix formulas', () => {
  const ac = new FakeContext();
  const s = A.createSpace(ac, 1);
  s.set({ reverb: 0.5, echo: 0.25, echoTime: 0.375, echoFeedback: 0.35 }, true);
  assert.equal(s.dry.gain.value, 1 - 0.5 * 0.45);
  assert.equal(s.wet.gain.value, 0.6);
  assert.equal(s.echoWet.gain.value, 0.2);
  assert.equal(s.delay.delayTime.value, 0.375);
  assert.equal(s.feedback.gain.value, 0.35);
  s.set({ reverb: 0, echo: 0, echoTime: 0.1, echoFeedback: 0 }, false);
  assert.equal(s.wet.gain.events.at(-1)[0], 'target', 'non-immediate changes glide');
});

test('createSpace.setLengthSoon debounces impulse rebuilds', async () => {
  const ac = new FakeContext();
  const s = A.createSpace(ac, 1);
  const first = s.convolver.buffer;
  s.setLengthSoon(2, 5);
  s.setLengthSoon(3, 5);
  assert.equal(s.convolver.buffer, first);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.convolver.buffer.length, 24000);
});

test('createPluck plays two detuned oscillators plus shimmer through an envelope', () => {
  const ac = new FakeContext();
  const out = ac.createGain(), lfo = ac.createGain();
  const pluck = A.createPluck(ac, { output: out, lfo, maxVoices: 8 });
  ac.currentTime = 1;
  const v = pluck.play(220, 0.16, 0, { wave: 'triangle', attack: 0.012, decay: 4, detune: 8, shimmer: 0.2 });
  assert.equal(v.oscs.length, 3);
  assert.deepEqual(v.oscs.map((o) => o.type), ['triangle', 'triangle', 'sine']);
  assert.deepEqual(v.oscs.map((o) => o.detune.value), [-4, 4, 0]);
  assert.equal(v.oscs[2].frequency.value, 440);
  for (const o of v.oscs) assert.ok(lfo.outputs.includes(o.detune), 'vibrato reaches every oscillator');
  assert.ok(v.env.outputs.includes(out));
  const [set, lin, exp] = v.env.gain.events;
  assert.deepEqual(set, ['set', 0, 1]);
  assert.deepEqual(lin, ['linear', 0.16, 1.012]);
  assert.deepEqual(exp.slice(0, 2), ['exp', 0.0001]);
  assert.ok(Math.abs(exp[2] - 5.012) < 1e-9, 'decay ends at start + attack + decay');
  assert.equal(v.oscs[0].started, 1);
  assert.ok(Math.abs(v.oscs[0].stopped - 5.062) < 1e-9);

  const plain = pluck.play(220, 0.1, 0, { wave: 'sine', attack: 0.01, decay: 1, detune: 0, shimmer: 0 });
  assert.equal(plain.oscs.length, 2, 'no shimmer oscillator at 0');
});

test('createPluck frees a voice and its LFO connections when it ends', () => {
  const ac = new FakeContext();
  const lfo = ac.createGain();
  const pluck = A.createPluck(ac, { output: ac.createGain(), lfo });
  const v = pluck.play(220, 0.1, 0, { wave: 'sine', attack: 0.01, decay: 1, detune: 0, shimmer: 0 });
  assert.equal(pluck.voices.length, 1);
  v.oscs[0].onended();
  assert.equal(pluck.voices.length, 0);
  assert.equal(lfo.outputs.length, 0);
});

test('createPluck steals the oldest voice beyond maxVoices', () => {
  const ac = new FakeContext();
  const pluck = A.createPluck(ac, { output: ac.createGain(), maxVoices: 3 });
  const p = { wave: 'sine', attack: 0.01, decay: 2, detune: 0, shimmer: 0 };
  const first = pluck.play(100, 0.1, 0, p);
  for (let i = 0; i < 3; i++) pluck.play(200 + i, 0.1, 0, p);
  assert.equal(pluck.voices.length, 3);
  assert.ok(!pluck.voices.includes(first));
  assert.equal(first.released, true);
});

test('pluck release fades from the current envelope level', () => {
  const ac = new FakeContext();
  const pluck = A.createPluck(ac, { output: ac.createGain() });
  const v = pluck.play(220, 0.2, 0, { wave: 'sine', attack: 0.1, decay: 2, detune: 0, shimmer: 0 });
  ac.currentTime = 0.05;
  pluck.release(v, 0.3);
  const ev = v.env.gain.events;
  assert.deepEqual(ev.at(-3), ['cancel', 0.05]);
  assert.equal(ev.at(-2)[0], 'set');
  assert.ok(Math.abs(ev.at(-2)[1] - 0.1) < 1e-9, 'halfway through the attack');
  assert.deepEqual(ev.at(-1), ['target', 0, 0.05, 0.075]);
  const n = ev.length;
  pluck.release(v, 0.3);
  assert.equal(ev.length, n, 'releasing twice is a no-op');
});

test('pluck stopAll releases every sounding voice', () => {
  const ac = new FakeContext();
  const pluck = A.createPluck(ac, { output: ac.createGain() });
  const p = { wave: 'sine', attack: 0.01, decay: 2, detune: 0, shimmer: 0 };
  const vs = [pluck.play(100, 0.1, 0, p), pluck.play(200, 0.1, 0, p)];
  pluck.stopAll();
  assert.ok(vs.every((v) => v.released));
});

test('envStart / envRelease schedule curves that match nmlq.adsrValue', () => {
  const a = new FakeParam(0), b = new FakeParam(0);
  const e = {};
  A.envStart([a, b], e, 1, 0, 0.2, 0.1, 0.05, 0.5);
  assert.deepEqual(a.events, [['cancel', 1], ['set', 0, 1], ['linear', 0.2, 1.05], ['target', 0.1, 1.05, 0.1]]);
  assert.deepEqual(b.events, a.events, 'every param in the list gets the same curve');
  assert.equal(e.stage, 'on');

  const expected = N.adsrValue(e, 2);
  A.envRelease([a], e, 2, 0.4);
  assert.deepEqual(a.events.slice(-3), [['cancel', 2], ['set', expected, 2], ['target', 0, 2, 0.08]]);
  assert.equal(e.stage, 'rel');
  assert.equal(e.level, expected);
});

// ---------- shared subtractive synth voice ----------

const synthParams = (over) => {
  const p = {};
  N.loadDefaults(N.synthVoiceGroups().flatMap((g) => g.params), p);
  return Object.assign(p, over);
};

test('createSynth: voice wiring, pitch in cents, settings applied', () => {
  const ac = new FakeContext();
  const out = ac.createGain();
  const params = synthParams({ osc1Oct: 1, osc2Semi: 7, osc2Detune: 5, filterType: 'lowpass24' });
  const s = A.createSynth(ac, { output: out, params });
  assert.ok(reaches(s.output, out));
  const v = s.voice(72, 0);
  assert.equal(s.voices.length, 1);
  assert.equal(v.pitch.offset.value, 300, 'C5 is 3 semitones above A4');
  assert.ok(reaches(v.o1, out) && reaches(v.o2, out) && reaches(v.sub, out) && reaches(v.noise, out));
  for (const o of v.oscs) assert.ok(v.pitch.outputs.includes(o.detune), 'pitch drives every oscillator');
  assert.equal(v.o1.type, 'sawtooth');
  assert.equal(v.o1.frequency.value, 880);
  assert.equal(v.sub.frequency.value, 440, 'sub is an octave below osc 1');
  assert.equal(v.o2.detune.value, 705);
  assert.equal([v.fA.type, v.fB.type].join(), 'lowpass,lowpass', '24 dB uses both stages');
  assert.equal(v.fA.frequency.value, params.cutoff);

  params.filterType = 'highpass';
  params.osc1Wave = 'square';
  s.configureAll();
  assert.equal([v.fA.type, v.fB.type].join(), 'highpass,allpass');
  assert.equal(v.o1.type, 'square');
  assert.equal(s.voice(60, 0, -1000).pitch.offset.value, -1000, 'a glide can start elsewhere');
});

test('createSynth: trigger / release follow the ADSR settings; kill frees everything', () => {
  const ac = new FakeContext();
  const freed = [];
  const params = synthParams({ attack: 10, decay: 200, sustain: 50, release: 100, filterEnvAmt: 50 });
  const s = A.createSynth(ac, { output: ac.createGain(), params, onFree: (v) => freed.push(v) });
  const v = s.voice(69, 0);
  s.trigger(v, 0, false);
  assert.deepEqual(v.ampEnv, { stage: 'on', t: 0, from: 0, peak: 0.2, sustain: 0.1, a: 0.01, d: 0.2 });
  assert.equal(v.filtEnv.peak, 0.5 * 5 * 1200);
  ac.currentTime = 1;
  s.release(v);
  assert.equal(v.released, true);
  assert.equal(v.ampEnv.stage, 'rel');
  assert.equal(v.ampEnv.r, 0.1);
  s.kill(v);
  assert.equal(v.dead, true);
  assert.deepEqual(s.voices, []);
  assert.deepEqual(freed, [v]);
  assert.deepEqual(v.amp.outputs, []);
  for (const o of v.oscs) assert.ok(o.stopped !== undefined, 'oscillators stopped');
});

test('createSynth: makeRoom steals released voices first, then the oldest; play and stopAll', () => {
  const ac = new FakeContext();
  const s = A.createSynth(ac, { output: ac.createGain(), params: synthParams() });
  const a = s.voice(60, 0), b = s.voice(62, 1), c = s.voice(64, 2);
  s.release(b);
  s.makeRoom(3);
  assert.deepEqual([a.stolen, b.stolen, c.stolen], [false, true, false], 'released voice goes first');
  s.makeRoom(2);
  assert.deepEqual([a.stolen, c.stolen], [true, false], 'then the oldest');
  const p = s.play(67, 0.5, 8);
  assert.equal(p.ampEnv.stage, 'on', 'play triggers the envelopes');
  s.stopAll();
  assert.ok(s.voices.every((v) => v.stolen));
  for (const v of s.voices.slice()) s.kill(v);
});

test('createSynth.applyGlobal sets LFO, tremolo and extra vibrato / bend', () => {
  const ac = new FakeContext();
  const params = synthParams({ lfoWave: 'triangle', lfoRate: 3, vibrato: 10, tremolo: 40, lfoFilter: 50 });
  const s = A.createSynth(ac, { params });
  s.applyGlobal(true, { vibrato: 30, bend: 200 });
  const lfo = ac.created.find((n) => n.kind === 'oscillator');
  assert.equal(lfo.type, 'triangle');
  assert.equal(lfo.frequency.value, 3);
  assert.equal(s.output.gain.value, 0.8, 'tremolo base gain is 1 − depth/2');
  const bend = ac.created.find((n) => n.kind === 'constant-source');
  assert.equal(bend.offset.value, 200);
  const gains = lfo.outputs.map((g) => g.gain.value);
  assert.deepEqual(gains, [40, 1800, 0.2], 'vibrato + extra (cents), filter (cents), tremolo depth');
});
