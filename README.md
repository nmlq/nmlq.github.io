# nmlq.github.io

A collection of small interactive musical toys that run in the browser. Every
sound is synthesised live with the Web Audio API — there are no audio files,
no build step and no dependencies. The site is served by GitHub Pages; the
landing page (`index.html`) is a grid of cards, one per app.

## The apps

| App | Folder | What it is |
| --- | --- | --- |
| [Graph](graph/) | `graph/` | A springy, physics-driven 8-pointed star. Every node is a note on the circle of fifths; grab, fling and bounce the nodes to play them, or let a melody play the star. |
| [Fifths](fifths/) | `fifths/` | A playable circle of fifths: 12 major chords round the outside, their relative minors inside. Tap, slide or use the keyboard to play chords, or let it auto-play progressions and arpeggios. |
| [Drummer](drummer/) | `drummer/` | A 16-step drum sequencer. Every drum (kick, snare, hats, toms, clap, …) is a preset of one sound generator you can edit. |
| [Synth](synth/) | `synth/` | A basic subtractive synthesizer with a 3–5 octave keyboard you play by touch (multi-touch) or with the computer keyboard; mono or poly, with filter, ADSR envelopes, LFO and portamento. |
| [Granular](granular/) | `granular/` | A granular synthesizer: record a sound in the browser (or load a file), keep up to four in memory, and play it from a 3–5 octave keyboard as clouds of tiny grains, with a live display of the waveform and every grain. |

All apps work with mouse, pen, touch and keyboard, follow the system's light
or dark mode, and remember their settings in the browser (each has a
**Defaults** or reset button). Browsers only allow audio after you interact
with the page, so the first click, tap or key press turns sound on; on
iPhone, sound also plays with the silent switch on.

## Shared sound and style

The apps are separate pages but share one sound vocabulary and one look:

- **Waveforms** — sine, triangle, sawtooth and square everywhere.
- **Envelopes** — linear attack, exponential decay; Synth adds full ADSR
  (attack, decay, sustain, release) for both its filter and amplifier.
- **Tone** — Graph and Fifths use two detuned oscillators ("chorus"), an
  optional octave "shimmer", vibrato and a brightness (low-pass) control;
  Drummer and Synth have full filters (low-pass, high-pass, band-pass, and in
  Synth also 24 dB low-pass and notch) with cutoff and resonance, plus noise
  and drive.
- **Space** — the same generated reverb (mix, length) and feedback echo
  (mix, time, feedback) in Graph, Fifths and Synth, all ending in a gentle
  compressor.
- **Controls** — Graph and Fifths use a slide-out settings panel; Drummer
  and Synth use rotary knobs (drag up/down, scroll or arrow keys;
  double-click resets).

Settings that appear in more than one app use the same names and units.

## Repository layout

```
index.html            landing page with the grid of app cards
shared/               the shared library every app is built on:
  core.js             music maths, formatters, settings, storage, envelope and sample maths
  audio.js            audio start-up (incl. iOS), reverb + echo, voices, ADSR
  ui.js               knobs, knob groups, slider panels, piano keyboard, strips, scope
  nmlq.css            theme colours (dark and light) and shared control styles
graph/                index.html (page + app styles), graph.js
fifths/               index.html, fifths.js
drummer/              index.html, drummer.js
synth/                index.html, synth.js
granular/             index.html, granular.js
tests/                unit, repository and headless-browser tests
.githooks/pre-commit  runs the tests before each commit
.github/workflows/    runs the tests on every pull request
.claude/              project guide and reference docs (shared library API,
                      style, audio, parameters, testing, adding an app)
```

Each app is one HTML page and one plain JavaScript file built on the shared
library in `shared/`. The library is plain scripts (no modules, no build
step), so every page still opens straight from disk.

## Running

Open `index.html` (or any `<app>/index.html`) directly in a browser, or serve
the repo root with any static server, e.g. `python3 -m http.server`. It's
also published by GitHub Pages at the repo's `github.io` address.

## Testing

The tests use Node's built-in test runner (Node 22 or newer); there is
nothing to install.

```sh
npm test               # everything
npm run test:unit      # shared library + repository checks (fast)
npm run test:browser   # every page in headless Chrome
```

- **Unit tests** cover the shared library, including the audio code against
  a simulated Web Audio context.
- **Repository checks** make sure every app loads the shared library, has a
  landing-page card and a README section, and doesn't re-copy shared code.
- **Browser tests** open every page in headless Chrome, play notes, chords
  and the sequencer, turn knobs, and fail on any error or on sideways
  scrolling at phone width. They need Google Chrome (or set `CHROME_PATH`)
  and are skipped without it locally.

A pre-commit hook runs the tests before every commit; enable it once per
clone with `npm run hooks` (skip it in an emergency with
`git commit --no-verify`). GitHub Actions runs the same tests on every pull
request.

## Adding an app

Create a folder with its own `index.html` and script built on `shared/`,
copy one `<a class="item">` block in the root `index.html` and point it at
the folder, add a section below, and add a browser test. See
`.claude/docs/new-app.md` for the full checklist and `.claude/docs/` for the
shared library and the style and sound conventions.

## Graph

An interactive, physics-driven **8-pointed star** built from a fully connected graph.

Eight nodes sit evenly spaced around a circle. Every node is joined to every
other node by an edge — the complete graph K8, with 28 edges in total. Drawn
together, the outer octagon and the inner chords form an 8-pointed star.

Each node is also a musical tone. Moving round the circle, each node is a
perfect fifth above the last (the circle of fifths: C, G, D, A, E, B, F♯, …),
so up to 12 nodes cover all 12 notes. Touching, flinging and bouncing the
nodes plays them, and an optional melody can play the star by itself.

### Physics

- **Springs on every edge.** Each edge behaves like an elastic band whose rest
  length is its chord length on the circle, so the graph always relaxes back
  into the regular star shape.
- **Personal space.** Nodes repel each other when they get too close, keeping a
  minimum distance between them.
- **Never comes apart.** Hard constraints cap how far any edge can stretch or
  compress, so the nodes always stay connected — they can be pulled and
  squashed, but never lose each other.
- **Elastic feel.** Verlet integration with damped springs gives a bouncy,
  wobbly response that settles naturally. Edges thin out and shift from blue
  to red as they stretch.
- A gentle pull keeps the whole star centred on screen, and nodes bounce off
  the window edges.

### Interaction

| Action | Effect |
| --- | --- |
| Drag a node | Plays its note; pull it around and release with speed to fling it |
| Drag an edge | Plays the interval between its two nodes; stretch it from that point |
| Drag empty space | Push nearby nodes away |
| Shift + drag / right-drag | Attract nearby nodes instead of pushing |
| **Reset shape** | Snap back to the original circle |
| **Strum all** | Plays every node from lowest to highest |
| **Shake** | Give every node a random nudge |

Works with mouse, pen, and touch.

### Sound

Sound is generated live in the browser with the built-in Web Audio API — no
audio files. Each note is two slightly detuned oscillators plus an optional
sine an octave up, shaped by a soft attack and a long exponential decay, then
passed through a low-pass filter, a reverb (made from generated noise), an
optional echo, and a compressor. Browsers only allow audio after you interact
with the page, so the first click or tap turns sound on.

Notes play when:

- you grab a node (or an edge, which plays both of its nodes),
- a node moves faster than the movement threshold,
- a node hits the edge of the window,
- the melody plays it.

### Settings panels

There are two panels: **sound** on the left, **physics and display** on the
right. Settings with a checkbox next to their name can be switched on or off.
Your settings are remembered in the browser, and each panel's **Defaults**
button restores that panel's original settings. On small screens the panels
start collapsed; tap **Show** to open them.

#### Left panel: sound

| Group | Setting | What it does |
| --- | --- | --- |
| Sound | Sound on | Mutes or unmutes everything |
| | Volume | Overall loudness |
| | Waveform | Sine (pure), triangle (soft, default), sawtooth (bright), square (hollow) |
| | Attack | How quickly a note fades in |
| | Decay | How long a note rings out (4 s by default) |
| | Brightness | Low-pass filter cutoff; lower is mellower |
| | Chorus (detune) | Detunes the two oscillators for a warmer, wider tone |
| | Octave shimmer | Adds a soft sine an octave above each note |
| | Vibrato depth ☐ | Gentle pitch wobble |
| Tuning | Root note | Note of the first node; the rest follow in fifths from it |
| | Octave | Base octave |
| | Pitch layout | Fifths folded into 2 octaves (default), squeezed into 1 octave, or stacked upward without folding |
| | Show note names | Labels each node with its note |
| Space | Reverb mix ☑ | Amount of room sound |
| | Reverb length | How long the reverb tail lasts |
| | Echo mix ☐ | Amount of repeating echo |
| | Echo time | Gap between echoes |
| | Echo feedback | How many times the echo repeats |
| Triggers | Play when grabbed | Grabbing a node or edge plays it |
| | Play on wall hit | Nodes play when they bounce off the window edge |
| | Play on fast movement ☑ | Nodes play when their speed passes this threshold |
| | Retrigger delay | Minimum time before the same node can sound again |
| Chords | Chord | Play a chord on each node instead of a single note: power, major, minor, sus, 7th, add 9, or the node plus its two neighbours on the circle |
| | Strum | Delay between the notes of a chord |
| Melody | Play melody | Plays the nodes automatically |
| | Pattern | Random walk (to nearby fifths), around the circle, star path, up & down by pitch, or random |
| | Tempo | Beats per minute |
| | Notes per beat | 1–4 |
| | Rests | Chance of skipping a note |
| | On each bar | Adds a bass note or chord at the start of every bar |
| | Notes kick nodes ☑ | Each melody note gives its node a small push, so the star dances |

#### Right panel: physics and display

| Group | Setting | What it does |
| --- | --- | --- |
| Edges | Elasticity (stiffness) ☑ | Spring strength of every edge. Off = edges go slack and only the stretch limits hold the shape |
| | Wobble | How much the edges oscillate before settling (low = stiff and calm, high = jelly) |
| | Long edges as stiff as short ones | By default the long inner chords are softer than the outer ring |
| | Max stretch ☑ | Hard limit on how far an edge can stretch, as a multiple of its rest length |
| | Min squash ☑ | Hard limit on how short an edge can get |
| Nodes | Points | Number of nodes (3–12). 8 gives the 8-pointed star; 12 covers every note |
| | Star size | Circle radius as a share of the window |
| | Min spacing ☑ | Distance at which nodes start repelling each other |
| | Repulsion strength | How hard nodes push apart when too close |
| | Node size | Radius of the node circles |
| World | Air friction | Global drag that slows all motion |
| | Gravity ☐ | Pulls every node downward (off by default) |
| | Pull to centre ☑ | Gentle force keeping the star centred |
| | Walls (bounciness) ☑ | Keeps nodes on screen and sets how much they rebound |
| | Simulation speed | Slow motion to fast-forward |
| | Pause simulation | Freezes physics; you can still place nodes by dragging |
| Interaction | Edge grab strength | How firmly a grabbed edge follows the pointer |
| | Push / pull radius ☑ | Size of the push/attract field when dragging empty space |
| | Push / pull strength | Force of that field |
| | Fling nodes on release | Released nodes keep the pointer's speed |
| Display | Colour edges by strain | Blue when relaxed, red when stretched |
| | Edges thin when stretched | Line width shrinks as an edge stretches |
| | Show nodes | Hide nodes to see just the lines |
| | Motion trails | Leaves fading trails behind moving lines |

☑ = has an on/off switch, on by default · ☐ = has an on/off switch, off by default

### Files

- `graph/index.html` — the Graph page, styles, and on-screen controls
- `graph/graph.js` — graph construction, physics simulation, sound synthesis, melody, rendering, and input

## Fifths

A playable circle of fifths. The outer ring holds the 12 major chords and the
inner ring their relative minors. Click or tap a chord, slide across the wheel
to play each chord you pass, or use the keyboard: the number row (`1`–`0`,
`-`, `=`) plays the majors clockwise from C and the `Q` row (`Q`–`P`, `[`,
`]`) plays the minors. `Esc` stops all sound. Each chord lights up as it
plays, and the small clock in the middle joins the chord's notes into a shape.

It uses the same synth as Graph (waveform, envelope, brightness, chorus,
shimmer, vibrato, reverb, echo), plus chord type (triads, 7ths, add 9, sus,
power), voicing, bass note, strum, "stop when released", and an auto-play
mode that walks the circle or plays I–V–vi–IV style progressions in the key
of the last chord you played, as chords or arpeggios.

Files: `fifths/index.html` (page and styles) and `fifths/fifths.js` (synth,
chords, wheel, input, settings).

## Drummer

A 16-step drum sequencer. Each row is one drum with its own 16 steps; click a
step (or drag across steps) to turn it on or off. **Play** or the space bar
starts and stops; tempo and shuffle are dials (drag up/down, scroll, or use
the arrow keys; double-click resets). Shuffle delays every second 16th note.

Every drum comes from the same sound generator, so a kick and a hi-hat differ
only in their settings:

| Group | Settings |
| --- | --- |
| Oscillator | Wave, pitch, pitch drop (semitones) and drop time |
| Noise | Noise mix (oscillator ↔ white noise) and noise decay |
| Envelope | Attack and decay |
| Filter | Low-, high- or band-pass, cutoff, resonance |
| Output | Drive, level, pan |

The default kit has four rows: bass drum, snare, hi-hat and tom. **+ Add
drum** adds a row from a preset (including open hat, high tom, rimshot, clap,
cowbell, or a blank drum); **×** removes a row; **M** / **S** mute and solo.
Select a row to edit its sound below the grid. The pattern, sounds and tempo
are saved in the browser; **Reset kit** restores the defaults.

Files: `drummer/index.html` (page and styles) and `drummer/drummer.js` (drum
generator, sequencer, editor), using the shared library.

## Synth

A basic subtractive synthesizer with a playable keyboard. Play the on-screen
keys with the mouse or with several fingers at once on a touchscreen (slide
across keys to glide between them), or use the computer keyboard: the `Z`
row (`Z S X D C V G B H N J M , L . ; /`) plays the lowest octave on screen
and the `Q` row (`Q 2 W 3 E R 5 T 6 Y 7 U I 9 O 0 P [ = ]`) the next one up.
`←` / `→` (or `↓` / `↑`) shift the keyboard down or up an octave, Space is a
sustain pedal, and `Esc` stops everything.

| Control | What it does |
| --- | --- |
| Mono / Poly | One note at a time (last-note priority) or up to 16 notes |
| − / + | Shift the keyboard an octave down or up (C0 to C8) |
| Sustain | Latching sustain, same as holding Space |
| All off | Stops every note |
| Keys | 3, 4 or 5 octaves on screen |
| Bend / Mod strips | Pitch bend (springs back) and mod wheel (adds vibrato) |

Every voice has the same signal path, with knobs for each stage (drag up or
down, scroll, or arrow keys; double-click resets a knob):

| Group | Settings |
| --- | --- |
| Oscillator 1 | Wave (sine, triangle, sawtooth, square), octave, level |
| Oscillator 2 | Wave, octave, semitones, detune, level |
| Mixer | Sub oscillator (sine, an octave below oscillator 1), noise |
| Filter | Low-pass 12 dB, low-pass 24 dB, high-pass, band-pass or notch; cutoff, resonance, envelope amount (±), key tracking |
| Filter envelope | Attack, decay, sustain, release |
| Amp envelope | Attack, decay, sustain, release |
| Modulation (LFO) | Wave, rate, vibrato, filter wobble, tremolo |
| Voice | Portamento time, glide on legato notes only or always, mono legato or retrigger, poly voice count, bend range |
| Output | Volume, drive, reverb, reverb length, echo, echo time, echo feedback |

A small oscilloscope shows the output. Settings are saved in the browser;
**Defaults** restores the original sound.

Files: `synth/index.html` (page and styles) and `synth/synth.js` (voices,
envelopes, mono / poly engine, keyboard), using the shared library.

## Granular

A granular synthesizer that plays sounds you record. Press **● Record**
(allow the microphone), make a sound, and press **■ Stop**: the recording is
trimmed of silence, normalised and stored in the selected memory slot. There
are four slots; **Load file** puts an audio file in a slot instead,
**Demo** loads a built-in bell arpeggio (it's there when the page opens),
**Save WAV** downloads the selected region, and **Clear** empties the slot.
Slots are kept in memory only, so they're gone when the page closes.

Playing a key starts a stream of *grains*: tiny snippets read from around
the play position, each with its own small random changes. C4 plays the
sample at its own pitch; other keys transpose it. The keyboard works like
Synth's: several keys at once on a touchscreen, the `Z` and `Q` rows on a
computer keyboard, `←` / `→` for octaves, Space for sustain, `Esc` to stop,
mono or poly, 3–5 octaves on screen, plus pitch-bend and mod strips.

The display above the controls shows the recorded waveform (live while
recording, with a level meter), the selected region (drag its edges), the
play position with its spray (click or drag to move it), and every grain as
a dot moving through the part of the sound it plays, higher or lower
according to its stereo position.

| Group | Settings |
| --- | --- |
| Grains | Size (5 ms – 1 s), density (1–100 grains per second), timing (random or regular), window shape (Hann, triangle, trapezoid, Gaussian, percussive, reverse percussive), max grains |
| Position | Position in the region, spray (random spread around it), scan speed (−200% to +200% of real time; **Freeze** holds it still) |
| Pitch | Transpose (±24 semitones), fine (±100 cents), pitch spray, reverse (chance a grain plays backwards), follow keys or fixed pitch |
| Spread | Stereo spread, level spray |
| Amp envelope | Attack, decay, sustain, release |
| Modulation (LFO) | Wave, rate, and how much it moves the position, pitch, grain size and filter |
| Voice | Portamento, poly voices (1–8), bend range |
| Filter ☑ | Low-pass 12/24 dB, high-pass, band-pass or notch; cutoff, resonance |
| Drive ☐ | Soft saturation |
| Echo ☐ | Mix, time, feedback |
| Reverb ☑ | Mix, length |
| Output | Volume |

☑ / ☐ = effect with an on/off switch, on / off by default. Settings are
saved in the browser; **Defaults** restores them.

Files: `granular/index.html` (page and styles) and `granular/granular.js`
(memory slots, recording, grain scheduler, voices, display), using the
shared library.
