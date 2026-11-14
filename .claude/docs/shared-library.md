# Shared library (`shared/`)

Four files, loaded by every app page in this order. The scripts add to one
global, `window.nmlq` (apps alias it as `const N = window.nmlq;`).

```html
<link rel="stylesheet" href="../shared/nmlq.css">
…
<script src="../shared/core.js"></script>
<script src="../shared/audio.js"></script>
<script src="../shared/ui.js"></script>
<script src="<app>.js"></script>
```

They are classic scripts, not ES modules, so pages keep working when opened
from `file://`. `core.js` also exports itself with `module.exports` so Node
tests can `require` it; `audio.js` and `ui.js` need `nmlq` to already exist.

## `core.js` — pure helpers (no DOM, no Web Audio)

| Name | What it does |
| --- | --- |
| `clamp(v, lo, hi)` | Clamp a number |
| `SHARPS`, `FLATS` | Note-name tables (`C`, `C♯`/`D♭`, …) |
| `WAVES` | `[['sine','Sine'], ['triangle','Triangle'], ['sawtooth','Sawtooth'], ['square','Square']]` |
| `midiFreq(m)` | MIDI note → Hz (A4 = 69 = 440 Hz) |
| `noteName(m, names?)` | MIDI note → `"C4"` (C4 = 60) |
| `circlePos(pc)` | Pitch class ↔ position on the circle of fifths (self-inverse) |
| `fmt.hz / ms / pct / signed / signedPct` | Value formatters for knobs |
| `fmt.step(def, v)` | Slider formatter: decimals of `def.step` + `def.unit` |
| `defaultValue(def)` | Default of a parameter definition (`bool` / `select` / `value`) |
| `loadDefaults(defs, params, enabled?, filter?)` | Reset params (and toggle state) to defaults |
| `validValue(def, v)` | A saved value if valid for `def` (clamped), else `undefined` |
| `restoreParams(defs, params, saved, enabled?, savedEnabled?)` | Copy valid saved values in, ignore the rest |
| `loadJSON(key)` / `saveJSON(key, value)` | `localStorage` that never throws |
| `pluckValue(v, now)` | Level of a ring-out note (linear attack, exp decay) |
| `adsrValue(e, now)` | Level of an ADSR stage recorded by `audio.envStart/envRelease` |
| `tanhCurve(k, n?)` | Normalised soft-clip curve for a `WaveShaperNode` |
| `fillImpulse(data, rand?)` / `fillNoise(data, rand?)` | Reverb impulse / white noise samples |
| `silentWav()` | `ArrayBuffer` of a tiny silent WAV (iOS unlock) |
| `knobScale({min,max,step?,log?})` | `{ toNorm, fromNorm }` for knobs |
| `arcPath(a0, a1)` | SVG arc on the 40×40 knob face |
| `isTypingTarget(el)` | True for text inputs / textareas / selects — skip shortcuts |

## `audio.js` — `nmlq.audio`

| Name | What it does |
| --- | --- |
| `createContext()` | New `AudioContext` (or `null` without Web Audio) |
| `resume(ac)` | Resume unless already running (iOS also reports `'interrupted'`) |
| `setParam(ac, param, v, immediate, tau?)` | Jump, or glide with `setTargetAtTime` |
| `compressor(ac, opts?)` | Master compressor (default threshold −16, knee 12, ratio 4) |
| `noiseBuffer(ac, seconds?)` / `impulseBuffer(ac, seconds)` | Buffers |
| `createSpace(ac, reverbSeconds)` | Reverb + echo send: `{ input, output, set({reverb, echo, echoTime, echoFeedback}, immediate), setLength(s), setLengthSoon(s) }` (mixes 0..1, time in seconds) |
| `createPluck(ac, { output, lfo?, maxVoices? })` | Graph/Fifths ring-out voices: `{ play(freq, peak, when, {wave, attack, decay, detune, shimmer}), release(v, s), stopAll(s?), voices }` |
| `envStart(params, e, t, from, peak, sustain, a, d)` | Schedule an ADSR attack/decay on one or more params and record it in `e` |
| `envRelease(params, e, now, r)` | Release from the current level (`adsrValue`) |
| `installUnlock({ ensure, current, enabled? })` | Start audio on the first gesture with the iOS silent-switch workarounds, and resume on `visibilitychange` |

Typical app setup:

```js
function ensureAudio() {
  if (!audio.ctx) {
    const ac = N.audio.createContext();
    if (!ac) return null;
    audio.ctx = ac;
    audio.space = N.audio.createSpace(ac, params.reverbSize);
    audio.master = ac.createGain();
    myVoicesBus.connect(audio.space.input);
    audio.space.output.connect(audio.master).connect(N.audio.compressor(ac)).connect(ac.destination);
  }
  return N.audio.resume(audio.ctx);
}
N.audio.installUnlock({ ensure: ensureAudio, current: () => audio.ctx });
```

## `ui.js` — `nmlq.ui`

| Name | What it does |
| --- | --- |
| `makeKnob(o)` | Rotary knob → `{ el, set(v) }`. `o`: `label, min, max, step?, log?, value, def (reset), format?, onInput(v), onChange?(v)` (gesture end) |
| `buildKnobGroups(container, groups, { values, defaults?, onInput(key, v), onChange?(key, v) })` | Boxed groups of knobs / drop-downs from `[{ title, params }]` → `{ set(key, v), sync(values) }` |
| `buildParamPanel({ defs, params, enabled, container(sectionDef), onChange(key) })` | Slider panel from flat definitions (sections, checkboxes, drop-downs, sliders with optional on/off) → `{ sync() }` |
| `collapsible(button, panel, onChange?)` | Hide / Show button for a `.panel` → `setCollapsed(bool)` |

## `nmlq.css`

Theme tokens (`--bg`, `--fg`, `--muted`, `--panel`, `--panel-float`,
`--card`, `--border`, `--accent`, `--accent-soft`, `--cell`, `--cell-alt`,
`--lit-l`) with light-mode values, base page styles, and the styles for
buttons / selects / `a.btn`, `.card`, `.hint`, `.buttons`, floating
`.panel` + `.section-title` + `.param-*` rows, `.groups` / `.group` /
`.field`, and `.knob`. Element rules use `:where()` (zero specificity) so
any app rule wins.

## Changing the library

- Keep backwards compatibility or update every app in the same change.
- Add unit tests (`tests/core.test.js`, `tests/audio.test.js`) for new
  helpers and browser coverage (`tests/browser.test.js`) for UI.
- Update this file.
