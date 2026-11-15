# Visual style

All apps share one minimal look: dark by default, light when the OS asks for
it, system font, thin borders, one blue accent, and hue-coded highlights.

## Theme tokens

They are defined once in `shared/nmlq.css` (with light values under
`@media (prefers-color-scheme: light)`). Pages link that file and never
redefine them; never hard-code colours in rules.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0d1017` | `#f5f6f9` | page background |
| `--fg` | `#e6e9ef` | `#1b1f2a` | text, knob pointer |
| `--muted` | `#8a93a6` | `#5d6578` | secondary text, labels, section titles |
| `--panel` | `#141822` | `#ffffff` | opaque cards |
| `--panel-float` | `rgba(20,24,34,0.82)` | `rgba(255,255,255,0.88)` | floating panels over a stage |
| `--accent-soft` | `rgba(122,162,255,0.45)` | `rgba(58,99,216,0.4)` | secondary highlight (e.g. sustained keys) |
| `--card` | `#141822` | `#ffffff` | landing-page cards |
| `--border` | `rgba(255,255,255,0.09)` | `rgba(0,0,0,0.09–0.1)` | every border |
| `--accent` | `#7aa2ff` | `#3a63d8` | hover, focus, active/pressed, knob fill, scope |
| `--cell` | `rgba(255,255,255,0.05)` | `rgba(0,0,0,0.04)` | empty cells, tracks |
| `--cell-alt` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.09)` | alternate cells, knob track |
| `--lit-l` | `58%` | `52%` | lightness for `hsl(var(--hue), 70%, var(--lit-l))` highlights |

App-specific tokens are fine (e.g. Synth's `--white-key`, `--black-key`,
`--accent-soft`; Fifths' `--chord-bg`) as long as they get light variants.

**Hue coding.** Things that light up (chords, drum rows, wheel dots) carry a
`--hue` custom property (0–360) and are coloured
`hsla(var(--hue), 70–85%, var(--lit-l), alpha)`. Fifths uses
`hue = position on circle × 30°`; Drummer presets have fixed hues
(kick 0, snare 28, hat 52, … blank 220). Animated glow is a `--glow` (0–1)
custom property updated only when its value visibly changes.

## Typography

- `font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif` in apps
  (15px/1.5 on the landing page).
- Section / group titles: 11px, weight 600, `letter-spacing: 0.06em`,
  uppercase, `--muted`.
- Numbers that change (values, BPM, ranges): `font-variant-numeric: tabular-nums`.
- Musical symbols: use real `♯` / `♭` characters, `¢` for cents, `−` for minus
  buttons, `←` for back.

## Layout patterns

- **Full-screen instrument + floating panel** (Graph, Fifths): stage fills
  the window (`position: fixed; inset: 0`), settings in a translucent panel
  at top-left (`width: min(290px, 100vw - 32px)`, `backdrop-filter: blur(8px)`,
  radius 10px) with a header of buttons (`←`, actions, `Defaults`, `Hide`/`Show`).
  On ≤640px the panel starts collapsed.
- **Stacked cards** (Drummer, Synth): `main`/`.app` with `max-width`
  1100–1200px, 16px gutters, cards with `background: var(--panel)`,
  `1px solid var(--border)`, `border-radius: 10px`, padding ~12px, 12–16px gaps.
  Synth uses a full-height column (`100dvh`): top bar, scrolling controls,
  fixed-height keyboard.
- Mobile: 16px side gutters (8px on the tightest screens), no horizontal page
  scroll, `100dvh` with a `100vh` fallback before it, hide hints at ≤640px.

## Controls

- **Buttons / selects / `a.btn`**: transparent background, `--fg` text,
  `1px solid var(--border)`, radius 6px, padding `4px 9px`, `font: inherit`.
  Hover: border and text turn `--accent`. Toggle buttons use
  `aria-pressed="true"` → filled `--accent` background with `--bg` text.
  `select option { background: var(--bg); color: var(--fg); }`.
- Segmented buttons (Synth Mono | Poly): adjacent buttons, outer corners
  rounded only.
- Focus: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`.
- Checkboxes and range inputs: `accent-color: var(--accent)`.
- Panel rows (Graph/Fifths) are built by `N.ui.buildParamPanel` with classes
  `.param-row` / `.param-head` / `.param-label` / `.param-value`: label +
  value on one line, range slider below; rows with an on/off checkbox get
  `.disabled` (dimmed) when off.

## Knobs (Drummer, Synth)

Rotary knob component `N.ui.makeKnob(o)` in `shared/ui.js` (styles in
`shared/nmlq.css`); `N.ui.buildKnobGroups` builds whole boxed groups.

- Options: `label, min, max, step?, log?, value, def (reset value), format(v), onInput(v)`.
  `log: true` for frequency and time (`min` must be > 0).
- Markup: `div.knob[role=slider][tabindex=0]` containing a 40×40 SVG
  (`path.track`, `path.fill`, `line.pointer`), then `.k-value` and `.k-label`.
- Sweep is 270° (−135° to +135°). Bipolar knobs (`min < 0 < max`) fill from
  the centre.
- Interaction: drag up/down (200 px = full range, Shift = 800 px fine),
  mouse wheel (2% per notch, Shift 0.5%), arrow keys / PageUp / PageDown /
  Home / End, double-click resets to the default. Sets `aria-valuenow` and
  `aria-valuetext`.
- Style: width 64px (40–44px dial), track `--cell-alt`, fill `--accent`, pointer `--fg`,
  stroke 4 (pointer 2.5), `touch-action: none`, `cursor: ns-resize`.
- Group knobs in `.group` boxes (border, radius 8px, uppercase title) laid
  out with `flex-wrap`. Drop-downs inside groups use `.field` (select above,
  11px muted label below).

## Value formatting

Shared formatter conventions:

- Frequency `fmtHz`: `< 1000` → `"440 Hz"`, else `"1.80 kHz"` (2 decimals
  below 10 kHz, 1 above).
- Time `fmtMs`: `"300 ms"`, ≥ 1000 ms → `"1.25 s"` in Synth (Drummer shows
  one decimal below 10 ms).
- Percent: `"70%"`; signed values `"+7"`, `"+40%"`; cents `"7¢"`;
  semitones `"12 st"`; pan `"C"`, `"L20"`, `"R15"`.
- Graph/Fifths sliders: `value.toFixed(decimals of step) + unit`.

## On-screen keyboard (Synth)

- White keys are flex children; black keys are absolutely positioned
  (`left = whitesSoFar × w − 0.31w`, `width = 0.62w`, `height 60%`) where
  `w = 100% / whiteKeyCount`.
- Pressed: `.down` (`--accent` background). Held only by sustain: `.held`
  (`--accent-soft`).
- Labels: computer-key letter on every key, note name with octave on each C.

## Landing page cards

`index.html` grid: `repeat(auto-fill, minmax(200px, 1fr))`, 16px gap. Each
card is an `<a class="item">` with a square `.thumb` holding a 100×100
viewBox SVG and a `.label` (`<strong>` name + muted `<span>` one-line
description). Hover lifts the card 2px and turns the border accent; the SVG
rotates 22.5° unless it has `class="no-spin"` (then it scales 1.06). Respect
`prefers-reduced-motion`.

Thumbnail classes already defined: `.edges`, `.nodes` (+ `.small`, `.lit`),
`.chord-shape`, `.cells rect` (+ `.on`), `.keys-w rect`, `.keys-b rect`
(+ `.on`), `.wave`, `.spray`, `.quad` (+ `.on`), `.hub`, `.tiles rect` (+ `.on`), `.tile-text` (+ `.on`). Thumbnails use only theme tokens so they follow the
colour scheme.
