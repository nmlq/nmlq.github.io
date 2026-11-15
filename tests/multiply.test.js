// Unit tests for Multiply's game rules (the pure part of multiply/multiply.js,
// which exports itself when loaded with require()).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../multiply/multiply.js');

// Small deterministic generator for repeatable shuffles.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// Index of the card holding the current answer.
const rightCard = (q) => q.cards.findIndex((c) => !c.done && c.value === q.n * M.current(q));
const wrongCard = (q) => q.cards.findIndex((c) => !c.done && c.value !== q.n * M.current(q));

test('exports the rules without touching the DOM', () => {
  for (const name of ['shuffle', 'createQuiz', 'current', 'finished', 'pointsFor', 'answer', 'stars']) {
    assert.equal(typeof M[name], 'function', name);
  }
  assert.deepEqual(M.MULTIPLIERS, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
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

test('createQuiz: the cards hold every answer of the table, questions cover 1–9', () => {
  const q = M.createQuiz(7, seeded(3));
  assert.equal(q.n, 7);
  assert.deepEqual(q.cards.map((c) => c.value).sort((a, b) => a - b), [7, 14, 21, 28, 35, 42, 49, 56, 63]);
  for (const c of q.cards) assert.equal(c.value, 7 * c.m);
  assert.deepEqual(q.order.slice().sort(), M.MULTIPLIERS);
  assert.equal(M.current(q), q.order[0]);
  assert.deepEqual([q.index, q.score, q.misses, q.streak, M.finished(q)], [0, 0, 0, 0, false]);
});

test('a wrong card costs the streak and counts a miss; the right one marks the card done', () => {
  const q = M.createQuiz(7, seeded(4));
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
  const q = M.createQuiz(9, seeded(5));
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
  const q = M.createQuiz(3, seeded(6));
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
  const q = M.createQuiz(0, seeded(7));
  assert.ok(q.cards.every((c) => c.value === 0));
  for (let i = 0; i < 9; i++) assert.equal(M.answer(q, i).result, 'correct');
  assert.equal(M.finished(q), true);
  assert.equal(q.misses, 0);
});

test('the 1 table has nine different answers', () => {
  const q = M.createQuiz(1, seeded(8));
  assert.equal(new Set(q.cards.map((c) => c.value)).size, 9);
});

test('stars: 3 with no misses, 2 with one or two, otherwise 1', () => {
  assert.deepEqual([0, 1, 2, 3, 10].map(M.stars), [3, 2, 2, 1, 1]);
});
