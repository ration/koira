'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('../server/game');
const { cards, players } = require('./helpers');

// Build a game directly in round 2 with given hands, trump suit and leader.
function round2(hands, { trump = 'H', leader = 0 } = {}) {
  const ps = players(hands.length);
  const g = new Game({ players: ps, handSize: 1, deck: cards('2S 3S 4S 5S 6S 7S 8S 9S 10S JS').slice(0, hands.length) });
  g.trump = { suit: trump, card: null, holderId: ps[leader].id };
  g.players.forEach((p, i) => {
    p.hand = [];
    p.won = cards(hands[i]);
  });
  g.trick = null;
  g.drawPile = [];
  g._startRound2();
  return g;
}

const id = (s) => cards(s)[0].id;
const ids = (s) => cards(s).map((x) => x.id);

test('leader plays any card; next must play higher', () => {
  const g = round2(['5S 9S', '4S 3D'], { trump: 'H' });
  assert.strictEqual(g.turnId, 'p0');
  g.play('p0', [id('5S')]);
  assert.throws(() => g.play('p1', [id('4S')]), GameError);
  assert.throws(() => g.play('p0', [id('9S')]), /Not your turn/);
});

test('trump beats any non-trump; higher trump required on trump', () => {
  const g = round2(['QS 9S', '2H 3D', 'KS 4H'], { trump: 'H' });
  g.play('p0', [id('QS')]);
  g.play('p1', [id('2H')]); // trump beats any non-trump
  assert.throws(() => g.play('p2', [id('KS')]), /higher trump/);
  g.play('p2', [id('4H')]);
  // 3 plays with 3 players at pile start -> discard, p2 leads
  assert.strictEqual(g.table.length, 0);
  assert.strictEqual(g.turnId, 'p2');
});

test('pickup takes the bottom-most card and passes turn', () => {
  const g = round2(['5S 9S', '4S 3D'], { trump: 'H' });
  g.play('p0', [id('5S')]);
  g.pickup('p1');
  assert.ok(g.player('p1').hand.some((x) => x.id === id('5S')));
  assert.strictEqual(g.table.length, 0);
  assert.strictEqual(g.turnId, 'p0');
});

test('straight from 2 on empty table; bottom-most card of straight is the 2', () => {
  const g = round2(['2S 3D 4C 9S', '5S 6S'], { trump: 'H' });
  g.play('p0', ids('4C 2S 3D'));
  assert.deepStrictEqual(g.table[0].cards.map((x) => x.rank), [2, 3, 4]);
  g.pickup('p1');
  assert.ok(g.player('p1').hand.some((x) => x.id === id('2S')));
  assert.deepStrictEqual(g.table[0].cards.map((x) => x.rank), [3, 4]);
});

test('straight must start at 2 and be consecutive', () => {
  const g = round2(['3S 4D 2C 6C', '5S'], { trump: 'H' });
  assert.throws(() => g.play('p0', ids('3S 4D')), /starting from 2/);
  assert.throws(() => g.play('p0', ids('2C 4D')), /starting from 2/);
});

test('straight can be continued, or beaten by a higher single card', () => {
  const g = round2(['2S 3D 9S', '4C 5C 8D', '7S 9D'], { trump: 'H' });
  g.play('p0', ids('2S 3D'));
  g.play('p1', ids('4C 5C')); // continue straight
  assert.throws(() => g.play('p2', ids('7S 9D')), GameError);
  g.play('p2', [id('7S')]); // higher single card
  // 3 plays -> discarded
  assert.strictEqual(g.table.length, 0);
  assert.strictEqual(g.firstDiscardDone, true);
});

test('final player of a discarded pile leads the next one', () => {
  const g = round2(['3S 2C 3C 4C', 'KS 5D'], { trump: 'H' });
  g.play('p0', [id('3S')]);
  g.play('p1', [id('KS')]); // discard, p1 leads
  assert.strictEqual(g.turnId, 'p1');
  g.play('p1', [id('5D')]); // p1 out
  assert.strictEqual(g.phase, 'finished');
  assert.strictEqual(g.loserId, 'p0');
});

test('straight disallowed after first discard (leader)', () => {
  const g = round2(['3S 2C 3C', 'KS 5D 6D', 'QS 8S'], { trump: 'H' });
  g.play('p0', [id('3S')]);
  g.play('p1', [id('KS')]);
  g.pickup('p2'); // picks up 3S, table has KS only
  // table now [KS], plays count stays 2; p0 plays? p0 must beat K
  assert.throws(() => g.play('p0', ids('2C 3C')), GameError);
  g.pickup('p0'); // picks up KS -> table empty
  assert.strictEqual(g.turnId, 'p1');
  g.play('p1', [id('5D')]);
  g.play('p2', [id('8S')]);
  g.play('p0', [id('KS')]); // 3 plays -> discard, p0 leads
  assert.strictEqual(g.firstDiscardDone, true);
  assert.strictEqual(g.turnId, 'p0');
  assert.throws(() => g.play('p0', ids('2C 3C')), /no longer allowed/);
});

test('pile discard threshold is fixed at pile start even if a player goes out', () => {
  const g = round2(['5S 6S', '9S', '2D 3D JS'], { trump: 'H' });
  g.play('p0', [id('5S')]);
  g.play('p1', [id('9S')]); // p1 out; threshold still 3
  assert.strictEqual(g.player('p1').out, true);
  assert.strictEqual(g.table.length, 2);
  assert.strictEqual(g.turnId, 'p2');
  g.play('p2', [id('JS')]); // 3rd play -> discard
  assert.strictEqual(g.table.length, 0);
  assert.strictEqual(g.turnId, 'p2');
});

test('player with empty hand is skipped on empty table and must pick up otherwise', () => {
  const g = round2(['5S 6S', '', '7S 8S'], { trump: 'H' });
  assert.strictEqual(g.turnId, 'p0');
  g.play('p0', [id('5S')]);
  assert.strictEqual(g.turnId, 'p1');
  assert.throws(() => g.play('p1', []), GameError);
  g.pickup('p1');
  assert.strictEqual(g.player('p1').hand.length, 1);
  assert.strictEqual(g.turnId, 'p2');
});

test('last player holding cards loses', () => {
  const g = round2(['AS', '2S 3S'], { trump: 'H' });
  g.play('p0', [id('AS')]);
  assert.strictEqual(g.phase, 'finished');
  assert.strictEqual(g.loserId, 'p1');
  assert.deepStrictEqual(g.finishOrder, ['p0']);
});

test('removing a player mid round 2 passes the turn and can end the game', () => {
  const g = round2(['5S 6S', '7S', '8S 9S'], { trump: 'H' });
  g.play('p0', [id('5S')]);
  g.removePlayer('p1');
  assert.strictEqual(g.turnId, 'p2');
  g.removePlayer('p0');
  assert.strictEqual(g.phase, 'finished');
});

test('a fully picked-up play no longer counts toward the discard threshold', () => {
  const g = round2(['5S 6S', '9S KD', '3D QS', '8C JS'], { trump: 'H' });
  g.play('p0', [id('5S')]);
  g.play('p1', [id('9S')]);
  g.pickup('p2'); // takes 5S; table [9S]
  g.play('p3', [id('JS')]); // table [9S, JS]
  g.pickup('p0'); // takes 9S; table [JS]
  g.play('p1', [id('KD')]); // 4th play overall, but only 2 in the pile (threshold 4)
  assert.strictEqual(g.table.length, 2);
  assert.strictEqual(g.turnId, 'p2');
});
