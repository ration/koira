'use strict';

const { makeCard } = require('../server/cards');

// Parse "10H" / "AS" / "2C" into a card.
function c(str, deck = 0) {
  const suit = str.slice(-1);
  const r = str.slice(0, -1);
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[r] || Number(r);
  return makeCard(rank, suit, deck);
}

const cards = (s) => s.split(/\s+/).filter(Boolean).map((x) => c(x));

function players(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
}

module.exports = { c, cards, players };
