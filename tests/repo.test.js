// Static checks on the repository: every app is wired to the shared library,
// listed on the landing page and in the README, and doesn't re-copy shared code.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// An app is any top-level folder with an index.html (except shared code and tooling).
const APPS = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !['shared', 'tests', 'node_modules'].includes(d.name))
  .filter((d) => exists(path.join(d.name, 'index.html')))
  .map((d) => d.name)
  .sort();

const SHARED_SCRIPTS = ['core.js', 'audio.js', 'ui.js'];

test('the expected apps exist', () => {
  for (const app of ['drummer', 'fifths', 'graph', 'granular', 'memory', 'synth']) assert.ok(APPS.includes(app), app);
});

test('shared library files exist and parse', () => {
  for (const f of [...SHARED_SCRIPTS, 'nmlq.css']) assert.ok(exists('shared/' + f), f);
  for (const f of SHARED_SCRIPTS) new vm.Script(read('shared/' + f), { filename: f });
});

for (const app of APPS) {
  test(`${app}: page loads the shared library in order, then its own script`, () => {
    const html = read(`${app}/index.html`);
    assert.match(html, /<link rel="stylesheet" href="\.\.\/shared\/nmlq\.css\?v=[0-9a-f]{10}">/);
    assert.match(html, /<link rel="icon" href="\.\.\/shared\/favicon\.svg\?v=[0-9a-f]{10}" type="image\/svg\+xml">/);
    const scripts = [...html.matchAll(/<script src="([^"?]+)\?v=[0-9a-f]{10}"><\/script>/g)].map((m) => m[1]);
    assert.deepEqual(scripts, [...SHARED_SCRIPTS.map((f) => '../shared/' + f), `${app}.js`]);
    for (const s of scripts) assert.ok(exists(path.join(app, s)), `${s} referenced by ${app} exists`);
  });

  test(`${app}: page basics (title, viewport, back link)`, () => {
    const html = read(`${app}/index.html`);
    assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(html, /<title>[^<]+ · nmlq<\/title>/);
    assert.match(html, /<a class="btn" href="\.\.\/" aria-label="Back to all items">←<\/a>/);
  });

  test(`${app}: script parses and uses the shared library`, () => {
    const js = read(`${app}/${app}.js`);
    new vm.Script(js, { filename: `${app}.js` });
    assert.match(js, /'use strict'/);
    assert.match(js, /const N = window\.nmlq;/);
    assert.match(js, /N\.audio\.installUnlock\(/, 'starts audio through the shared unlock');
  });

  test(`${app}: does not re-implement shared helpers`, () => {
    const js = read(`${app}/${app}.js`);
    const banned = [
      [/function silentWavUrl|RIFF/, 'iOS silent WAV (use N.audio.installUnlock)'],
      [/function arcPath|function makeKnob/, 'knob (use N.ui.makeKnob)'],
      [/function buildImpulse|createConvolver/, 'reverb (use N.audio.createSpace)'],
      [/createDynamicsCompressor/, 'compressor (use N.audio.compressor)'],
      [/localStorage/, 'storage (use N.loadJSON / N.saveJSON)'],
      [/new AC\(\)|webkitAudioContext/, 'context creation (use N.audio.createContext)'],
      [/function buildControls|function syncControls/, 'slider panel (use N.ui.buildParamPanel)'],
    ];
    for (const [re, what] of banned) assert.doesNotMatch(js, re, `${app}.js duplicates ${what}`);
  });

  test(`${app}: page CSS does not redefine shared theme tokens`, () => {
    const html = read(`${app}/index.html`);
    for (const token of ['--bg', '--fg', '--muted', '--accent', '--border']) {
      assert.doesNotMatch(html, new RegExp(`\\s${token}:`), `${app} redefines ${token}`);
    }
  });

  test(`${app}: has a landing-page card and a README section`, () => {
    const index = read('index.html');
    assert.match(index, new RegExp(`<a class="item" href="${app}/">`));
    const readme = read('README.md');
    const name = app[0].toUpperCase() + app.slice(1);
    assert.match(readme, new RegExp(`^## ${name}$`, 'm'));
    assert.match(readme, new RegExp(`\\[${name}\\]\\(${app}/\\)`), 'listed in the apps table');
  });
}

test('every landing-page card points at an existing app', () => {
  const index = read('index.html');
  const hrefs = [...index.matchAll(/<a class="item" href="([^"]+)\/">/g)].map((m) => m[1]);
  assert.deepEqual(hrefs.slice().sort(), APPS);
  assert.match(index, /<link rel="stylesheet" href="shared\/nmlq\.css\?v=[0-9a-f]{10}">/);
});

test('shared CSS defines every theme token for dark and light', () => {
  const css = read('shared/nmlq.css');
  const [dark, light] = css.split('@media (prefers-color-scheme: light)');
  for (const t of ['--bg', '--fg', '--muted', '--panel', '--panel-float', '--card', '--border', '--accent', '--cell', '--cell-alt', '--lit-l']) {
    assert.match(dark, new RegExp(`${t}:`), `${t} (dark)`);
    assert.match(light, new RegExp(`${t}:`), `${t} (light)`);
  }
});

test('project docs exist', () => {
  for (const f of ['.claude/CLAUDE.md', '.claude/docs/style.md', '.claude/docs/audio.md', '.claude/docs/parameters.md', '.claude/docs/new-app.md']) {
    assert.ok(exists(f), f);
  }
});

// ---------- deployment (GitHub Pages) ----------

const stamp = require('../scripts/stamp.js');

test('every local asset URL carries a current content-hash stamp', () => {
  const { problems } = stamp.run(true);
  assert.deepEqual(problems, [], 'run `npm run stamp`');
  // Nothing local is left unstamped.
  for (const page of stamp.htmlFiles()) {
    const html = read(page);
    for (const m of html.matchAll(/\b(?:src|href)="((?![a-z]+:|\/\/|#)[^"]+\.(?:js|css|svg|ico)(?:\?[^"]*)?)"/g)) {
      assert.match(m[1], /\?v=[0-9a-f]{10}$/, `${page}: ${m[1]}`);
    }
  }
});

test('stampHtml adds, refreshes and leaves alone the right references', () => {
  const coreHash = stamp.hashFile(path.join(ROOT, 'shared/core.js'));
  const html = [
    '<script src="../shared/core.js"></script>',
    '<script src="../shared/core.js?v=0000000000"></script>',
    `<script src="../shared/core.js?v=${coreHash}"></script>`,
    '<script src="https://cdn.example.com/x.js"></script>',
    '<a class="btn" href="../">←</a>',
    '<a href="#top">top</a>',
  ].join('\n');
  const { html: out, refs } = stamp.stampHtml(html, 'synth/index.html');
  const lines = out.split('\n');
  assert.equal(lines[0], `<script src="../shared/core.js?v=${coreHash}"></script>`);
  assert.equal(lines[1], lines[0]);
  assert.equal(lines[2], lines[0]);
  assert.equal(lines[3], '<script src="https://cdn.example.com/x.js"></script>', 'external URLs untouched');
  assert.equal(lines[4], '<a class="btn" href="../">←</a>', 'page links untouched');
  assert.equal(lines[5], '<a href="#top">top</a>');
  assert.deepEqual(refs.map((r) => r.stale), [true, true, false]);
  const missing = stamp.stampHtml('<script src="nope.js"></script>', 'synth/index.html');
  assert.equal(missing.refs[0].missing, true);
});

test('the site has a favicon (avoids a 404 on every page)', () => {
  assert.ok(exists('favicon.ico'));
  assert.ok(exists('shared/favicon.svg'));
  const ico = fs.readFileSync(path.join(ROOT, 'favicon.ico'));
  assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0], 'ICO header');
  assert.match(read('index.html'), /<link rel="icon" href="shared\/favicon\.svg\?v=[0-9a-f]{10}" type="image\/svg\+xml">/);
});

test('nothing GitHub Pages (Jekyll) would drop is needed by a page', () => {
  // Jekyll skips files and folders starting with "_" or "." unless configured.
  for (const page of stamp.htmlFiles()) {
    for (const m of read(page).matchAll(stamp.REF)) {
      assert.doesNotMatch(m[2], /(^|\/)[_.][^./]/, `${page} references ${m[2]}`);
    }
  }
});
