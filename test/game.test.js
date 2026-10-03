'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError } = require('../server/game');
const { cards, players } = require('./helpers');

// Deal is round-robin: p0, p1, p0, p1, ...
function hand(g, id) {
  return g.player(id).hand.map((x) => x.id);
}

test('deals handSize cards round-robin; rest is draw pile', () => {
  const g = new Game({ players: players(2), handSize: 2, deck: cards('2S 3S 4S 5S 6S 7S') });
  assert.deepStrictEqual(hand(g, 'p0'), ['2S-0', '4S-0']);
  assert.deepStrictEqual(hand(g, 'p1'), ['3S-0', '5S-0']);
  assert.strictEqual(g.drawPile.length, 2);
});

test('highest card wins pile into won-pile; hands replenish', () => {
  const g = new Game({ players: players(2), handSize: 2, deck: cards('2S 3S 4S 5S 6S 7S') });
  g.playRound1('p0', '4S-0');
  assert.strictEqual(g.player('p0').won.length, 0, 'not resolved until everyone has played');
  assert.strictEqual(g.trick.pile.length, 1, 'played card is face up on the table');
  g.playRound1('p1', '3S-0');
  assert.deepStrictEqual(g.player('p0').won.map((x) => x.id).sort(), ['3S-0', '4S-0']);
  assert.strictEqual(g.player('p0').hand.length, 2);
  assert.strictEqual(g.player('p1').hand.length, 1, 'last card 7S set aside as trump, not drawn into hand');
  assert.strictEqual(g.drawPile.length, 0);
});

test('last card of deck is set aside into the last drawer\'s round 2 cards, not their hand', () => {
  const g = new Game({ players: players(2), handSize: 2, deck: cards('2S 3S 4S 5S 6S 7H') });
  g.playRound1('p0', '4S-0');
  g.playRound1('p1', '3S-0');
  // replenish in seating order: p0 draws 6S, p1 would draw 7H -> set aside
  assert.strictEqual(g.trump.suit, 'H');
  assert.strictEqual(g.trump.holderId, 'p1');
  assert.ok(!hand(g, 'p1').includes('7H-0'), 'trump card is never in a round 1 hand');
  assert.strictEqual(g.player('p1').hand.length, 1, 'holder plays round 1 one card short');
  assert.ok(g.player('p1').won.some((x) => x.id === '7H-0'));
});

test('trump set aside at deal time if deck runs out during deal', () => {
  const g = new Game({ players: players(2), handSize: 2, deck: cards('2S 3S 4S 5D') });
  assert.strictEqual(g.trump.suit, 'D');
  assert.strictEqual(g.trump.holderId, 'p1');
  assert.deepStrictEqual(hand(g, 'p1'), ['3S-0']);
});

test('trump card is hidden from every view, including its holder, until round 1 ends', () => {
  const g = new Game({ players: players(2), handSize: 1, deck: cards('2S 3S 4S 5H') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '3S-0'); // p0 draws 4S, p1 gets 5H set aside
  for (const id of ['p0', 'p1']) {
    const v = g.view(id);
    assert.strictEqual(v.trump, null);
    assert.strictEqual(v.trumpSetAside, true);
    assert.ok(!JSON.stringify(v).includes('5H-0'), `${id} cannot see the trump card`);
  }
  // Counts include the hidden card, so nobody can tell who holds it.
  assert.strictEqual(g.view('p1').players.find((p) => p.id === 'p1').wonCount, 3);
  assert.strictEqual(g.view('p1').myWon.length, 2);
  // p1 has no cards left in hand; p0 plays the final trick alone and round 2 starts.
  assert.strictEqual(g.turnId, 'p0');
  g.playRound1('p0', '4S-0');
  const v = g.view('p0');
  assert.strictEqual(v.phase, 'round2');
  assert.strictEqual(v.trump.card.id, '5H-0');
  assert.strictEqual(v.trump.holderId, 'p1');
  assert.strictEqual(v.turnId, 'p1', 'trump holder leads round 2');
  assert.ok(g.player('p1').hand.some((x) => x.id === '5H-0'));
});

test('ties: tied players play again into same pile; winner takes all', () => {
  const g = new Game({ players: players(3), handSize: 2, deck: cards('9S 9H 2C KS 3D 4D') });
  g.playRound1('p0', '9S-0');
  g.playRound1('p1', '9H-0');
  g.playRound1('p2', '2C-0');
  assert.deepStrictEqual(g.trick.pending, ['p0', 'p1']);
  assert.throws(() => g.playRound1('p2', '4D-0'), /Not your turn/);
  g.playRound1('p0', '13S-0');
  g.playRound1('p1', '3D-0');
  // 4D was set aside as trump, so round 1 is now over: check the trick, not the won-pile.
  assert.strictEqual(g.lastTrick.winnerId, 'p0');
  assert.strictEqual(g.lastTrick.reveals.flat().length, 5);
});

test('players play in turn; out-of-turn play is rejected', () => {
  const g = new Game({ players: players(3), handSize: 1, deck: cards('2S 3S 4S 5S 6S 7S') });
  assert.strictEqual(g.turnId, 'p0');
  assert.throws(() => g.playRound1('p1', '3S-0'), /Not your turn/);
  g.playRound1('p0', '2S-0');
  assert.strictEqual(g.turnId, 'p1');
});

test('trick winner leads the next trick', () => {
  const g = new Game({ players: players(3), handSize: 1, deck: cards('2S 9S 4S 5S 6S 7S') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '9S-0');
  g.playRound1('p2', '4S-0');
  assert.strictEqual(g.player('p1').won.length, 3);
  assert.strictEqual(g.turnId, 'p1');
});

test('round 1 ends when draw pile and hands empty; won-pile becomes hand', () => {
  const g = new Game({ players: players(2), handSize: 1, deck: cards('2S 3S 4S 5S 6H') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '3S-0'); // p1 wins 2; draws: p0 4S, p1 5S
  g.playRound1('p1', '5S-0'); // p1 won the last trick, so leads
  g.playRound1('p0', '4S-0'); // p1 wins 2; refill in seat order: p0 gets 6H set aside as trump
  assert.strictEqual(g.phase, 'round2');
  assert.deepStrictEqual(g.player('p0').hand.map((x) => x.id), ['6H-0']);
  assert.strictEqual(g.player('p1').hand.length, 4);
  assert.strictEqual(g.turnId, 'p0', 'trump holder leads round 2');
});

test('round 2 starts with trump holder, not the last trick winner', () => {
  const g = new Game({ players: players(3), handSize: 1, deck: cards('2S 3S 4S 5S 9S 7H') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '3S-0');
  g.playRound1('p2', '4S-0'); // p2 wins; draws p0 5S, p1 9S, p2 7H set aside as trump
  assert.strictEqual(g.turnId, 'p0', 'p2 has no hand, so the next player with cards leads');
  g.playRound1('p0', '5S-0');
  g.playRound1('p1', '9S-0'); // p1 wins the last trick
  assert.strictEqual(g.phase, 'round2');
  assert.strictEqual(g.trump.holderId, 'p2');
  assert.strictEqual(g.turnId, 'p2');
});

test('removing the player whose turn it is resolves the trick', () => {
  const g = new Game({ players: players(3), handSize: 1, deck: cards('2S 3S 4S 5S 6S 7S 8S') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '3S-0');
  g.removePlayer('p2');
  assert.strictEqual(g.player('p1').won.length, 2);
});

test("view never reveals other players' won cards", () => {
  const g = new Game({ players: players(2), handSize: 1, deck: cards('2S 3S 4S 5S 6H') });
  g.playRound1('p0', '2S-0');
  g.playRound1('p1', '3S-0'); // p1 wins 2S 3S
  const v0 = g.view('p0');
  // The trick itself was played face up (lastTrick); nothing else may carry p1's won cards.
  assert.ok(!JSON.stringify({ ...v0, lastTrick: null, log: [] }).includes('"3S-0"'));
  assert.deepStrictEqual(v0.myWon, []);
  assert.strictEqual(v0.players.find((p) => p.id === 'p1').wonCount, 2);
  assert.strictEqual(v0.players.find((p) => p.id === 'p1').won, undefined);
  assert.strictEqual(g.view('p1').myWon.length, 2);
  g.playRound1('p1', '5S-0');
  g.playRound1('p0', '4S-0'); // round 2: p1 has 4 won cards, p0 has the trump 6H
  const r2 = g.view('p0');
  assert.strictEqual(r2.phase, 'round2');
  assert.deepStrictEqual(r2.myRound1Won.map((x) => x.id), ['6H-0']);
  assert.deepStrictEqual(r2.round1WonCounts, { p0: 1, p1: 4 });
  assert.ok(!JSON.stringify({ ...r2, log: [], lastTrick: null }).includes('"2S-0"'), "p1's round 2 hand not leaked");
});
