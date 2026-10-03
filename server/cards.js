'use strict';

const crypto = require('crypto');

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK_NAMES = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

function makeCard(rank, suit, deck = 0) {
  return { id: `${rank}${suit}-${deck}`, rank, suit };
}

function createDeck(decks = 1) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) cards.push(makeCard(rank, suit, d));
    }
  }
  return cards;
}

// Fisher–Yates with a crypto-random source.
function shuffle(cards, randomInt = crypto.randomInt) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function rankName(rank) {
  return RANK_NAMES[rank] || String(rank);
}

function cardLabel(card) {
  return `${rankName(card.rank)}${SUIT_SYMBOLS[card.suit]}`;
}

module.exports = { SUITS, SUIT_SYMBOLS, makeCard, createDeck, shuffle, rankName, cardLabel };
