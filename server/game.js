'use strict';

// Pure Koira game engine. No I/O: callers feed intents, read personalized views.
// Rules: see README.md.

const { createDeck, shuffle, cardLabel, rankName } = require('./cards');

class GameError extends Error {}

const MAX_LOG = 30;

class Game {
  /**
   * @param {object} opts
   * @param {{id: string, name: string}[]} opts.players  seating order
   * @param {number} [opts.handSize=3]
   * @param {number} [opts.decks=1]
   * @param {object[]} [opts.deck]  pre-ordered deck (tests); index 0 is drawn first
   */
  constructor({ players, handSize = 3, decks = 1, deck }) {
    if (!players || players.length < 2) throw new GameError('Need at least 2 players');
    if (players.length > 10) throw new GameError('At most 10 players');
    this.handSize = handSize;
    this.players = players.map((p, seat) => ({
      id: p.id,
      name: p.name,
      seat,
      hand: [],
      won: [],
      out: false, // emptied hand in round 2 (safe)
      removed: false, // left / disconnected
    }));
    this.drawPile = deck ? [...deck] : shuffle(createDeck(decks));
    this.phase = 'round1';
    this.trump = null; // { suit, card, holderId }; hidden from views until round 2
    this.log = [];
    this.finishOrder = [];
    this.loserId = null;

    // Round 1 trick state
    this.trick = null; // { pile: [], pending: [ids], reveals: [[{playerId, card}]] }
    this.lastTrick = null; // { reveals, winnerId }
    this.tricksPlayed = 0;
    this.round1Won = null; // { playerId: cards } snapshot of won-piles when round 2 starts

    // Round 2 state
    this.table = []; // plays: { playerId, cards: [], straight: bool }
    this.pileStartCount = 0; // plays needed to discard the current pile
    this.firstDiscardDone = false;
    this.discardCount = 0;
    this.turnId = null;

    this._deal();
    this._startTrick();
  }

  // ---------- helpers ----------

  player(id) {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new GameError('Unknown player');
    return p;
  }

  _active() {
    return this.players.filter((p) => !p.out && !p.removed);
  }

  _addLog(msg) {
    this.log.push(msg);
    if (this.log.length > MAX_LOG) this.log.shift();
  }

  _draw(p) {
    const card = this.drawPile.shift();
    if (this.drawPile.length === 0) {
      // The last card is the trump card: put aside, face down, straight into the drawer's
      // round 2 hand. Nobody sees it until round 1 ends.
      this.trump = { suit: card.suit, card, holderId: p.id };
      p.won.push(card);
      this._addLog('The last card of the deck is put aside as the trump card');
      return;
    }
    p.hand.push(card);
  }

  _deal() {
    for (let i = 0; i < this.handSize; i++) {
      for (const p of this.players) {
        if (this.drawPile.length === 0) return;
        this._draw(p);
      }
    }
  }

  _takeFromHand(p, cardId) {
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new GameError('Card not in hand');
    return p.hand.splice(idx, 1)[0];
  }

  // ---------- round 1 ----------

  // Trick order: active players holding cards, in seating order starting from the leader.
  _startTrick(leaderId) {
    const n = this.players.length;
    const leaderSeat = leaderId ? this.player(leaderId).seat : 0;
    const order = [];
    for (let i = 0; i < n; i++) {
      const p = this.players[(leaderSeat + i) % n];
      if (!p.out && !p.removed && p.hand.length > 0) order.push(p.id);
    }
    if (order.length === 0) {
      this._startRound2();
      return;
    }
    // pending: players still to play this pass; reveals: one row of plays per pass.
    this.trick = { pile: [], pending: order, reveals: [[]] };
    this.turnId = order[0];
  }

  playRound1(playerId, cardId) {
    if (this.phase !== 'round1') throw new GameError('Not in round 1');
    if (this.turnId !== playerId) throw new GameError('Not your turn');
    const p = this.player(playerId);
    const card = this._takeFromHand(p, cardId);
    const t = this.trick;
    t.pile.push(card);
    t.reveals[t.reveals.length - 1].push({ playerId, card });
    t.pending.shift();
    this._addLog(`${p.name} plays ${cardLabel(card)}`);
    this._advanceTrick();
  }

  _advanceTrick() {
    const t = this.trick;
    if (t.pending.length > 0) {
      this.turnId = t.pending[0];
      return;
    }

    const pass = t.reveals[t.reveals.length - 1].filter((r) => !this.player(r.playerId).removed);
    if (pass.length === 0) {
      // Everyone in this pass left: earliest remaining player in the trick takes the pile.
      const remaining = t.reveals.flat().map((r) => r.playerId).filter((id) => !this.player(id).removed);
      if (remaining.length) this._awardTrick(remaining[0]);
      else {
        this._replenish();
        this._startTrick();
      }
      return;
    }
    const max = Math.max(...pass.map((r) => r.card.rank));
    const tied = pass.filter((r) => r.card.rank === max).map((r) => r.playerId);

    if (tied.length === 1) {
      this._awardTrick(tied[0]);
      return;
    }

    // Tie: tied players play again into the same pile, in the order they played. A tied
    // player with an empty hand draws from the draw pile if possible; otherwise they drop out.
    this._addLog(`Tie on ${rankName(max)} — ${tied.map((id) => this.player(id).name).join(', ')} play again`);
    for (const id of tied) {
      const p = this.player(id);
      if (p.hand.length === 0 && this.drawPile.length > 0) this._draw(p);
    }
    const next = tied.filter((id) => this.player(id).hand.length > 0);
    if (next.length === 0) {
      // Nobody can break the tie: the first tied player takes the pile.
      this._awardTrick(tied[0]);
      return;
    }
    t.pending = next;
    t.reveals.push([]);
    this.turnId = next[0];
  }

  _awardTrick(winnerId) {
    const w = this.player(winnerId);
    w.won.push(...this.trick.pile);
    this._addLog(`${w.name} wins ${this.trick.pile.length} card(s)`);
    this.lastTrick = { reveals: this.trick.reveals, winnerId };
    this.tricksPlayed++;
    this._replenish();
    this._startTrick(winnerId);
  }

  _replenish() {
    let drew = true;
    while (drew && this.drawPile.length > 0) {
      drew = false;
      for (const p of this._active()) {
        if (this.drawPile.length === 0) break;
        if (p.hand.length < this.handSize) {
          this._draw(p);
          drew = true;
        }
      }
    }
  }

  // ---------- round 2 ----------

  _startRound2() {
    this.phase = 'round2';
    this.trick = null;
    this.round1Won = Object.fromEntries(this.players.filter((p) => !p.removed).map((p) => [p.id, [...p.won]]));
    for (const p of this.players) {
      if (p.removed) continue;
      p.hand = p.won;
      p.won = [];
    }
    if (this.trump && this.trump.card) {
      this._addLog(`Trump card revealed: ${cardLabel(this.trump.card)} — ${this.player(this.trump.holderId).name} has it`);
    }
    this._addLog('Round 2 begins');
    if (this._checkGameOver()) return;
    const holder = this.trump && this.players.find((p) => p.id === this.trump.holderId);
    this._setTurnFrom(holder ? holder.seat : 0, true);
  }

  _tableCards() {
    return this.table.flatMap((pl) => pl.cards);
  }

  _top() {
    const last = this.table[this.table.length - 1];
    return last ? last.cards[last.cards.length - 1] : null;
  }

  _isTrump(card) {
    return this.trump && card.suit === this.trump.suit;
  }

  // Set the turn to the first active player (starting at seat, optionally inclusive)
  // who can act: anyone with cards, or anyone if there are cards on the table to pick up.
  _setTurnFrom(seat, inclusive) {
    const n = this.players.length;
    const tableHasCards = this.table.length > 0;
    for (let i = inclusive ? 0 : 1; i <= n; i++) {
      const p = this.players[(seat + i) % n];
      if (p.out || p.removed) continue;
      if (p.hand.length > 0 || tableHasCards) {
        this.turnId = p.id;
        return;
      }
    }
    // Nobody can act (should not happen while ≥2 active players hold cards).
    this._finish(null);
  }

  /** Classify a proposed play. Returns 'single' | 'straight' | 'continue' or throws. */
  classifyPlay(cards) {
    if (cards.length === 0) throw new GameError('No cards selected');
    const sorted = [...cards].sort((a, b) => a.rank - b.rank);
    const consecutiveFrom = (start) => sorted.every((c, i) => c.rank === start + i);
    const top = this._top();
    const lastPlay = this.table[this.table.length - 1];

    if (!top) {
      if (cards.length === 1) return 'single';
      if (this.firstDiscardDone) throw new GameError('Straights are no longer allowed');
      if (!consecutiveFrom(2)) throw new GameError('A straight must be consecutive cards starting from 2');
      return 'straight';
    }

    if (lastPlay.straight && !this.firstDiscardDone && consecutiveFrom(top.rank + 1)) {
      return 'continue';
    }
    if (cards.length > 1) throw new GameError('You can only play one card here');

    const c = cards[0];
    if (this._isTrump(top)) {
      if (this._isTrump(c) && c.rank > top.rank) return 'single';
      throw new GameError(`Must play a higher trump than ${cardLabel(top)}`);
    }
    if (c.rank > top.rank || this._isTrump(c)) return 'single';
    throw new GameError(`Must play higher than ${cardLabel(top)} or a trump`);
  }

  play(playerId, cardIds) {
    if (this.phase !== 'round2') throw new GameError('Not in round 2');
    if (this.turnId !== playerId) throw new GameError('Not your turn');
    const p = this.player(playerId);
    if (!Array.isArray(cardIds) || new Set(cardIds).size !== cardIds.length) {
      throw new GameError('Invalid cards');
    }
    const cards = cardIds.map((id) => {
      const c = p.hand.find((h) => h.id === id);
      if (!c) throw new GameError('Card not in hand');
      return c;
    });
    const kind = this.classifyPlay(cards);
    for (const id of cardIds) this._takeFromHand(p, id);
    cards.sort((a, b) => a.rank - b.rank);

    if (this.table.length === 0) this.pileStartCount = this._active().length;
    this.table.push({ playerId, cards, straight: kind !== 'single' });
    const verb = kind === 'continue' ? 'continues the straight with' : 'plays';
    this._addLog(`${p.name} ${verb} ${cards.map(cardLabel).join(' ')}`);

    if (p.hand.length === 0) {
      p.out = true;
      this.finishOrder.push(p.id);
      this._addLog(`${p.name} is out of cards — safe!`);
    }

    if (this.table.length >= this.pileStartCount) {
      this.discardCount++;
      this.firstDiscardDone = true;
      this.table = [];
      this._addLog(`Pile discarded — ${p.name} leads`);
      if (this._checkGameOver()) return;
      this._setTurnFrom(p.seat, true);
      return;
    }
    if (this._checkGameOver()) return;
    this._setTurnFrom(p.seat, false);
  }

  pickup(playerId) {
    if (this.phase !== 'round2') throw new GameError('Not in round 2');
    if (this.turnId !== playerId) throw new GameError('Not your turn');
    if (this.table.length === 0) throw new GameError('Nothing to pick up');
    const p = this.player(playerId);
    const bottom = this.table[0];
    const card = bottom.cards.shift();
    if (bottom.cards.length === 0) this.table.shift();
    p.hand.push(card);
    this._addLog(`${p.name} picks up ${cardLabel(card)}`);
    this._setTurnFrom(p.seat, false);
  }

  // ---------- leaving ----------

  removePlayer(playerId) {
    const p = this.player(playerId);
    if (p.removed || this.phase === 'finished') return;
    p.removed = true;
    p.hand = [];
    p.won = [];
    this._addLog(`${p.name} left the game`);

    if (this.phase === 'round1') {
      if (this._active().length < 2) {
        this._finish(null);
        return;
      }
      const t = this.trick;
      t.pending = t.pending.filter((id) => id !== playerId);
      this._advanceTrick();
      return;
    }

    if (this._checkGameOver()) return;
    if (this.turnId === playerId) this._setTurnFrom(p.seat, false);
  }

  _checkGameOver() {
    const active = this._active();
    if (active.length > 1) return false;
    this._finish(active.length === 1 ? active[0].id : null);
    return true;
  }

  _finish(loserId) {
    this.phase = 'finished';
    this.turnId = null;
    this.loserId = loserId;
    if (loserId) this._addLog(`${this.player(loserId).name} is the koira!`);
    else this._addLog('Game over');
  }

  // ---------- views ----------

  // During round 1 the set-aside trump card stays face down, even to its holder.
  _visibleWon(p) {
    if (this.phase !== 'round1' || !this.trump || this.trump.holderId !== p.id) return p.won;
    return p.won.filter((c) => c !== this.trump.card);
  }

  view(playerId) {
    const me = this.players.find((p) => p.id === playerId);
    const t = this.trick;
    return {
      phase: this.phase,
      handSize: this.handSize,
      myId: playerId,
      myHand: me ? [...me.hand].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit)) : [],
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        handCount: p.hand.length,
        wonCount: p.won.length,
        out: p.out,
        removed: p.removed,
      })),
      drawPileCount: this.drawPile.length,
      trump: this.phase === 'round1' ? null : this.trump,
      trumpSetAside: this.phase === 'round1' && !!this.trump,
      trick: t ? { pile: t.pile, reveals: t.reveals } : null,
      lastTrick: this.lastTrick,
      tricksPlayed: this.tricksPlayed,
      myWon: me ? this._visibleWon(me) : [],
      // Only my own snapshot: other players' won-piles are their hidden round 2 hands.
      myRound1Won: me && this.round1Won ? this.round1Won[me.id] || [] : null,
      round1WonCounts: this.round1Won
        ? Object.fromEntries(Object.entries(this.round1Won).map(([id, cards]) => [id, cards.length]))
        : null,
      table: this.table,
      pileStartCount: this.pileStartCount,
      straightsAllowed: !this.firstDiscardDone,
      discardCount: this.discardCount,
      turnId: this.turnId,
      finishOrder: this.finishOrder,
      loserId: this.loserId,
      log: this.log,
    };
  }
}

module.exports = { Game, GameError };
