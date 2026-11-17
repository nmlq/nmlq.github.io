// Operators: an arithmetic game for kids (+, −, ×, ÷).
//
// Pick an operator and a number from 0 to 9, then:
//  - Review: a 3 × 3 grid of cards 1–9. Tapping a card flips it over for a
//    moment to show the answer (7 × 2 → 14, 7 ÷ 2 → 7/2) and plays a note.
//  - Answer: the same grid holds every answer (7 + 1 … 7 + 9, or 7 ÷ 1 …
//    7 ÷ 9) in random places. The game asks the nine questions in random
//    order; tap the right answer. Right = the card goes green with a high
//    beep, wrong = it goes red with a low beep. When all nine are done every
//    card flashes green with three beeps, and you get up to three stars.
//
// Answers are exact fractions { num, den } in lowest terms: division shows
// 7/2, never 3.5. Subtraction can go below zero (3 − 7 = −4).
//
// Points: 10 for a first-try answer plus 2 per answer in the current streak
// (up to +10), 5 if it took more than one try. Best stars per operator and
// number and the total of all points are saved in the browser.
//
// Sound: beeps and notes are the shared subtractive synth voice
// (nmlq.audio.createSynth), with a few of its settings on the Sound screen.
//
// The game rules at the top are pure (no DOM, no audio) and are exported for
// Node when loaded with require(), so tests/operators.test.js can check them.
(function (root) {
  'use strict';

  // ---------- game rules (pure) ----------

  const MULTIPLIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9]; // the second number, 1–9

  // Each operator gives the answer to n ? m as [numerator, denominator].
  const OPS = {
    add: { symbol: '+', word: 'plus', calc: (n, m) => [n + m, 1] },
    sub: { symbol: '−', word: 'minus', calc: (n, m) => [n - m, 1] },
    mul: { symbol: '×', word: 'times', calc: (n, m) => [n * m, 1] },
    div: { symbol: '÷', word: 'divided by', calc: (n, m) => [n, m] },
  };
  const OP_KEYS = Object.keys(OPS);

  function gcd(a, b) {
    a = Math.abs(a); b = Math.abs(b);
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }
  // A fraction in lowest terms with a positive denominator.
  function fraction(num, den) {
    if (den < 0) { num = -num; den = -den; }
    const g = gcd(num, den);
    return { num: num / g + 0, den: den / g }; // + 0 turns -0 into 0
  }
  const calc = (op, n, m) => fraction(...OPS[op].calc(n, m));
  const sameValue = (a, b) => a.num === b.num && a.den === b.den;
  // Plain text: "14", "−4", "7/2".
  const valueText = (v) => (v.num < 0 ? '−' : '') + Math.abs(v.num) + (v.den === 1 ? '' : '/' + v.den);

  // Fisher–Yates; `rand` () -> [0, 1) can be seeded for tests.
  function shuffle(list, rand) {
    rand = rand || Math.random;
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // One round of Answer mode for `n op m`, m = 1–9.
  function createQuiz(op, n, rand) {
    return {
      op,
      n,
      cards: shuffle(MULTIPLIERS, rand).map((m) => ({ m, value: calc(op, n, m), done: false })),
      order: shuffle(MULTIPLIERS, rand), // the questions, n op order[i]
      index: 0,      // current question
      tries: 0,      // wrong answers to the current question
      misses: 0,     // wrong answers this round
      streak: 0,     // first-try answers in a row
      bestStreak: 0,
      score: 0,
      results: [],   // per question: 'first' (first try) or 'later'
    };
  }

  const finished = (q) => q.index >= q.order.length;
  const current = (q) => (finished(q) ? null : q.order[q.index]);

  // Points for a right answer, given wrong tries and the streak before it.
  const pointsFor = (tries, streak) => (tries === 0 ? 10 + Math.min(streak, 5) * 2 : 5);

  // Tap card `i`: { result: 'correct' | 'wrong' | 'ignored', m, points, finished }.
  function answer(q, i) {
    const card = q.cards[i];
    if (finished(q) || !card || card.done) return { result: 'ignored' };
    const m = current(q);
    if (!sameValue(card.value, calc(q.op, q.n, m))) {
      q.tries++;
      q.misses++;
      q.streak = 0;
      return { result: 'wrong', m };
    }
    const points = pointsFor(q.tries, q.streak);
    card.done = true;
    q.score += points;
    q.results.push(q.tries === 0 ? 'first' : 'later');
    if (q.tries === 0) {
      q.streak++;
      q.bestStreak = Math.max(q.bestStreak, q.streak);
    }
    q.tries = 0;
    q.index++;
    return { result: 'correct', m, points, finished: finished(q) };
  }

  // Stars for a finished round.
  const stars = (misses) => (misses === 0 ? 3 : misses <= 2 ? 2 : 1);

  const rules = { MULTIPLIERS, OPS, OP_KEYS, fraction, calc, sameValue, valueText, shuffle, createQuiz, current, finished, pointsFor, answer, stars };
  if (typeof module === 'object' && module.exports && !root.document) {
    module.exports = rules;
    return;
  }

  // ---------- page ----------

  const N = window.nmlq;
  const { fmt } = N;
  const STORAGE_KEY = 'nmlq-operators-v1';
  const OLD_KEY = 'nmlq-multiply-v1'; // progress from the times-table-only version;
  const $ = (id) => document.getElementById(id);

  // ---------- sound parameters ----------
  // A short, bright beep by default; a few of the synth voice settings are
  // on the Sound screen, the rest keep these defaults.
  const VOICE = N.synthVoiceGroups({
    osc1Wave: 'square', osc1Level: 60, osc2Wave: 'triangle', osc2Level: 30,
    cutoff: 3500, resonance: 10, filterEnvAmt: 25, keyTrack: 60,
    attack: 2, decay: 160, sustain: 45, release: 140,
  }).flatMap((g) => g.params);
  const voiceDef = (key) => VOICE.find((d) => d.key === key);
  const SOUND_GROUPS = [
    { title: 'Tone', params: ['osc1Wave', 'osc2Wave', 'osc2Level', 'cutoff', 'resonance'].map(voiceDef) },
    { title: 'Envelope', params: ['attack', 'decay', 'sustain', 'release'].map(voiceDef) },
    {
      title: 'Output', params: [
        { key: 'volume', label: 'Volume', min: 0, max: 100, step: 1, value: 70, format: fmt.pct },
        { key: 'reverb', label: 'Reverb', min: 0, max: 100, step: 1, value: 12, format: fmt.pct },
      ],
    },
  ];
  const HIDDEN = [{ key: 'reverbSize', label: 'Reverb length', min: 0.3, max: 8, step: 0.1, value: 1.5 }];
  const DEFS = [...VOICE, ...SOUND_GROUPS[2].params, ...HIDDEN];

  const params = {};
  // stars: { op: { number: best stars } }
  const progress = { op: 'mul', stars: { add: {}, sub: {}, mul: {}, div: {} }, total: 0 };

  function readStars(from, into) {
    if (!from || typeof from !== 'object') return;
    for (let n = 0; n <= 9; n++) {
      const s = from[n];
      if (Number.isInteger(s) && s >= 1 && s <= 3) into[n] = s;
    }
  }

  function loadSettings() {
    N.loadDefaults(DEFS, params);
    let saved = N.loadJSON(STORAGE_KEY);
    const old = !saved && N.loadJSON(OLD_KEY);
    if (old && typeof old === 'object') saved = { ...old, stars: { mul: old.stars } };
    if (!saved || typeof saved !== 'object') return;
    N.restoreParams(DEFS, params, saved);
    if (OP_KEYS.includes(saved.op)) progress.op = saved.op;
    if (Number.isInteger(saved.total) && saved.total >= 0) progress.total = saved.total;
    if (saved.stars && typeof saved.stars === 'object') {
      for (const op of OP_KEYS) readStars(saved.stars[op], progress.stars[op]);
    }
  }
  const saveSettings = () => N.saveJSON(STORAGE_KEY, Object.assign({}, params, progress));

  // ---------- audio ----------

  const A = { ctx: null, synth: null };

  function ensureAudio() {
    if (!A.ctx) {
      const ac = N.audio.createContext();
      if (!ac || !ac.createConstantSource) return null;
      A.ctx = ac;
      A.space = N.audio.createSpace(ac, params.reverbSize);
      A.master = ac.createGain();
      A.synth = N.audio.createSynth(ac, { output: A.space.input, params });
      A.space.output.connect(A.master).connect(N.audio.compressor(ac, { threshold: -14, knee: 10 })).connect(ac.destination);
      applyGlobal(true);
    }
    return N.audio.resume(A.ctx);
  }

  function applyGlobal(immediate) {
    if (!A.ctx) return;
    N.audio.setParam(A.ctx, A.master.gain, (params.volume / 100) * 0.9, immediate);
    A.space.set({ reverb: params.reverb / 100, echo: 0, echoTime: 0.3, echoFeedback: 0 }, immediate);
    A.synth.applyGlobal(immediate);
  }

  function beep(note, seconds) {
    if (ensureAudio()) A.synth.play(note, seconds, 8);
  }
  // Review notes climb a C major scale from C5, one per card.
  const SCALE = [72, 74, 76, 77, 79, 81, 83, 84, 86];
  const HIGH = 84, LOW = 45, CHEER = [84, 84, 91];

  // ---------- screens ----------

  const S = { screen: 'select', op: 'mul', n: null, quiz: null, busy: false, timers: [] };
  const later = (ms, fn) => { S.timers.push(setTimeout(fn, ms)); };
  function cancelTimers() {
    for (const t of S.timers) clearTimeout(t);
    S.timers = [];
  }

  function show(screen) {
    cancelTimers();
    S.busy = false;
    S.screen = screen;
    document.body.dataset.screen = screen;
    for (const name of ['select', 'review', 'answer']) $(name + '-screen').hidden = name !== screen;
    $('go-review').setAttribute('aria-pressed', String(screen === 'review'));
    $('go-answer').setAttribute('aria-pressed', String(screen === 'answer'));
    if (screen === 'select') renderDigits();
    else if (screen === 'review') renderReview();
    else startQuiz();
  }

  function starText(count) {
    let html = '';
    for (let i = 0; i < 3; i++) html += i < count ? '★' : '<span class="off">★</span>';
    return html;
  }

  function updateTotal() { $('total').textContent = '★ ' + progress.total; }

  // HTML for an answer: whole numbers as text, fractions stacked.
  function valueHTML(v) {
    if (v.den === 1) return valueText(v);
    return '<span class="frac" aria-label="' + valueText(v) + '"><span>' + (v.num < 0 ? '−' : '') + Math.abs(v.num)
      + '</span><span>' + v.den + '</span></span>';
  }
  const sym = (op) => OPS[op].symbol;

  // ---------- selection ----------

  const opEls = {};
  for (const op of OP_KEYS) {
    const b = document.createElement('button');
    b.className = 'op';
    b.dataset.op = op;
    b.textContent = sym(op);
    b.setAttribute('aria-label', OPS[op].word);
    b.addEventListener('click', () => pickOp(op));
    $('ops').appendChild(b);
    opEls[op] = b;
  }

  function pickOp(op) {
    if (progress.op === op) return;
    progress.op = op;
    saveSettings();
    beep(SCALE[OP_KEYS.indexOf(op) * 2], 0.12);
    renderDigits();
  }

  const digitEls = [];
  for (let n = 0; n <= 9; n++) {
    const b = document.createElement('button');
    b.className = 'digit';
    b.style.setProperty('--hue', String(n * 36));
    b.dataset.n = String(n);
    b.innerHTML = '<span>' + n + '</span><span class="stars"></span>';
    b.addEventListener('click', () => pick(n));
    $('digits').appendChild(b);
    digitEls.push(b);
  }

  function renderDigits() {
    const op = progress.op;
    $('select-prompt').textContent = sym(op);
    for (const k of OP_KEYS) opEls[k].setAttribute('aria-pressed', String(k === op));
    const stars = progress.stars[op];
    digitEls.forEach((b, n) => {
      b.setAttribute('aria-label', n + ' ' + OPS[op].word);
      b.querySelector('.stars').innerHTML = stars[n] ? starText(stars[n]) : '';
    });
  }

  function pick(n) {
    S.n = n;
    S.op = progress.op;
    beep(SCALE[Math.max(0, n - 1)], 0.15);
    show('review');
  }

  // ---------- tiles ----------

  function makeTile(front, back, hue, label, value) {
    const b = document.createElement('button');
    b.className = 'tile';
    b.setAttribute('aria-label', label);
    b.innerHTML = '<span class="inner"><span class="face front"></span><span class="face back"></span></span>';
    b.querySelector('.front').innerHTML = front;
    if (value) b.dataset.value = value;
    if (back) b.querySelector('.back').innerHTML = back;
    b.style.setProperty('--hue', String(hue));
    return b;
  }

  // ---------- review ----------

  const question = (m) => S.n + ' ' + sym(S.op) + ' ' + m;
  const reviewPrompt = () => S.n + ' ' + sym(S.op) + ' <span class="q">?</span>';

  function renderReview() {
    $('review-prompt').innerHTML = reviewPrompt();
    const grid = $('review-grid');
    grid.textContent = '';
    for (const m of MULTIPLIERS) {
      const v = calc(S.op, S.n, m);
      const tile = makeTile(String(m), '<small>' + question(m) + '</small>' + valueHTML(v), m * 40,
        S.n + ' ' + OPS[S.op].word + ' ' + m, valueText(v));
      tile.addEventListener('click', () => flip(tile, m));
      grid.appendChild(tile);
    }
  }

  function flip(tile, m) {
    for (const t of $('review-grid').children) if (t !== tile) t.classList.remove('flipped');
    tile.classList.add('flipped');
    $('review-prompt').innerHTML = question(m) + ' = <span class="q">' + valueHTML(calc(S.op, S.n, m)) + '</span>';
    beep(SCALE[m - 1], 0.3);
    clearTimeout(S.flipTimer);
    S.flipTimer = setTimeout(() => {
      tile.classList.remove('flipped');
      $('review-prompt').innerHTML = reviewPrompt();
    }, 1400);
  }

  // ---------- answer ----------

  function startQuiz() {
    S.quiz = createQuiz(S.op, S.n);
    $('result').hidden = true;
    const grid = $('answer-grid');
    grid.textContent = '';
    S.quiz.cards.forEach((c, i) => {
      const text = valueText(c.value);
      const tile = makeTile(valueHTML(c.value), null, 215, text, text);
      tile.addEventListener('click', () => choose(i));
      grid.appendChild(tile);
    });
    renderQuiz();
  }

  function renderQuiz(solved) {
    const q = S.quiz;
    const m = solved || current(q);
    $('answer-prompt').innerHTML = m == null ? 'All done!'
      : question(m) + ' = <span class="q">' + (solved ? valueHTML(calc(q.op, q.n, m)) : '?') + '</span>';
    $('progress').innerHTML = q.order.map((om, i) => {
      if (i < q.results.length) return '<span class="' + q.results[i] + '">' + om + '</span>';
      return '<span class="' + (i === q.index ? 'now' : '') + '"></span>';
    }).join('');
    $('score').textContent = String(q.score);
    $('streak').textContent = String(q.streak);
    $('misses').textContent = String(q.misses);
  }

  function choose(i) {
    if (S.busy) return;
    const tile = $('answer-grid').children[i];
    const res = answer(S.quiz, i);
    if (res.result === 'wrong') {
      tile.classList.remove('bad');
      void tile.offsetWidth; // restart the shake
      tile.classList.add('bad');
      beep(LOW, 0.3);
      later(600, () => tile.classList.remove('bad'));
      renderQuiz();
    } else if (res.result === 'correct') {
      tile.classList.add('good', 'done');
      beep(HIGH, 0.12);
      S.busy = true;
      renderQuiz(res.m);
      later(550, () => {
        tile.classList.remove('good');
        if (res.finished) celebrate();
        else { S.busy = false; renderQuiz(); }
      });
    }
  }

  // Every card flashes green with three beeps, then the result.
  function celebrate() {
    const q = S.quiz;
    const tiles = [...$('answer-grid').children];
    CHEER.forEach((note, k) => {
      later(k * 380, () => {
        for (const t of tiles) t.classList.add('flash');
        beep(note, k === 2 ? 0.4 : 0.15);
      });
      later(k * 380 + 220, () => { for (const t of tiles) t.classList.remove('flash'); });
    });
    later(3 * 380 + 100, () => {
      const got = stars(q.misses);
      const best = progress.stars[q.op];
      best[q.n] = Math.max(best[q.n] || 0, got);
      progress.total += q.score;
      saveSettings();
      updateTotal();
      renderQuiz();
      $('result-stars').innerHTML = starText(got);
      $('result-text').textContent = (got === 3 ? 'Perfect! ' : got === 2 ? 'Great job! ' : 'Well done! ')
        + q.score + ' points' + (q.misses ? ', ' + q.misses + (q.misses === 1 ? ' miss' : ' misses') : '');
      $('result').hidden = false;
      S.busy = false;
      $('again').focus({ preventScroll: true });
    });
  }

  // ---------- buttons and keys ----------

  $('go-select').addEventListener('click', () => show('select'));
  $('go-review').addEventListener('click', () => show('review'));
  $('go-answer').addEventListener('click', () => show('answer'));
  $('review-to-answer').addEventListener('click', () => show('answer'));
  $('again').addEventListener('click', () => show('answer'));
  $('result-review').addEventListener('click', () => show('review'));
  $('result-select').addEventListener('click', () => show('select'));

  window.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.repeat || e.metaKey || e.ctrlKey || e.altKey || N.isTypingTarget(e.target)) return;
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    const opKey = { '+': 'add', '-': 'sub', '*': 'mul', x: 'mul', X: 'mul', '/': 'div' }[e.key];
    if (opKey && S.screen === 'select') {
      pickOp(opKey);
      e.preventDefault();
    } else if (m && !e.shiftKey) {
      const d = Number(m[1]);
      if (S.screen === 'select') pick(d);
      else if (d >= 1) $(S.screen + '-grid').children[d - 1].click();
      e.preventDefault();
    } else if (e.code === 'Escape' && S.screen !== 'select') {
      show('select');
    }
  });

  // ---------- sound screen ----------

  let soundPanel = null;
  const VOICE_KEYS = new Set(N.SYNTH_VOICE_KEYS);

  function onInput(key, v) {
    params[key] = v;
    if (A.ctx) {
      if (VOICE_KEYS.has(key)) A.synth.configureAll();
      else if (key === 'volume' || key === 'reverb') applyGlobal();
    }
    saveSettings();
  }

  const soundBtn = $('show-sound');
  soundBtn.addEventListener('click', () => {
    $('sound').hidden = !$('sound').hidden;
    soundBtn.setAttribute('aria-pressed', String(!$('sound').hidden));
    if (!$('sound').hidden) $('sound').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    soundBtn.blur();
  });

  $('defaults').addEventListener('click', () => {
    N.loadDefaults(DEFS, params);
    soundPanel.sync(params);
    if (A.ctx) { A.synth.configureAll(); applyGlobal(); }
    saveSettings();
    beep(HIGH, 0.12);
  });

  // ---------- start ----------

  N.audio.installUnlock({ ensure: ensureAudio, current: () => A.ctx });

  loadSettings();
  soundPanel = N.ui.buildKnobGroups($('sound-groups'), SOUND_GROUPS, { values: params, onInput });
  updateTotal();
  show('select');
})(typeof self !== 'undefined' ? self : this);
