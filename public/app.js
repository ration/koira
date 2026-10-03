'use strict';

const $ = (sel) => document.querySelector(sel);
const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RANK = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const rankName = (r) => RANK[r] || String(r);
const label = (c) => `${rankName(c.rank)}${SUIT[c.suit]}`;

let token = localStorage.getItem('koira.token');
if (!token) {
  token = crypto.randomUUID();
  localStorage.setItem('koira.token', token);
}
let nickname = localStorage.getItem('koira.nick') || '';

let socket = null;
let room = null;
let lobbyGames = [];
let selected = new Set(); // selected card ids (round 2)
let seenTricks = null; // tricksPlayed from the last state we rendered
let collecting = null; // { trick, timer } while a finished trick is shown before it's collected
let transfer = null; // { timer } while round 1 won-piles are shown before moving into round 2 hands
let prevGame = null; // game state used by the previous render (for animations)
const COLLECT_MS = 1600;
const TRANSFER_PAUSE_MS = 1400;
const FLY_MS = 550;

// ---------- connection ----------

function connect() {
  $('#whoami').textContent = nickname;
  socket = io({ auth: { token, nickname } });
  socket.on('lobby', (games) => {
    lobbyGames = games;
    render();
  });
  socket.on('room', (r) => {
    const prevPhase = room && room.game && room.game.phase;
    room = r;
    if (!r || !r.game || r.game.phase !== prevPhase) selected.clear();
    const tricks = r && r.game ? r.game.tricksPlayed : null;
    // A trick just finished: show it being collected by the winner, then clear the table.
    if (tricks != null && seenTricks != null && tricks > seenTricks && r.game.lastTrick) {
      if (collecting) clearTimeout(collecting.timer);
      collecting = { trick: r.game.lastTrick };
      collecting.timer = setTimeout(() => {
        collecting = null;
        render();
      }, COLLECT_MS);
    }
    seenTricks = tricks;
    // Round 2 just began: show the final won-piles for a moment, then move them into hands.
    if (prevPhase === 'round1' && r && r.game && r.game.phase === 'round2' && r.game.myRound1Won) {
      if (transfer) clearTimeout(transfer.timer);
      transfer = {};
      transfer.timer = setTimeout(() => {
        transfer = null;
        render();
      }, (collecting ? COLLECT_MS : 0) + TRANSFER_PAUSE_MS);
    }
    // Someone already played into the next trick: stop showing the old state.
    if (r && r.game && ((r.game.trick && r.game.trick.pile.length) || r.game.table.length)) {
      if (collecting) clearTimeout(collecting.timer);
      if (transfer) clearTimeout(transfer.timer);
      collecting = transfer = null;
    }
    if (!r || !r.game) {
      if (transfer) clearTimeout(transfer.timer);
      transfer = null;
    }
    // Drop selections for cards no longer in hand.
    if (r && r.game) {
      const inHand = new Set(r.game.myHand.map((c) => c.id));
      for (const id of [...selected]) if (!inHand.has(id)) selected.delete(id);
    }
    render();
  });
  socket.on('error-msg', toast);
  socket.on('fatal', toast);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3000);
}

// ---------- rendering ----------

function show(view) {
  for (const v of document.querySelectorAll('.view')) v.classList.add('hidden');
  $(`#view-${view}`).classList.remove('hidden');
}

function render() {
  const before = captureCards();
  const wasGame = prevGame;
  prevGame = null;
  if (!nickname) return show('nick');
  if (!room) return renderLobby();
  if (!room.game) return renderRoom();
  renderGame();
  if (wasGame) animateCards(before, wasGame, room.game);
  prevGame = room.game;
}

// ---------- card movement animation ----------
// Every tracked card element carries data-card-id. Before re-rendering we record where each
// card was; afterwards each card flies from its old spot to its new one. Cards with no old
// spot fly in from where they came from (deck, or the player who played them); cards that
// disappear leave a ghost that flies to where they went (a player's hand, or the discard).

function captureCards() {
  const m = new Map();
  for (const el of document.querySelectorAll('[data-card-id]')) {
    const zone = el.closest('[data-zone]');
    m.set(el.dataset.cardId, { rect: el.getBoundingClientRect(), html: el.outerHTML, zone: zone && zone.dataset.zone });
  }
  return m;
}

function playerBox(id) {
  return document.querySelector(`.opp[data-player-id="${id}"]`);
}

function fly(el, from, to, opts = {}) {
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width || 1;
  const sy = from.height / to.height || 1;
  el.style.transformOrigin = 'top left';
  return el.animate(
    [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: opts.fadeIn ? 0.3 : 1 }, { transform: 'none', opacity: 1 }],
    { duration: FLY_MS, easing: 'cubic-bezier(.2,.7,.3,1)', delay: opts.delay || 0, fill: 'backwards' }
  );
}

function ghost(info, to, { fade = false, delay = 0 } = {}) {
  const wrap = document.createElement('div');
  wrap.innerHTML = info.html;
  const el = wrap.firstChild;
  el.removeAttribute('data-card-id');
  el.classList.add('ghost');
  Object.assign(el.style, { left: `${info.rect.left}px`, top: `${info.rect.top}px`, width: `${info.rect.width}px`, height: `${info.rect.height}px` });
  document.body.appendChild(el);
  const r = info.rect;
  const end = to
    ? `translate(${to.left + to.width / 2 - r.left - r.width / 2}px, ${to.top + to.height / 2 - r.top - r.height / 2}px) scale(0.4)`
    : 'translate(40px, -20px) scale(0.6)';
  el.animate([{ transform: 'none', opacity: 1 }, { transform: end, opacity: fade || !to ? 0 : 0.6 }], {
    duration: FLY_MS,
    easing: 'cubic-bezier(.4,0,.6,1)',
    delay,
    fill: 'forwards',
  }).onfinish = () => el.remove();
}

function animateCards(before, prev, g) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = new Set();
  let i = 0;
  for (const el of document.querySelectorAll('[data-card-id]')) {
    const id = el.dataset.cardId;
    now.add(id);
    const to = el.getBoundingClientRect();
    const old = before.get(id);
    const delay = Math.min(i * 25, 400);
    if (old) {
      if (Math.abs(old.rect.left - to.left) > 1 || Math.abs(old.rect.top - to.top) > 1) {
        fly(el, old.rect, to, { delay });
        i++;
      }
      continue;
    }
    // New card: work out where it came from.
    const zone = el.closest('[data-zone]');
    let src = null;
    if (zone && zone.dataset.zone === 'hand' && g.phase === 'round1') src = document.querySelector('#draw-pile .card') || document.querySelector('#draw-pile');
    else if (zone && zone.dataset.zone === 'table') {
      const owner = el.closest('[data-owner]');
      src = owner && playerBox(owner.dataset.owner);
    }
    if (src) {
      // Start at card size (shrunk), centred on the source — not stretched to the source box.
      const b = src.getBoundingClientRect();
      const w = to.width * 0.6, h = to.height * 0.6;
      const from = { left: b.left + b.width / 2 - w / 2, top: b.top + b.height / 2 - h / 2, width: w, height: h };
      fly(el, from, to, { fadeIn: true, delay });
      i++;
    }
  }
  // Vanished cards: fly a ghost to where they went.
  const discarded = g.discardCount > prev.discardCount;
  for (const [id, info] of before) {
    if (now.has(id)) continue;
    let dest = null;
    if (info.zone && info.zone.startsWith('won:')) dest = playerBox(info.zone.slice(4));
    else if (info.zone === 'table' && !discarded && prev.turnId) dest = playerBox(prev.turnId); // picked up
    ghost(info, dest && dest.getBoundingClientRect(), { delay: Math.min(i++ * 25, 400) });
  }
}

function renderLobby() {
  show('lobby');
  const ul = $('#game-list');
  ul.innerHTML = '';
  if (lobbyGames.length === 0) {
    ul.innerHTML = '<li class="empty">No open games — create one!</li>';
    return;
  }
  for (const g of lobbyGames) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${g.locked ? '🔒 ' : ''}<b></b> <small></small></span>`;
    li.querySelector('b').textContent = g.name;
    li.querySelector('small').textContent = `host ${g.host} · ${g.playerCount}/10`;
    const btn = document.createElement('button');
    btn.textContent = 'Join';
    btn.onclick = () => {
      let password = '';
      if (g.locked) {
        password = prompt('Password:');
        if (password === null) return;
      }
      socket.emit('joinGame', { roomId: g.id, password });
    };
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function renderRoom() {
  show('room');
  $('#room-name').textContent = `${room.locked ? '🔒 ' : ''}${room.name}`;
  $('#room-info').textContent = `Hand size ${room.handSize} · ${room.players.length}/10 players`;
  const ul = $('#room-players');
  ul.innerHTML = '';
  for (const p of room.players) {
    const li = document.createElement('li');
    li.textContent = `${p.name}${p.id === room.hostId ? ' 👑' : ''}${p.id === room.myId ? ' (you)' : ''}${p.connected ? '' : ' — disconnected'}`;
    ul.appendChild(li);
  }
  const isHost = room.hostId === room.myId;
  $('#start-btn').classList.toggle('hidden', !isHost);
  $('#start-btn').disabled = room.players.length < 2;
}

function cardEl(card, { small = false, mini = false, trumpSuit = null, track = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '') + (mini ? ' mini' : '');
  if (!card) {
    el.classList.add('back');
    return el;
  }
  if (card.suit === 'H' || card.suit === 'D') el.classList.add('red');
  if (trumpSuit && card.suit === trumpSuit) el.classList.add('trump');
  el.innerHTML = `<span></span><span class="big"></span>`;
  el.firstChild.textContent = rankName(card.rank);
  el.lastChild.textContent = SUIT[card.suit];
  el.title = label(card);
  if (track) el.dataset.cardId = card.id;
  return el;
}

function pileEl(cards, zone, trumpSuit) {
  const div = document.createElement('div');
  div.className = 'pile';
  div.dataset.zone = zone;
  for (const c of cards) div.appendChild(cardEl(c, { mini: true, trumpSuit, track: true }));
  return div;
}

// My won-pile: live in round 1, the final snapshot while it moves into my round 2 hand,
// minus any trick still being shown on the table.
function shownWon(g) {
  let cards = g.phase === 'round1' ? g.myWon : transfer && g.myRound1Won ? g.myRound1Won : [];
  if (collecting) {
    const onTable = new Set(collecting.trick.reveals.flat().map((r) => r.card.id));
    cards = cards.filter((c) => !onTable.has(c.id));
  }
  return cards;
}

// Other players' won-piles are hidden: just a count, shown face down.
function shownWonCount(g, p) {
  let n = g.phase === 'round1' ? p.wonCount : transfer && g.round1WonCounts ? g.round1WonCounts[p.id] || 0 : 0;
  if (collecting && collecting.trick.winnerId === p.id) n -= collecting.trick.reveals.flat().length;
  return Math.max(0, n);
}

function hiddenPileEl(count, playerId) {
  const div = document.createElement('div');
  div.className = 'pile';
  div.dataset.zone = `won:${playerId}`;
  for (let i = 0; i < count; i++) {
    const el = cardEl(null, { mini: true });
    el.dataset.cardId = `back:${playerId}:${i}`;
    div.appendChild(el);
  }
  return div;
}

function renderGame() {
  show('game');
  const g = room.game;
  const trumpSuit = g.trump ? g.trump.suit : null;
  const nameOf = (id) => (g.players.find((p) => p.id === id) || {}).name || '?';
  const connected = new Map(room.players.map((p) => [p.id, p.connected]));

  // Players strip
  const opps = $('#opponents');
  opps.innerHTML = '';
  for (const p of g.players) {
    const el = document.createElement('div');
    el.className = 'opp';
    el.dataset.playerId = p.id;
    if (p.id === g.myId) el.classList.add('me');
    if (p.id === g.turnId) el.classList.add('turn');
    if (p.out || p.removed) el.classList.add('out');
    const wonCount = p.id === g.myId ? shownWon(g).length : shownWonCount(g, p);
    let meta = `${transfer ? 0 : p.handCount} in hand`;
    if (g.phase === 'round1' || transfer) meta += ` · ${wonCount} won`;
    if (p.out) meta = '🏁 safe';
    if (p.removed) meta = '🚪 left';
    if (g.loserId === p.id) meta = '🐕 KOIRA';
    if (!p.removed && connected.get(p.id) === false) meta += ' · 📴';
    el.innerHTML = '<div class="name"></div><div class="meta"></div>';
    el.querySelector('.name').textContent = p.name + (p.id === g.myId ? ' (you)' : '');
    el.querySelector('.meta').textContent = meta;
    if (p.id !== g.myId && wonCount) el.appendChild(hiddenPileEl(wonCount, p.id));
    opps.appendChild(el);
  }

  // My won-pile (round 1): becomes my round 2 hand
  const myWon = $('#my-won');
  myWon.innerHTML = '';
  const mineWon = shownWon(g);
  myWon.classList.toggle('hidden', !(g.phase === 'round1' || transfer));
  const cap = document.createElement('div');
  cap.className = 'who';
  cap.textContent = `Your collected cards (${mineWon.length}) — these become your hand in round 2`;
  myWon.appendChild(cap);
  if (mineWon.length) myWon.appendChild(pileEl(mineWon, `won:${g.myId}`, trumpSuit));

  // Side: draw pile + trump
  $('#draw-pile').innerHTML = '';
  if (g.phase === 'round1') {
    if (g.drawPileCount > 0) $('#draw-pile').appendChild(cardEl(null, { small: true }));
    $('#draw-pile').append(`Deck: ${g.drawPileCount}`);
  }
  $('#trump').innerHTML = '';
  if (g.trump) {
    $('#trump').append('Trump');
    const tc = cardEl(g.trump.card || { rank: 0, suit: g.trump.suit }, { small: true, trumpSuit });
    if (transfer) tc.classList.add('reveal');
    $('#trump').appendChild(tc);
    if (transfer) $('#trump').append(`${nameOf(g.trump.holderId)} has it`);
  } else if (g.trumpSetAside) {
    $('#trump').append('Trump (set aside)');
    $('#trump').appendChild(cardEl(null, { small: true }));
    $('#trump').append('revealed after round 1');
  } else {
    $('#trump').textContent = 'Trump: ?';
  }

  // Table
  const table = $('#table');
  table.innerHTML = '';
  if (g.phase === 'round1' || (collecting && g.phase === 'round2' && !g.table.length)) {
    const shown = collecting ? collecting.trick.reveals : g.trick ? g.trick.reveals : [];
    if (collecting) {
      const winnerId = collecting.trick.winnerId;
      const count = shown.flat().length;
      const banner = document.createElement('div');
      banner.className = 'trick-banner';
      const what = count === 1 ? 'the card' : `${count} cards`;
      banner.textContent = winnerId === g.myId ? `You take ${what}` : `${nameOf(winnerId)} takes ${what}`;
      table.appendChild(banner);
      table.classList.add('collecting');
      // Highlight the winning card: the winner's play in the final pass.
      const lastPass = shown[shown.length - 1];
      const winning = lastPass.find((r) => r.playerId === winnerId);
      for (const row of shown) {
        const div = document.createElement('div');
        div.className = 'reveal-row';
        for (const r of row) {
          const el = playEl(nameOf(r.playerId), [r.card], trumpSuit, r.playerId);
          if (r === winning) el.classList.add('winning');
          div.appendChild(el);
        }
        table.appendChild(div);
      }
    } else {
      table.classList.remove('collecting');
      for (const row of shown) {
        if (!row.length) continue;
        const div = document.createElement('div');
        div.className = 'reveal-row';
        for (const r of row) div.appendChild(playEl(nameOf(r.playerId), [r.card], trumpSuit, r.playerId));
        table.appendChild(div);
      }
      if (!table.children.length) {
        table.innerHTML = '<span class="empty">Table is clear — new trick</span>';
      }
    }
  } else if (g.phase === 'round2' && transfer) {
    table.innerHTML = '<div class="trick-banner"></div>';
    const holder = g.trump && g.trump.card ? `${g.trump.holderId === g.myId ? 'You' : nameOf(g.trump.holderId)} got the trump card ${label(g.trump.card)}. ` : '';
    table.firstChild.textContent = `Round 2 begins — ${holder}Collected cards become hands.`;
  } else if (g.phase === 'round2') {
    table.classList.remove('collecting');
    for (const pl of g.table) table.appendChild(playEl(nameOf(pl.playerId), pl.cards, trumpSuit, pl.playerId));
    if (g.table.length) {
      const info = document.createElement('div');
      info.className = 'who';
      info.textContent = `${g.table.length}/${g.pileStartCount} plays — pile discards at ${g.pileStartCount}`;
      table.appendChild(info);
    } else {
      table.innerHTML = '<span class="empty">Empty table</span>';
    }
  } else {
    table.classList.remove('collecting');
    const loser = g.loserId ? nameOf(g.loserId) : null;
    table.innerHTML = `<div class="banner"></div>`;
    table.firstChild.textContent = loser
      ? loser === nameOf(g.myId) ? '🐕 You are the koira!' : `🐕 ${loser} is the koira!`
      : 'Game over';
  }

  // Status + actions
  const me = g.players.find((p) => p.id === g.myId);
  const myTurn = g.turnId === g.myId && !transfer;
  const status = $('#status');
  const actions = $('#actions');
  actions.innerHTML = '';
  if (g.phase === 'round1') {
    const tie = g.trick && g.trick.reveals.length > 1 ? ' (tie-break)' : '';
    status.textContent = (myTurn ? 'Your turn — play a card' : `${nameOf(g.turnId)}'s turn`) + tie;
  } else if (g.phase === 'round2') {
    const straight = g.straightsAllowed ? ' Straights allowed until the first discard.' : '';
    if (transfer) status.textContent = `Round 2 — ${nameOf(g.turnId)} leads (has the trump card)`;
    else if (me.out) status.textContent = "You're safe! 🎉";
    else if (myTurn) status.textContent = (g.table.length ? 'Your turn — beat the top card, play a trump, or pick up.' : 'Your lead.') + straight;
    else status.textContent = `${nameOf(g.turnId)}'s turn`;
    if (myTurn) {
      const playBtn = document.createElement('button');
      playBtn.textContent = selected.size > 1 ? `Play ${selected.size} cards` : 'Play';
      playBtn.disabled = selected.size === 0;
      playBtn.onclick = () => socket.emit('play', { cardIds: [...selected] });
      actions.appendChild(playBtn);
      if (g.table.length) {
        const pick = document.createElement('button');
        pick.className = 'secondary';
        pick.textContent = `Pick up ${label(g.table[0].cards[0])}`;
        pick.onclick = () => socket.emit('pickup');
        actions.appendChild(pick);
      }
    }
  } else {
    status.textContent = '';
    if (room.hostId === room.myId) {
      const again = document.createElement('button');
      again.textContent = 'Play again';
      again.onclick = () => socket.emit('startGame');
      actions.appendChild(again);
    }
  }

  // Hand
  const hand = $('#hand');
  hand.innerHTML = '';
  const stillInPile = new Set(transfer && g.myRound1Won ? g.myRound1Won.map((c) => c.id) : []);
  for (const c of g.myHand) {
    if (stillInPile.has(c.id)) continue;
    const el = cardEl(c, { trumpSuit, track: true });
    if (g.phase === 'round1') {
      if (!myTurn) el.classList.add('disabled');
      el.onclick = () => myTurn && socket.emit('playRound1', { cardId: c.id });
    } else if (g.phase === 'round2') {
      if (selected.has(c.id)) el.classList.add('selected');
      if (!myTurn) el.classList.add('disabled');
      el.onclick = () => {
        if (!myTurn) return;
        selected.has(c.id) ? selected.delete(c.id) : selected.add(c.id);
        render();
      };
      el.ondblclick = () => myTurn && socket.emit('play', { cardIds: [c.id] });
    }
    hand.appendChild(el);
  }

  // Log
  const log = $('#log');
  log.innerHTML = '';
  for (const line of [...g.log].reverse()) {
    const li = document.createElement('li');
    li.textContent = line;
    log.appendChild(li);
  }
}

function playEl(who, cards, trumpSuit, ownerId) {
  const div = document.createElement('div');
  div.className = 'play';
  if (ownerId) div.dataset.owner = ownerId;
  const cs = document.createElement('div');
  for (const c of cards) cs.appendChild(cardEl(c, { small: true, trumpSuit, track: true }));
  const w = document.createElement('div');
  w.className = 'who';
  w.textContent = who;
  div.append(cs, w);
  return div;
}

// ---------- events ----------

$('#nick-form').onsubmit = (e) => {
  e.preventDefault();
  nickname = $('#nick-input').value.trim();
  if (!nickname) return;
  localStorage.setItem('koira.nick', nickname);
  connect();
  render();
};

$('#create-form').onsubmit = (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  socket.emit('createGame', {
    name: f.get('name'),
    password: f.get('password'),
    handSize: Number(f.get('handSize')),
  });
};

$('#start-btn').onclick = () => socket.emit('startGame');
$('#leave-btn').onclick = () => socket.emit('leaveGame');
$('#leave-game-btn').onclick = () => {
  if (room.game.phase === 'finished' || confirm('Leave the game? Your cards are removed.')) socket.emit('leaveGame');
};

if (nickname) connect();
render();
