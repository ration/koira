'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createDeck, shuffle, cardLabel } = require('../server/cards');

test('deck has 52 unique cards with ranks 2-14', () => {
  const deck = createDeck();
  assert.strictEqual(deck.length, 52);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, 52);
  assert.ok(deck.every((c) => c.rank >= 2 && c.rank <= 14));
});

test('multi-deck ids stay unique', () => {
  const deck = createDeck(2);
  assert.strictEqual(new Set(deck.map((c) => c.id)).size, 104);
});

test('shuffle keeps all cards', () => {
  const deck = createDeck();
  const s = shuffle(deck);
  assert.deepStrictEqual([...s].map((c) => c.id).sort(), deck.map((c) => c.id).sort());
});

test('labels', () => {
  assert.strictEqual(cardLabel({ rank: 14, suit: 'S' }), 'A♠');
  assert.strictEqual(cardLabel({ rank: 10, suit: 'H' }), '10♥');
});
