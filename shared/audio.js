// nmlq shared audio: Web Audio building blocks used by every app.
// Requires shared/core.js. Adds `nmlq.audio`.
(function (root) {
  'use strict';

  const N = root.nmlq;
  if (!N) throw new Error('shared/core.js must be loaded before shared/audio.js');

  // ---------- context ----------

  function createContext() {
    const AC = root.AudioContext || root.webkitAudioContext;
    return AC ? new AC() : null;
  }

  // iOS can also report 'interrupted' (e.g. after a call or app switch).
  function resume(ac) {
    if (ac && ac.state !== 'running') ac.resume().catch(() => {});
    return ac;
  }

  // Set an AudioParam now (immediate) or glide to it (avoids zipper noise).
  function setParam(ac, param, value, immediate, tau) {
    if (immediate) param.setValueAtTime(value, ac.currentTime);
    else param.setTargetAtTime(value, ac.currentTime, tau == null ? 0.03 : tau);
  }

  function compressor(ac, o) {
    o = Object.assign({ threshold: -16, knee: 12, ratio: 4 }, o);
    const c = ac.createDynamicsCompressor();
    c.threshold.value = o.threshold;
    c.knee.value = o.knee;
    c.ratio.value = o.ratio;
    if (o.attack != null) c.attack.value = o.attack;
    if (o.release != null) c.release.value = o.release;
    return c;
  }

  // ---------- buffers ----------

  function noiseBuffer(ac, seconds) {
    const len = Math.floor(ac.sampleRate * (seconds || 2));
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    N.fillNoise(buf.getChannelData(0));
    return buf;
  }

  function impulseBuffer(ac, seconds) {
    const len = Math.max(1, Math.floor(ac.sampleRate * seconds));
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) N.fillImpulse(buf.getChannelData(ch));
    return buf;
  }

  // ---------- reverb + echo ----------
  //
  //   input ─┬→ dry ─────────────────┐
  //          ├→ convolver → wet ─────┼→ output
  //          └→ delay ⟲ feedback      │
  //               └→ echoWet ────────┤  (echo also feeds the reverb)
  function createSpace(ac, reverbSeconds) {
    const s = {
      input: ac.createGain(),
      output: ac.createGain(),
      dry: ac.createGain(),
      wet: ac.createGain(),
      convolver: ac.createConvolver(),
      delay: ac.createDelay(2),
      feedback: ac.createGain(),
      echoWet: ac.createGain(),
      timer: 0,
    };
    s.input.connect(s.dry).connect(s.output);
    s.input.connect(s.convolver).connect(s.wet).connect(s.output);
    s.input.connect(s.delay);
    s.delay.connect(s.feedback).connect(s.delay);
    s.delay.connect(s.echoWet).connect(s.output);
    s.echoWet.connect(s.convolver);

    s.setLength = (seconds) => { s.convolver.buffer = impulseBuffer(ac, seconds); };
    // Rebuilding the impulse is slow-ish, so wait until a slider settles.
    s.setLengthSoon = (seconds, ms) => {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => s.setLength(seconds), ms == null ? 200 : ms);
    };
    // reverb, echo and echoFeedback are 0..1, echoTime in seconds.
    s.set = (o, immediate) => {
      const set = (p, v) => setParam(ac, p, v, immediate, 0.05);
      set(s.dry.gain, 1 - o.reverb * 0.45);
      set(s.wet.gain, o.reverb * 1.2);
      set(s.echoWet.gain, o.echo * 0.8);
      set(s.delay.delayTime, o.echoTime);
      set(s.feedback.gain, o.echoFeedback);
    };
    s.setLength(reverbSeconds || 2.5);
    return s;
  }

  // ---------- ring-out notes (Graph, Fifths) ----------
  // Two detuned oscillators plus an optional sine an octave up, through a
  // linear-attack / exponential-decay envelope. `lfo` (a GainNode carrying
  // vibrato in cents) is connected to every oscillator's detune.
  function createPluck(ac, o) {
    const output = o.output, lfo = o.lfo, maxVoices = o.maxVoices || 48;
    const voices = [];

    // p: { wave, attack (s), decay (s), detune (cents), shimmer (0..1) }
    function play(freq, peak, when, p) {
      const t = Math.max(when || 0, ac.currentTime);
      const atk = p.attack, dec = p.decay, end = t + atk + dec;

      const env = ac.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(peak, t + atk);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      env.connect(output);

      const oscs = [];
      const addOsc = (type, f, detune, level) => {
        const osc = ac.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = detune;
        if (lfo) lfo.connect(osc.detune);
        const g = ac.createGain();
        g.gain.value = level;
        osc.connect(g).connect(env);
        osc.start(t);
        osc.stop(end + 0.05);
        oscs.push(osc);
      };
      addOsc(p.wave, freq, -p.detune / 2, 0.5);
      addOsc(p.wave, freq, p.detune / 2, 0.5);
      if (p.shimmer > 0) addOsc('sine', freq * 2, 0, p.shimmer * 0.35);

      const voice = { env, oscs, t, atk, dec, peak, end, released: false };
      oscs[0].onended = () => {
        env.disconnect();
        if (lfo) for (const osc of oscs) { try { lfo.disconnect(osc.detune); } catch (e) { /* not connected */ } }
        const idx = voices.indexOf(voice);
        if (idx >= 0) voices.splice(idx, 1);
      };
      voices.push(voice);
      // Voice stealing: fade the oldest quickly if too many are sounding.
      while (voices.length > maxVoices) release(voices.shift(), 0.12);
      return voice;
    }

    // Fade a note out over `seconds`, starting from wherever it is now.
    function release(v, seconds) {
      const now = ac.currentTime;
      if (v.released || now >= v.end) return;
      v.released = true;
      const g = v.env.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(N.pluckValue(v, now), now);
      g.setTargetAtTime(0, now, seconds / 4);
      for (const osc of v.oscs) { try { osc.stop(now + seconds); } catch (e) { /* already stopping */ } }
    }

    function stopAll(seconds) {
      for (const v of voices.slice()) release(v, seconds || 0.08);
    }

    return { play, release, stopAll, voices };
  }

  // ---------- ADSR scheduling (Synth) ----------
  // `e` records the stage so nmlq.adsrValue can tell the current level.

  function envStart(paramList, e, t, from, peak, sustain, a, d) {
    for (const p of paramList) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(from, t);
      p.linearRampToValueAtTime(peak, t + a);
      p.setTargetAtTime(sustain, t + a, d / 5);
    }
    Object.assign(e, { stage: 'on', t, from, peak, sustain, a, d });
  }

  function envRelease(paramList, e, now, r) {
    const level = N.adsrValue(e, now);
    for (const p of paramList) {
      p.cancelScheduledValues(now);
      p.setValueAtTime(level, now);
      p.setTargetAtTime(0, now, r / 5);
    }
    Object.assign(e, { stage: 'rel', t: now, level, r });
  }

  // ---------- subtractive synth voices (Synth, Memory) ----------
  // Each voice: osc 1 + osc 2 + sine sub (an octave below osc 1) + noise →
  // filter stage A → filter stage B → amp, with ADSR envelopes for the
  // filter (cents on filter.detune) and the amp. Pitch is a per-voice
  // ConstantSource holding (note − 69) × 100 cents on every oscillator's
  // detune (so glide is one setTargetAtTime on it, and key tracking is that
  // signal into the filters). One LFO adds vibrato, filter wobble and
  // tremolo; a global bend source adds cents to every voice.
  //
  //   voices → bus → tremolo (= output) → o.output
  //
  // o: { output?, params, onFree(v)? }. `params` is read live and holds the
  // keys of nmlq.synthVoiceGroups(). onFree is called when a voice is stolen
  // or freed, so a note engine can forget it. Needs ConstantSourceNode.
  const AMP_PEAK = 0.2;

  function createSynth(ac, o) {
    const P = o.params;
    const voices = [];
    const bus = ac.createGain();
    const output = ac.createGain(); // tremolo
    bus.connect(output);
    if (o.output) output.connect(o.output);

    const lfo = ac.createOscillator();
    const lfoPitch = ac.createGain();
    const lfoFilter = ac.createGain();
    const lfoTrem = ac.createGain();
    lfo.connect(lfoPitch);
    lfo.connect(lfoFilter);
    lfo.connect(lfoTrem).connect(output.gain);
    lfo.start();

    const bend = ac.createConstantSource();
    bend.offset.value = 0;
    bend.start();

    const noiseBuf = noiseBuffer(ac, 2);
    const cents = (note) => (note - 69) * 100;
    const freed = (v) => { if (o.onFree) o.onFree(v); };

    // extra: { vibrato (cents added, e.g. a mod wheel), bend (cents) }.
    function applyGlobal(immediate, extra) {
      extra = extra || {};
      const set = (p, v) => setParam(ac, p, v, immediate, 0.03);
      const trem = P.tremolo / 100;
      lfo.type = P.lfoWave;
      set(lfo.frequency, P.lfoRate);
      set(lfoPitch.gain, P.vibrato + (extra.vibrato || 0));
      set(lfoFilter.gain, (P.lfoFilter / 100) * 3 * 1200);
      set(output.gain, 1 - trem / 2);
      set(lfoTrem.gain, trem / 2);
      bend.offset.setTargetAtTime(extra.bend || 0, ac.currentTime, 0.01);
    }

    function voice(note, t, startCents) {
      t = t == null ? ac.currentTime : t;
      const v = { note, born: t, released: false, stolen: false, dead: false, timer: 0, ampEnv: {}, filtEnv: {} };
      v.pitch = ac.createConstantSource();
      v.pitch.offset.setValueAtTime(startCents == null ? cents(note) : startCents, t);
      v.o1 = ac.createOscillator();
      v.o2 = ac.createOscillator();
      v.sub = ac.createOscillator();
      v.sub.type = 'sine';
      v.noise = ac.createBufferSource();
      v.noise.buffer = noiseBuf;
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
      v.fA.connect(v.fB).connect(v.amp).connect(bus);

      v.oscs = [v.o1, v.o2, v.sub];
      for (const osc of v.oscs) {
        v.pitch.connect(osc.detune);
        bend.connect(osc.detune);
        lfoPitch.connect(osc.detune);
      }
      v.pitch.connect(v.kt);
      for (const f of [v.fA, v.fB]) {
        v.kt.connect(f.detune);
        lfoFilter.connect(f.detune);
      }

      configure(v, true);
      v.pitch.start(t);
      for (const osc of v.oscs) osc.start(t);
      v.noise.start(t, Math.random() * 1.9);
      voices.push(v);
      return v;
    }

    // Apply the oscillator / mixer / filter settings to a voice.
    function configure(v, immediate) {
      const t = ac.currentTime;
      const set = (p, val) => (immediate ? p.setValueAtTime(val, t) : p.setTargetAtTime(val, t, 0.02));
      v.o1.type = P.osc1Wave;
      v.o2.type = P.osc2Wave;
      set(v.o1.frequency, 440 * Math.pow(2, P.osc1Oct));
      set(v.sub.frequency, 220 * Math.pow(2, P.osc1Oct));
      set(v.o2.frequency, 440 * Math.pow(2, P.osc2Oct));
      set(v.o2.detune, P.osc2Semi * 100 + P.osc2Detune);
      set(v.g1.gain, (P.osc1Level / 100) * 0.5);
      set(v.g2.gain, (P.osc2Level / 100) * 0.5);
      set(v.gs.gain, (P.subLevel / 100) * 0.5);
      set(v.gn.gain, (P.noiseLevel / 100) * 0.35);
      const ft = P.filterType;
      const lp24 = ft === 'lowpass24';
      v.fA.type = lp24 ? 'lowpass' : ft;
      // The second stage only filters in 24 dB mode; otherwise it is an all-pass.
      v.fB.type = lp24 ? 'lowpass' : 'allpass';
      set(v.fA.frequency, P.cutoff);
      set(v.fB.frequency, P.cutoff);
      set(v.fA.Q, N.filterQ(ft, P.resonance));
      set(v.fB.Q, lp24 ? 0 : 0.7);
      set(v.kt.gain, P.keyTrack / 100);
    }

    const configureAll = () => { for (const v of voices) configure(v, false); };

    // Start both envelopes; fromCurrent retriggers from the current level.
    function trigger(v, t, fromCurrent) {
      t = t == null ? ac.currentTime : t;
      envStart([v.amp.gain], v.ampEnv, t, fromCurrent ? N.adsrValue(v.ampEnv, t) : 0,
        AMP_PEAK, AMP_PEAK * P.sustain / 100, P.attack / 1000, P.decay / 1000);
      const peak = (P.filterEnvAmt / 100) * 5 * 1200; // up to ±5 octaves
      envStart([v.fA.detune, v.fB.detune], v.filtEnv, t, fromCurrent ? N.adsrValue(v.filtEnv, t) : 0,
        peak, peak * P.fSustain / 100, P.fAttack / 1000, P.fDecay / 1000);
    }

    function release(v) {
      if (v.released || v.dead) return;
      v.released = true;
      const now = ac.currentTime;
      const r = P.release / 1000;
      envRelease([v.amp.gain], v.ampEnv, now, r);
      envRelease([v.fA.detune, v.fB.detune], v.filtEnv, now, P.fRelease / 1000);
      clearTimeout(v.timer);
      v.timer = setTimeout(() => kill(v), (r * 1.3 + 0.1) * 1000);
    }

    // Fast fade, used for voice stealing and "all off".
    function steal(v) {
      if (v.dead || v.stolen) return;
      v.stolen = v.released = true;
      envRelease([v.amp.gain], v.ampEnv, ac.currentTime, 0.02);
      clearTimeout(v.timer);
      v.timer = setTimeout(() => kill(v), 60);
      freed(v);
    }

    function kill(v) {
      if (v.dead) return;
      v.dead = true;
      clearTimeout(v.timer);
      for (const s of [v.pitch, v.noise, ...v.oscs]) { try { s.stop(); } catch (e) { /* not started */ } }
      for (const osc of v.oscs) {
        try { bend.disconnect(osc.detune); } catch (e) { /* ignore */ }
        try { lfoPitch.disconnect(osc.detune); } catch (e) { /* ignore */ }
      }
      for (const f of [v.fA, v.fB]) { try { lfoFilter.disconnect(f.detune); } catch (e) { /* ignore */ } }
      v.amp.disconnect();
      const i = voices.indexOf(v);
      if (i >= 0) voices.splice(i, 1);
      freed(v);
    }

    // Steal voices so a new one fits within `max`: released ones first, then
    // the oldest.
    function makeRoom(max) {
      const live = voices.filter((v) => !v.stolen && !v.dead);
      const excess = live.length - max + 1;
      if (excess <= 0) return;
      live.sort((a, b) => (b.released - a.released) || (a.born - b.born));
      for (let i = 0; i < excess; i++) steal(live[i]);
    }

    // Start a note now (released after `seconds` if given); returns the voice.
    function play(note, seconds, max) {
      makeRoom(max || 16);
      const v = voice(note, ac.currentTime);
      trigger(v, ac.currentTime, false);
      if (seconds != null) v.timer = setTimeout(() => release(v), seconds * 1000);
      return v;
    }

    function stopAll() { for (const v of voices.slice()) steal(v); }

    applyGlobal(true);
    return {
      bus, output, voices, cents, applyGlobal, voice, configure, configureAll,
      trigger, release, steal, kill, makeRoom, play, stopAll,
    };
  }

  // ---------- starting audio ----------
  // Browsers only allow audio after a user gesture. On iPhone (Safari and
  // Chrome both use WebKit) Web Audio is also muted by the ring/silent switch
  // unless the page's audio session is "playback", and the context only
  // starts inside certain gestures (touchend / click), so listen to all of
  // them. o: { ensure() -> AudioContext|null, current() -> AudioContext|null,
  // enabled() -> bool (optional) }.
  function installUnlock(o) {
    let unlocked = false;
    let silentEl = null;

    function unlock() {
      if (o.enabled && !o.enabled()) return;
      // Safari 16.4+: ignore the silent switch.
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* ignore */ }
      const ac = o.ensure();
      if (!ac) return;
      if (!unlocked) {
        // Older iOS: playing an <audio> element switches the session to playback.
        try {
          if (!silentEl) {
            silentEl = document.createElement('audio');
            silentEl.setAttribute('playsinline', '');
            silentEl.src = URL.createObjectURL(new Blob([N.silentWav()], { type: 'audio/wav' }));
          }
          const p = silentEl.play();
          if (p && p.catch) p.catch(() => {});
        } catch (e) { /* ignore */ }
        // A one-sample buffer started inside the gesture fully unlocks the context.
        try {
          const src = ac.createBufferSource();
          src.buffer = ac.createBuffer(1, 1, ac.sampleRate);
          src.connect(ac.destination);
          src.start(0);
        } catch (e) { /* ignore */ }
      }
      if (ac.state === 'running') unlocked = true;
    }

    for (const type of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
      root.addEventListener(type, unlock, { capture: true, passive: true });
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume(o.current());
    });
    return unlock;
  }

  N.audio = {
    createContext, resume, setParam, compressor, noiseBuffer, impulseBuffer,
    createSpace, createPluck, createSynth, envStart, envRelease, installUnlock,
  };
})(typeof self !== 'undefined' ? self : this);
