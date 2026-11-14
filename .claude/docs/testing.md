# Testing

Everything runs on Node's built-in test runner (Node 22+); there are no npm
dependencies to install.

```sh
npm test               # everything
npm run test:unit      # core + audio + repo checks (fast, no browser)
npm run test:browser   # headless Chrome
```

## Suites (`tests/`)

| File | What it covers |
| --- | --- |
| `core.test.js` | `shared/core.js`: music maths, formatters, parameter defaults / validation, storage, envelope maths, curves, WAV, knob maths, `isTypingTarget` |
| `audio.test.js` | `shared/audio.js` against a fake `AudioContext`: wiring of the reverb/echo chain, mix formulas, pluck voices (detune, shimmer, stealing, release), ADSR scheduling matching `adsrValue` |
| `repo.test.js` | Every app loads the shared files in order, parses, starts audio via the shared unlock, doesn't re-implement shared helpers or redefine theme tokens, has a landing-page card and a README section |
| `browser.test.js` | Loads every page in headless Chrome and fails on any exception, `console.error` or missing file; exercises the shared UI components and each app (Synth keys/touch/sustain/mono, Granular grains/effect switches/display/recording/slots, Fifths chords/auto-play, Drummer sequencer/knobs, Graph panels/pointer), and checks no page scrolls sideways at phone width |
| `helpers/chrome.js` | Tiny DevTools-protocol driver over `--remote-debugging-pipe` |

Browser tests find Chrome through `CHROME_PATH`, the usual macOS location,
or `google-chrome` / `chromium` on `PATH`. Without Chrome they are skipped,
unless `REQUIRE_BROWSER=1` (set in CI) makes that a failure. Each page
starts with cleared `localStorage`. The Granular recording test replaces
`navigator.mediaDevices.getUserMedia` with a stream from an oscillator
(headless Chrome on macOS never opens even its fake microphone), so the
whole capture → trim → normalise → slot path runs everywhere; a real
microphone still needs a manual check. `page.screenshot()` returns a PNG
for debugging. Synthetic key events that a control
should consume must be `cancelable: true`, or the app's window handler sees
them too.

## Pre-commit hook

`.githooks/pre-commit` runs `node --test tests/*.test.js` and aborts the
commit on failure. Enable it once per clone:

```sh
npm run hooks          # = git config core.hooksPath .githooks
```

(`npm install` also does this through the `prepare` script.) Skip it in an
emergency with `git commit --no-verify`.

## CI

`.github/workflows/test.yml` runs on every pull request (and manually via
*Run workflow*): Node 22 on `ubuntu-latest`, unit + repo tests, then browser
tests with the runner's Google Chrome and `REQUIRE_BROWSER=1`.
