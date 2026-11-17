// Unit tests for Operators' game rules (the pure part of operators/operators.js,
// which exports itself when loaded with require()).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../operators/operators.js');

// Small deterministic generator for repeatable shuffles.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Index of the card holding the current answer.
const want = (q) => M.calc(q.op, q.n, M.current(q));
const rightCard = (q) => q.cards.findIndex((c) => !c.done && M.sameValue(c.value, want(q)));
const wrongCard = (q) => q.cards.findIndex((c) => !c.done && !M.sameValue(c.value, want(q)));
const texts = (q) => q.cards.map((c) => c.value).sort((a, b) => a.num / a.den - b.num / b.den).map(M.valueText);

test('exports the rules without touching the DOM', () => {
  for (const name of ['fraction', 'calc', 'sameValue', 'valueText', 'shuffle', 'createQuiz', 'current', 'finished', 'pointsFor', 'answer', 'stars']) {
    assert.equal(typeof M[name], 'function', name);
  }
  assert.deepEqual(M.MULTIPLIERS, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(M.OP_KEYS, ['add', 'sub', 'mul', 'div']);
  assert.deepEqual(M.OP_KEYS.map((k) => M.OPS[k].symbol).join(''), '+−×÷');
});

test('fractions are kept in lowest terms with a positive denominator', () => {
  assert.deepEqual(M.fraction(6, 4), { num: 3, den: 2 });
  assert.deepEqual(M.fraction(8, 4), { num: 2, den: 1 });
  assert.deepEqual(M.fraction(0, 7), { num: 0, den: 1 });
  assert.deepEqual(M.fraction(3, -6), { num: -1, den: 2 });
  assert.ok(Object.is(M.fraction(-0, 3).num, 0), 'no negative zero');
  assert.deepEqual(['14', '−4', '7/2', '−1/2', '0'], [[14, 1], [-4, 1], [7, 2], [-1, 2], [0, 5]].map(([a, b]) => M.valueText(M.fraction(a, b))));
});

test('calc: each operator gives n op m', () => {
  assert.equal(M.valueText(M.calc('add', 7, 2)), '9');
  assert.equal(M.valueText(M.calc('sub', 7, 2)), '5');
  assert.equal(M.valueText(M.calc('sub', 3, 7)), '−4');
  assert.equal(M.valueText(M.calc('mul', 7, 2)), '14');
  assert.equal(M.valueText(M.calc('div', 7, 2)), '7/2', 'division is a fraction, not 3.5');
  assert.equal(M.valueText(M.calc('div', 6, 4)), '3/2', 'reduced');
  assert.equal(M.valueText(M.calc('div', 8, 4)), '2', 'whole when it divides');
  assert.ok(M.sameValue(M.calc('div', 6, 4), M.calc('div', 3, 2)));
  assert.ok(!M.sameValue(M.calc('div', 6, 4), M.calc('div', 6, 5)));
});

test('shuffle keeps every item, does not change the input, and is repeatable with a seed', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const a = M.shuffle(list, seeded(1));
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'input untouched');
  assert.deepEqual(a.slice().sort(), list);
  assert.deepEqual(M.shuffle(list, seeded(1)), a, 'same seed, same order');
  assert.notDeepEqual(M.shuffle(list, seeded(2)), a, 'another seed moves things');
  // rand() always 0 → each item swaps with the first: a fixed rotation.
  assert.deepEqual(M.shuffle([1, 2, 3], () => 0), [2, 3, 1]);
});

test('createQuiz: the cards hold every answer, questions cover 1–9', () => {
  const q = M.createQuiz('mul', 7, seeded(3));
  assert.deepEqual([q.op, q.n], ['mul', 7]);
  assert.deepEqual(texts(q), ['7', '14', '21', '28', '35', '42', '49', '56', '63']);
  for (const c of q.cards) assert.deepEqual(c.value, { num: 7 * c.m, den: 1 });
  assert.deepEqual(q.order.slice().sort(), M.MULTIPLIERS);
  assert.equal(M.current(q), q.order[0]);
  assert.deepEqual([q.index, q.score, q.misses, q.streak, M.finished(q)], [0, 0, 0, 0, false]);
});

test('createQuiz for each operator', () => {
  assert.deepEqual(texts(M.createQuiz('add', 7, seeded(3))), ['8', '9', '10', '11', '12', '13', '14', '15', '16']);
  assert.deepEqual(texts(M.createQuiz('sub', 4, seeded(3))), ['−5', '−4', '−3', '−2', '−1', '0', '1', '2', '3']);
  assert.deepEqual(texts(M.createQuiz('div', 6, seeded(3))), ['2/3', '3/4', '6/7', '1', '6/5', '3/2', '2', '3', '6']);
  assert.deepEqual(texts(M.createQuiz('div', 0, seeded(3))), Array(9).fill('0'));
});

test('a division round answers by fraction value', () => {
  const q = M.createQuiz('div', 7, seeded(9));
  while (!M.finished(q)) assert.equal(M.answer(q, rightCard(q)).result, 'correct');
  assert.equal(q.misses, 0);
});

test('a wrong card costs the streak and counts a miss; the right one marks the card done', () => {
  const q = M.createQuiz('mul', 7, seeded(4));
  const m = M.current(q);
  const bad = wrongCard(q);
  assert.deepEqual(M.answer(q, bad), { result: 'wrong', m });
  assert.deepEqual([q.misses, q.tries, q.streak, q.index], [1, 1, 0, 0]);
  assert.equal(q.cards[bad].done, false, 'a wrong card stays playable');

  const good = rightCard(q);
  const res = M.answer(q, good);
  assert.deepEqual(res, { result: 'correct', m, points: 5, finished: false }, 'second try is worth 5');
  assert.equal(q.cards[good].done, true);
  assert.deepEqual(q.results, ['later']);
  assert.deepEqual([q.index, q.tries, q.score], [1, 0, 5]);
  assert.deepEqual(M.answer(q, good), { result: 'ignored' }, 'a done card is ignored');
  assert.deepEqual(M.answer(q, 99), { result: 'ignored' });
});

test('points: 10 first try plus 2 per streak answer, capped at +10', () => {
  assert.equal(M.pointsFor(0, 0), 10);
  assert.equal(M.pointsFor(0, 1), 12);
  assert.equal(M.pointsFor(0, 5), 20);
  assert.equal(M.pointsFor(0, 8), 20);
  assert.equal(M.pointsFor(1, 4), 5);
  assert.equal(M.pointsFor(3, 0), 5);
});

test('a perfect round: nine first-try answers, streak 9, 150 points, then finished', () => {
  const q = M.createQuiz('mul', 9, seeded(5));
  const asked = [];
  let last;
  while (!M.finished(q)) {
    asked.push(M.current(q));
    last = M.answer(q, rightCard(q));
    assert.equal(last.result, 'correct');
  }
  assert.equal(last.finished, true);
  assert.deepEqual(asked.slice().sort(), M.MULTIPLIERS, 'every question once');
  assert.equal(q.score, 10 + 12 + 14 + 16 + 18 + 20 + 20 + 20 + 20);
  assert.deepEqual([q.streak, q.bestStreak, q.misses], [9, 9, 0]);
  assert.ok(q.cards.every((c) => c.done));
  assert.equal(M.current(q), null);
  assert.deepEqual(M.answer(q, 0), { result: 'ignored' }, 'nothing to answer after the end');
});

test('a miss mid-round resets the streak but keeps the best', () => {
  const q = M.createQuiz('mul', 3, seeded(6));
  M.answer(q, rightCard(q));
  M.answer(q, rightCard(q));
  M.answer(q, rightCard(q));
  assert.equal(q.streak, 3);
  M.answer(q, wrongCard(q));
  assert.deepEqual([q.streak, q.bestStreak], [0, 3]);
  M.answer(q, rightCard(q));
  assert.equal(q.streak, 0, 'a second-try answer does not start a streak');
  M.answer(q, rightCard(q));
  assert.equal(q.streak, 1);
  assert.deepEqual(q.results, ['first', 'first', 'first', 'later', 'first']);
});

test('the 0 table: every card is 0, so any card not yet used is right', () => {
  const q = M.createQuiz('mul', 0, seeded(7));
  assert.ok(q.cards.every((c) => c.value.num === 0));
  for (let i = 0; i < 9; i++) assert.equal(M.answer(q, i).result, 'correct');
  assert.equal(M.finished(q), true);
  assert.equal(q.misses, 0);
});

test('the 1 table has nine different answers', () => {
  const q = M.createQuiz('mul', 1, seeded(8));
  assert.equal(new Set(q.cards.map((c) => M.valueText(c.value))).size, 9);
});

test('stars: 3 with no misses, 2 with one or two, otherwise 1', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(M.stars), [3, 2, 2, 1, 1]);
});
