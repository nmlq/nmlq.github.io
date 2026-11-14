# nmlq.github.io

A collection of small interactive musical toys. The landing page
(`index.html`) is a grid of items; each item lives in its own folder.

| Item | Folder |
| --- | --- |
| Graph | `graph/` |
| Fifths | `fifths/` |
| Drummer | `drummer/` |

To add an item, create a folder with its own `index.html`, then copy one
`<a class="item">` block in the root `index.html` and point it at the folder.

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
generator, sequencer, knobs, editor).

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

- `index.html` — landing page with the grid of items
- `graph/index.html` — the Graph page, styles, and on-screen controls
- `graph/graph.js` — graph construction, physics simulation, sound synthesis, melody, rendering, and input

### Running

Open `index.html` in a browser (or `graph/index.html` directly), or serve the folder with any static server,
e.g. `python3 -m http.server`. It's also served by GitHub Pages at the repo's
`github.io` address.
