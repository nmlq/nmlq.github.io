#!/usr/bin/env node
// Cache-busting for GitHub Pages: every local script, stylesheet and icon an
// HTML page references gets `?v=<hash of the file's contents>`.
//
// GitHub Pages serves files with `Cache-Control: max-age=600`, so right after
// a deploy a browser can mix a fresh page with stale cached shared files (for
// example a new granular.js with an old shared/ui.js) and fail on load. With
// content hashes in the URLs, any changed file gets a new URL.
//
//   node scripts/stamp.js           update the stamps in place
//   node scripts/stamp.js --check   exit 1 if any stamp is missing or stale
//   node scripts/stamp.js --list    update, printing only the changed pages (one per line)
//
// The pre-commit hook runs it; tests/repo.test.js checks the result.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', 'tests', 'scripts', '.git', '.github', '.githooks', '.claude']);

// Local references to stamp: src= or href= ending in .js / .css / .svg / .ico,
// optionally already carrying ?v=…
const REF = /\b(src|href)="((?![a-z]+:|\/\/|#)[^"?#]+\.(?:js|css|svg|ico))(?:\?v=[0-9a-f]*)?"/g;

const hashFile = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);

function htmlFiles() {
  const out = [];
  if (fs.existsSync(path.join(ROOT, 'index.html'))) out.push('index.html');
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || SKIP.has(d.name) || d.name.startsWith('.')) continue;
    const f = path.join(d.name, 'index.html');
    if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  }
  return out;
}

// Returns { html, refs: [{ ref, file, hash, stale }] } for one page.
function stampHtml(html, pageFile) {
  const refs = [];
  const dir = path.dirname(path.join(ROOT, pageFile));
  const out = html.replace(REF, (whole, attr, ref) => {
    const file = path.resolve(dir, ref);
    if (!fs.existsSync(file)) { refs.push({ ref, file, hash: null, stale: true, missing: true }); return whole; }
    const hash = hashFile(file);
    const next = `${attr}="${ref}?v=${hash}"`;
    refs.push({ ref, file, hash, stale: next !== whole });
    return next;
  });
  return { html: out, refs };
}

function run(check) {
  const problems = [], changed = [];
  for (const page of htmlFiles()) {
    const full = path.join(ROOT, page);
    const html = fs.readFileSync(full, 'utf8');
    const { html: next, refs } = stampHtml(html, page);
    for (const r of refs) {
      if (r.missing) problems.push(`${page}: ${r.ref} does not exist`);
      else if (r.stale && check) problems.push(`${page}: ${r.ref} needs ?v=${r.hash}`);
    }
    if (!check && next !== html) { fs.writeFileSync(full, next); changed.push(page); }
  }
  return { problems, changed };
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const list = process.argv.includes('--list');
  const { problems, changed } = run(check);
  for (const p of problems) console.error(p);
  if (list) { for (const f of changed) console.log(f); }
  else if (!check && changed.length) console.log('stamped: ' + changed.join(', '));
  if (problems.length) {
    if (check) console.error('Run `npm run stamp` to update the cache-busting stamps.');
    process.exit(1);
  }
}

module.exports = { stampHtml, htmlFiles, hashFile, run, REF };
