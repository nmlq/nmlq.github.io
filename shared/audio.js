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
    createSpace, createPluck, envStart, envRelease, installUnlock,
  };
})(typeof self !== 'undefined' ? self : this);
