# Shared audio and synthesis concepts

Every app synthesises sound live with the Web Audio API. There are three
voice designs (tonal "pluck", drum hit, subtractive synth voice) but they
share the same building blocks, the same vocabulary, and mostly the same
master chain.

## Waveforms

Always the four native `OscillatorNode` types, in this order and with these
labels: **Sine, Triangle, Sawtooth, Square** (`sine`, `triangle`,
`sawtooth`, `square`), available as `N.WAVES`.

- Sine — pure; also used for octave shimmer and Synth's sub-oscillator.
- Triangle — soft; default tone for Graph and Fifths.
- Sawtooth — bright; Synth's default oscillator 1.
- Square — hollow; Synth's default oscillator 2.

White noise comes from a 2-second mono buffer of `Math.random() * 2 - 1`,
created once and played by looping `AudioBufferSource`s (Synth starts each
voice at a random offset).

## Pitch

- MIDI note → frequency: `440 * 2 ** ((m - 69) / 12)`; note 60 = C4.
- Octave numbering: `C<n>` = MIDI `12 * (n + 1)`.
- Note names: `['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B']`
  (Graph uses flats for E♭ A♭ B♭; Fifths picks sharps or flats per key).
- Circle of fifths: position `i` → pitch class `(i * 7) % 12`; inverse is
  also `(pc * 7) % 12`. Relative minor root = major root + 9.
- Detune / vibrato / bend are in **cents** on `oscillator.detune`.
- Synth drives pitch through a per-voice `ConstantSourceNode` holding
  `(note − 69) × 100` cents connected to every oscillator's `detune`. Glide
  (portamento) is then one `setTargetAtTime` on that value, and filter key
  tracking is that same signal through a gain into the filter's `detune`.

## Voice designs

**Tonal pluck (Graph, Fifths)** — `N.audio.createPluck(...).play(freq, peak, when, opts)`:
two oscillators of the chosen wave detuned by ±detune/2 cents (level 0.5
each) plus an optional sine an octave up (`shimmer/100 × 0.35`) → one gain
envelope: linear attack to `peak`, then exponential decay to 0.0001 over
`decay` seconds. No sustain: notes ring out. "Stop when released" (Fifths)
cuts the note with a short release from the envelope's current value.
Peak ≈ 0.13–0.16 × velocity. Voice cap 40–48, oldest stolen with a fast fade.

**Drum hit (Drummer)** — `hit(sound, when)`: one oscillator with a pitch
drop (starts `bend` semitones high, exponential ramp down over `bendTime`)
plus white noise, cross-faded by `noise` mix, each with its own decay
envelope → filter (LP/HP/BP, cutoff, Q) → optional drive (tanh waveshaper) →
optional stereo pan → master. All drums are presets of this one generator.

**Subtractive voice (Synth)** — osc 1 + osc 2 + sine sub (octave below osc
1) + noise → filter stage A → filter stage B → amp → bus. Filter types:
low-pass 12 dB, low-pass 24 dB (stage B also low-pass), high-pass,
band-pass, notch (stage B is an all-pass otherwise). Separate ADSR for
filter (in cents on `filter.detune`, ±5 octaves at ±100%) and amp
(peak 0.2). Mono (last-note priority, legato or retrigger, glide legato-only
or always) and poly (1–16 voices, steal released voices first, then the
oldest).

## Envelopes

- Attack is always a **linear** ramp; decay/release are exponential.
- Graph/Fifths/Drummer: `exponentialRampToValueAtTime(0.0001, end)`.
- Synth ADSR: `setTargetAtTime(target, start, time / 5)`, so the stated time
  is roughly when the stage is finished (≈ −43 dB); voices are freed after
  `release × 1.3`.
- Releases and retriggers must start from the envelope's **current** value.
  Firefox lacks `cancelAndHoldAtTime`, so compute the value analytically
  (`N.pluckValue` / `N.adsrValue` in `shared/core.js`), then `cancelScheduledValues(now)`,
  `setValueAtTime(level, now)`, and schedule the new stage.
- Don't schedule `osc.stop()` for notes that can be retriggered (Synth mono);
  free them with a timer that is cleared on retrigger.

## Filters

- `BiquadFilterNode`. Graph/Fifths: one global low-pass, "Brightness"
  0–100% → `250 × 64^(b/100)` Hz (250 Hz – 16 kHz), Q 0.6.
- Drummer/Synth: per-voice filter with cutoff on a log knob (20/30 Hz –
  18/20 kHz).
- Q gotcha: for low-pass and high-pass, Web Audio's `Q` is in **dB**; for
  band-pass and notch it is a unitless bandwidth Q. Synth maps resonance
  0–100% to −1…20 dB (LP/HP) or 0.5…~20 (BP/notch).
- Clamp cutoff and oscillator frequencies below `sampleRate / 2 − 100`.

## Modulation

- One global LFO `OscillatorNode` (~5.2 Hz in Graph/Fifths, 0.1–20 Hz in
  Synth) through gain nodes: vibrato → every oscillator's `detune` (cents),
  filter wobble → filter `detune` (Synth, up to ±3 octaves), tremolo → a
  gain node whose base gain is `1 − depth/2` with the LFO adding `± depth/2`.
- Synth mod wheel adds up to 60¢ of vibrato; pitch bend is a global
  `ConstantSourceNode` (± bend range semitones × 100 cents) into every
  oscillator's detune.
- Disconnect global modulators from a voice's params when the voice dies.

## Master chain

```
voices → bus → [filter (Graph/Fifths) | drive waveshaper (Synth)]
            ├→ dry ───────────────┐
            ├→ convolver → wet ───┤
            └→ delay ⟲ feedback   │
                 └→ echoWet ──────┼→ (also into convolver)
                                  └→ master → compressor → destination
```

- Reverb: `ConvolverNode` with a generated stereo impulse —
  `(random * 2 − 1) × (1 − i/len)^3` over `reverbSize` seconds; rebuild it
  debounced (200 ms) when the length changes. Mix: dry `1 − rev × 0.45`,
  wet `rev × 1.2`.
- Echo: `DelayNode(2)` with feedback gain; echo output also feeds the reverb.
  Wet `echo × 0.8`.
- Drive: `tanh(k·x)/tanh(k)` curve, `oversample = '2x'`; cache curves per
  amount (Drummer) or rebuild debounced (Synth).
- Compressor: threshold −16 dB (Graph/Fifths), −14 (Synth), −10 (Drummer);
  knee 6–12; ratio 4.
- Volume: `master.gain = volume/100 × 0.9` (Drummer: `(v/100)^1.5`).
- Parameter changes on live nodes use `setTargetAtTime(v, now, 0.02–0.05)`
  to avoid zipper noise.

## Scheduling

- Sequencers / auto-play use a look-ahead scheduler: a 25 ms
  `setInterval` (Drummer) or the rAF loop (Fifths) schedules events
  ~100 ms ahead on `audioContext.currentTime`. Visuals for scheduled notes
  use `setTimeout(delay)` to line up with when they are heard.

## Starting audio (all apps)

- Create the `AudioContext` lazily in `ensureAudio()` on the first gesture,
  and `resume()` it whenever its state isn't `'running'` (iOS also reports
  `'interrupted'`), and again on `visibilitychange`.
- iOS unlock (`N.audio.installUnlock` in `shared/audio.js`): set
  `navigator.audioSession.type = 'playback'` so the silent switch doesn't
  mute it, play a tiny silent `<audio playsinline>` WAV, and start a 1-sample
  buffer source. Register it in the capture phase for `pointerdown`,
  `touchstart`, `touchend`, `click` and `keydown`.
