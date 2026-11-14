# Adding a new app

1. Create `<name>/index.html` and `<name>/<name>.js` (lowercase folder name).
2. In `index.html` of the app:
   - `<title><Name> · nmlq</title>`, viewport meta.
   - `<link rel="stylesheet" href="../shared/nmlq.css">`, then an inline
     `<style>` with only app-specific rules (and app-specific tokens with
     light-mode values — never redefine the shared tokens).
   - A back link `<a class="btn" href="../" aria-label="Back to all items">←</a>`.
   - At the end of `<body>`: `../shared/core.js`, `../shared/audio.js`,
     `../shared/ui.js`, then `<name>.js`.
3. In the JS:
   - `(function () { 'use strict'; const N = window.nmlq; … })();` with a
     header comment explaining what the app is and how its sound works.
   - Build audio from `N.audio` (`createContext`, `createSpace`,
     `compressor`, `createPluck` or your own voices with
     `envStart`/`envRelease`) and start it with `N.audio.installUnlock`.
   - Define parameters as data (`parameters.md`), reuse shared keys, labels,
     units and ranges, build controls with `N.ui.buildParamPanel` or
     `N.ui.buildKnobGroups`, and persist with `N.loadJSON` / `N.saveJSON` /
     `N.restoreParams` under `nmlq-<name>-v1`.
   - Pointer events for touch/mouse/pen, keyboard shortcuts that skip
     `N.isTypingTarget`, release everything on `blur`.
   - If something you need would help other apps, add it to `shared/`
     (see `shared-library.md`) instead of writing it locally.
4. Add a card to the root `index.html`: copy an `<a class="item">` block,
   point it at the folder, draw a 100×100 SVG thumbnail using the existing
   thumbnail classes (add new ones next to them if needed, theme tokens
   only), and write a one-line description.
5. Update `README.md`: add the app to the table (`[Name](name/)`) and write
   its `## Name` section (what it is, how to play it, settings, files).
6. Tests: the repo checks pick the app up automatically; add a
   `t.test('<name>: …')` block to `tests/browser.test.js` that interacts
   with it, and update the landing-page card list there. Run `npm test`.
