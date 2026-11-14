# nmlq.github.io — project guide

A collection of small interactive musical toys, served as a static site by
GitHub Pages. No build step and no runtime dependencies: every app is plain
HTML + CSS + vanilla JS on top of a small shared library, and all sound is
generated live with the Web Audio API (no audio files).

## Layout

```
index.html            landing page: a grid of cards, one per app
README.md             user-facing description of every app
shared/core.js        pure helpers (music maths, formatters, params, storage, envelopes, knob maths,
                      filter Q, grain windows, sample peaks/trim/normalise, WAV encoding, key map)
shared/audio.js       Web Audio blocks (context, iOS unlock, reverb/echo, pluck voices, ADSR)
shared/ui.js          DOM components (knob, knob groups with on/off switches, slider panel,
                      collapsible panel, piano keyboard, bend/mod strips, oscilloscope)
shared/nmlq.css       theme tokens, shared control styles, keyboard-instrument layout
<app>/index.html      page markup + app-specific CSS
<app>/<app>.js        app behaviour, an IIFE using window.nmlq
tests/                node:test suites (unit, repo checks, headless-Chrome browser tests)
.githooks/pre-commit  runs the tests before each commit
.github/workflows/    CI: runs the tests on every pull request
.claude/              this guide and the reference docs below
```

Current apps: `graph/`, `fifths/`, `drummer/`, `synth/`, `granular/`.

## Reference docs (read before changing or adding an app)

- [docs/shared-library.md](docs/shared-library.md) — the `nmlq` API: what's
  in each shared file and how apps use it.
- [docs/style.md](docs/style.md) — colours, theme tokens, layout, cards,
  buttons, panels, knobs, keyboard, landing-page thumbnails.
- [docs/audio.md](docs/audio.md) — synthesis concepts: waveforms, voices,
  envelopes, filters, LFO, effects chain, compressor, iOS unlock.
- [docs/parameters.md](docs/parameters.md) — the parameter-definition
  pattern, persistence, and the table of parameters shared across apps.
- [docs/testing.md](docs/testing.md) — test suites, pre-commit hook, CI.
- [docs/new-app.md](docs/new-app.md) — checklist for adding a new app.

## Ground rules

- **Use the shared library.** Anything more than one app needs (audio
  start-up, reverb/echo, knobs, panels, formatters, storage, envelopes,
  theme CSS) lives in `shared/`. Don't copy it into an app; if an app needs a
  variation, extend the shared function with an option. `tests/repo.test.js`
  fails if an app re-implements shared helpers.
- Shared scripts are classic scripts (not ES modules) so pages still work
  from `file://`. Each app page loads, in order:
  `../shared/nmlq.css`, `../shared/core.js`, `../shared/audio.js`,
  `../shared/ui.js`, then `<app>.js`. `core.js` must stay free of DOM and
  Web Audio so Node can unit-test it.
- Same look in every app: use the theme tokens from `shared/nmlq.css`
  (dark default, light via `prefers-color-scheme`). Pages may add their own
  tokens but must not redefine the shared ones.
- Same sound vocabulary: waveforms are `N.WAVES` (sine / triangle /
  sawtooth / square); parameters that exist in more than one app use the
  same label, unit and (where sensible) range and default.
- Works with mouse, pen, touch (multi-touch) and keyboard. Use pointer
  events, `touch-action: none` on playable surfaces, `N.isTypingTarget` to
  leave text fields alone, and release everything on `blur`.
- Settings persist via `N.loadJSON` / `N.saveJSON` under
  `nmlq-<app>-v<N>`, validated with `N.restoreParams`.
- Every app has a back button (`<a class="btn" href="../">←</a>`).
- When adding or changing an app, update its card in `index.html`, its
  section in `README.md`, and the browser test for it.
- Run `npm test` before committing (the pre-commit hook does this once
  enabled with `npm run hooks`). CI runs the same tests on pull requests.
