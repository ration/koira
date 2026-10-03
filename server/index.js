'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Lobby } = require('./lobby');
const { GameError } = require('./game');

const PORT = Number(process.env.PORT) || 3000;
const GRACE_MS = 60_000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
const server = http.createServer(app);
const io = new Server(server);
const lobby = new Lobby();

const sockets = new Map(); // token -> Set(socket)
const graceTimers = new Map(); // token -> timeout

function emitLobby() {
  io.to('lobby').emit('lobby', lobby.list());
}

function roomView(room, token) {
  const me = lobby.playerIn(room, token);
  return {
    id: room.id,
    name: room.name,
    locked: !!room.password,
    handSize: room.handSize,
    hostId: room.players[0].id,
    myId: me.id,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: sockets.has(p.token) })),
    game: room.game ? room.game.view(me.id) : null,
  };
}

function emitRoom(room) {
  if (!room) return;
  for (const p of room.players) {
    for (const s of sockets.get(p.token) || []) s.emit('room', roomView(room, p.token));
  }
}

function joinSocketTo(socket, room) {
  socket.leave('lobby');
  socket.join(room.id);
}

io.on('connection', (socket) => {
  const token = String(socket.handshake.auth.token || '');
  let nickname = String(socket.handshake.auth.nickname || '').trim().slice(0, 20);
  if (!token || token.length < 16 || !nickname) {
    socket.emit('fatal', 'Missing session');
    socket.disconnect(true);
    return;
  }

  if (!sockets.has(token)) sockets.set(token, new Set());
  sockets.get(token).add(socket);
  clearTimeout(graceTimers.get(token));
  graceTimers.delete(token);

  const current = lobby.roomOf(token);
  if (current) {
    joinSocketTo(socket, current);
    emitRoom(current);
  } else {
    socket.join('lobby');
    socket.emit('room', null);
  }
  socket.emit('lobby', lobby.list());

  // Wrap a handler: run it, report errors to this client only.
  const on = (event, fn) =>
    socket.on(event, (payload = {}) => {
      try {
        fn(payload || {});
      } catch (err) {
        if (!(err instanceof GameError)) console.error(err);
        socket.emit('error-msg', err instanceof GameError ? err.message : 'Server error');
      }
    });

  const myRoom = () => {
    const r = lobby.roomOf(token);
    if (!r) throw new GameError('You are not in a game');
    return r;
  };

  on('createGame', ({ name, password, handSize }) => {
    const room = lobby.create({ name, password, handSize, token, nickname });
    for (const s of sockets.get(token)) joinSocketTo(s, room);
    emitRoom(room);
    emitLobby();
  });

  on('joinGame', ({ roomId, password }) => {
    const room = lobby.join({ roomId, password, token, nickname });
    for (const s of sockets.get(token)) joinSocketTo(s, room);
    emitRoom(room);
    emitLobby();
  });

  on('leaveGame', () => {
    const room = lobby.leave(token);
    for (const s of sockets.get(token)) {
      if (room) s.leave(room.id);
      s.join('lobby');
      s.emit('room', null);
    }
    emitRoom(room);
    emitLobby();
  });

  on('startGame', () => {
    const room = lobby.start(myRoom().id, token);
    emitRoom(room);
    emitLobby();
  });

  const withGame = (fn) => (payload) => {
    const room = myRoom();
    if (!room.game) throw new GameError('Game has not started');
    fn(room.game, lobby.playerIn(room, token).id, payload);
    emitRoom(room);
  };

  on('playRound1', withGame((g, id, { cardId }) => g.playRound1(id, String(cardId))));
  on('play', withGame((g, id, { cardIds }) => g.play(id, Array.isArray(cardIds) ? cardIds.map(String) : [])));
  on('pickup', withGame((g, id) => g.pickup(id)));

  socket.on('disconnect', () => {
    const set = sockets.get(token);
    if (!set) return;
    set.delete(socket);
    if (set.size > 0) return;
    sockets.delete(token);
    const room = lobby.roomOf(token);
    if (!room) return;
    emitRoom(room); // show as disconnected
    // In the pre-game waiting room, leave immediately; in-game, wait for reconnect.
    const delay = room.game && room.game.phase !== 'finished' ? GRACE_MS : 5_000;
    graceTimers.set(
      token,
      setTimeout(() => {
        graceTimers.delete(token);
        if (sockets.has(token)) return;
        emitRoom(lobby.leave(token));
        emitLobby();
      }, delay)
    );
  });
});

server.listen(PORT, () => console.log(`Koira listening on http://localhost:${PORT}`));
