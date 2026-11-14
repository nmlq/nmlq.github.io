# Parameters

## The definition pattern

Every app describes its settings as data and builds the UI from it.

**Panel style (Graph, Fifths)** — a flat `PARAM_DEFS` array:

```js
{ section: 'Sound' }                                    // group heading (Graph: + panel: 'sound')
{ key: 'soundOn', label: 'Sound on', bool: true }        // checkbox
{ key: 'wave', label: 'Waveform', options: [[value, label], …], select: 'triangle' } // dropdown
{ key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 60, unit: '%' } // slider
{ key: 'reverb', …, toggle: true }                       // slider with an on/off checkbox (default on)
```

Values live in `params[key]`, on/off state in `enabled[key]`
(`on(k) = enabled[k] !== false`).

**Knob style (Drummer, Synth, Granular, Memory)** — `GROUPS = [{ title, params: [...] }]`,
each param `{ key, label, min, max, step?, log?, value, format }` (knob) or
`{ key, label, options, value }` (drop-down). Flatten with
`GROUPS.flatMap(g => g.params)`.

**Change handling** — one `onParam(key)` / `onParamChanged(key)` routes by
sets of keys: live voice settings → reconfigure sounding voices, global audio
settings → `applyGlobal()` / `applyAudioParams()`, reverb length → debounced
impulse rebuild; then save.

## Persistence

- `localStorage` key `nmlq-<app>-v<N>` (Graph is the legacy
  `nmlq-settings-v2`). Bump `N` when the shape changes incompatibly.
- Load: start from defaults, then copy only values whose type matches;
  clamp numbers to `[min, max]`; accept option values only if listed.
- Wrap every storage call in `try/catch` (private mode can throw).
- A **Defaults** button restores the definition defaults (Synth keeps
  layout settings such as mode, octave and keys on screen).

## Parameters shared across apps

Use these names, labels, units and ranges when an app has the concept.

| Concept | Key | Label | Range / options | Default | Apps |
| --- | --- | --- | --- | --- | --- |
| Master volume | `volume` | Volume | 0–100 % | 60 (Graph, Fifths), 70 (Synth), 75 (Drummer) | all |
| Mute | `soundOn` | Sound on | bool | on | Graph, Fifths |
| Waveform | `wave` / `osc1Wave` / `osc2Wave` / `lfoWave` | Waveform / Wave | sine, triangle, sawtooth, square | triangle (Graph, Fifths), sawtooth/square (Synth osc 1/2), sine (LFO, Drummer) | all |
| Attack | `attack` | Attack | 2–1000 ms (Graph, Fifths); 0–100 ms (Drummer); 1–5000 ms log (Synth) | 12 ms / 0.5 ms / 4 ms | all |
| Decay | `decay` | Decay | 0.2–10 s (ring-out); 5–2000 ms log (Drummer); 5–5000 ms log (Synth ADSR) | 4 s / 200 ms / 300 ms | all |
| Sustain | `sustain` | Sustain | 0–100 % | 75 (amp), 30 (filter) | Synth |
| Release | `release` | Release / Release time | 20–2000 ms (Fifths); 5–8000 ms log (Synth) | 300 ms | Fifths, Synth |
| Brightness | `brightness` | Brightness | 0–100 % → 250 Hz–16 kHz low-pass | 40 | Graph, Fifths |
| Filter type | `filter` / `filterType` | Type | lowpass, highpass, bandpass (+ lowpass24, notch in Synth) | lowpass | Drummer, Synth |
| Cutoff | `cutoff` | Cutoff | 20–20000 Hz log (Drummer), 30–18000 Hz log (Synth) | 18 kHz / 1.8 kHz | Drummer, Synth |
| Resonance | `q` / `resonance` | Resonance | Q 0.1–20 log (Drummer); 0–100 % (Synth) | 0.7 / 25 % | Drummer, Synth |
| Detune / chorus | `detune` / `osc2Detune` | Chorus (detune) / Detune | 0–40 ¢; ±50 ¢ (Synth) | 7 ¢ | Graph, Fifths, Synth |
| Octave shimmer | `shimmer` | Octave shimmer | 0–100 % | 20 | Graph, Fifths |
| Vibrato | `vibrato` | Vibrato depth / Vibrato | 1–40 ¢ (toggle, off); 0–100 ¢ (Synth) | 6 ¢ / 0 | Graph, Fifths, Synth |
| Octave | `octave` / `osc1Oct` | Octave | 1–6 (Graph), 2–6 (Fifths), keyboard C0–C8 and osc ±2 (Synth) | 3 / 4 / C3 | Graph, Fifths, Synth |
| Noise | `noise` / `noiseLevel` | Noise mix / Noise | 0–100 % | 0 | Drummer, Synth |
| Drive | `drive` | Drive | 0–100 % | 0 | Drummer, Synth |
| Reverb mix | `reverb` | Reverb mix / Reverb | 0–100 % | 35 (toggle on) / 20 | Graph, Fifths, Synth |
| Reverb length | `reverbSize` | Reverb length | 0.5–8 s (0.3–8 Synth) | 3.5 s / 2.5 s | Graph, Fifths, Synth |
| Echo mix | `echo` | Echo mix / Echo | 0–100 % | 25 (toggle off) / 0 | Graph, Fifths, Synth |
| Echo time | `echoTime` | Echo time | 50–1000 ms (30–1000 Synth) | 375 ms / 320 ms | Graph, Fifths, Synth |
| Echo feedback | `echoFeedback` | Echo feedback / Feedback | 0–90 % | 35 | Graph, Fifths, Synth |
| Tempo | `bpm` | Tempo / BPM | 40–220/240 bpm | 84 / 72 / 110 | Graph, Fifths, Drummer |
| Strum | `strum` | Strum | 0–200 ms | 35 / 25 ms | Graph, Fifths |
| Chord type | `chord` / `style` | Chord / Chord type | power, major, minor, sus, 7th, add 9 … | none / triad | Graph, Fifths |
| Pan | `pan` | Pan | −100…100 | 0 | Drummer |
| Filter on/off, drive on/off, echo on/off, reverb on/off | `filterOn` / `driveOn` / `echoOn` / `reverbOn` | group switch | bool | on / off / off / on | Granular |

## App-specific parameters

- **Graph** — physics (stiffness, wobble, stretch/squash limits, repulsion,
  friction, gravity, centring, walls, speed), interaction (grab, push/pull),
  triggers (grab, wall hit, speed threshold, retrigger delay), melody
  (pattern, notes per beat, rests, downbeat, kick), display.
- **Fifths** — voicing, bass note, strum direction, stop when released,
  slide, auto-play (progression, beats per chord, chords or arpeggio).
- **Drummer** — per-drum pitch, pitch drop + drop time, noise decay;
  transport (BPM, shuffle, volume); rows with mute / solo.
- **Granular** — grains (size 5–1000 ms, density 1–100/s, timing
  async/sync, window shape, max grains), position (position, spray, scan
  speed ±200%, Freeze), pitch (transpose ±24 st, fine ±100¢, pitch spray
  0–1200¢, reverse chance, follow keys / fixed), spread (stereo, level
  spray), amp ADSR, LFO (rate, → position / pitch / size / filter), voice
  (portamento, poly voices 1–8, bend range); effects with group switches
  (filter, drive, echo, reverb); memory slots and sample region are not
  saved (slots live in memory only).
- **Memory** — game: length (2–50 steps), speed (50–300 %), tempo (speeds
  up / steady), on a mistake (game over / try again); notes: chord preset
  (major 7th default, minor 7th, dominant 7th, …, custom), root, octave,
  and one note per pad (`pad0`–`pad3`, MIDI 36–96); the shared synth voice
  groups with softer defaults; output (volume, reverb, echo). The best
  score is saved with the settings.
- **Synth** — osc 2 semitones, sub level, key tracking, filter env amount
  (±), filter ADSR, LFO rate / filter / tremolo, portamento + glide mode,
  mono envelopes (legato / retrigger), poly voices, bend range; plus layout
  state: mode (mono/poly), keyboard octave, keys on screen (3–5 octaves),
  key labels.

## Input conventions

- Keyboard play ignores events with Cmd/Ctrl/Alt and events targeting
  text inputs / selects; it skips events already `defaultPrevented` (so a
  focused knob keeps its arrow keys). `Esc` = stop everything.
- Track held keys by `event.code` and the note they started, so releases
  match even if the octave changes mid-press; ignore `event.repeat`.
- Track pointers by `pointerId` for multi-touch; use
  `document.elementFromPoint` on `pointermove` to slide between keys/chords.
- Release all keys and pointers on window `blur`.
- Fifths: number row = majors, Q row = minors. Synth: Z row = lowest
  on-screen octave, Q row = the next, ←/→ (↓/↑) octave, Space = sustain.
  Drummer: Space = play/stop.
