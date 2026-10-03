'use strict';

const crypto = require('crypto');
const { Game, GameError } = require('./game');

const MAX_PLAYERS = 10;

class Lobby {
  constructor() {
    this.rooms = new Map(); // roomId -> room
  }

  list() {
    return [...this.rooms.values()]
      .filter((r) => !r.game || r.game.phase === 'finished')
      .map((r) => ({
        id: r.id,
        name: r.name,
        host: r.players[0] ? r.players[0].name : '',
        playerCount: r.players.length,
        locked: !!r.password,
      }));
  }

  create({ name, password, handSize, token, nickname }) {
    if (this.roomOf(token)) throw new GameError('You are already in a game');
    const size = Number(handSize) || 3;
    if (size < 1 || size > 10) throw new GameError('Hand size must be 1–10');
    const room = {
      id: crypto.randomUUID(),
      name: String(name || `${nickname}'s game`).slice(0, 40),
      password: password ? String(password) : '',
      handSize: size,
      players: [{ token, id: crypto.randomUUID(), name: nickname }],
      game: null,
    };
    this.rooms.set(room.id, room);
    return room;
  }

  join({ roomId, password, token, nickname }) {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('Game not found');
    const existing = this.roomOf(token);
    if (existing && existing !== room) throw new GameError('You are already in another game');
    if (room.players.some((p) => p.token === token)) return room;
    if (room.game && room.game.phase !== 'finished') throw new GameError('Game already started');
    if (room.password && room.password !== password) throw new GameError('Wrong password');
    if (room.players.length >= MAX_PLAYERS) throw new GameError('Game is full');
    room.players.push({ token, id: crypto.randomUUID(), name: nickname });
    return room;
  }

  start(roomId, token) {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError('Game not found');
    if (room.players[0].token !== token) throw new GameError('Only the host can start');
    if (room.game && room.game.phase !== 'finished') throw new GameError('Already started');
    if (room.players.length < 2) throw new GameError('Need at least 2 players');
    room.game = new Game({
      players: room.players.map((p) => ({ id: p.id, name: p.name })),
      handSize: room.handSize,
    });
    return room;
  }

  /** Remove a player from their room. Returns the room (or null if it was deleted). */
  leave(token) {
    const room = this.roomOf(token);
    if (!room) return null;
    const me = room.players.find((p) => p.token === token);
    if (room.game && room.game.phase !== 'finished') room.game.removePlayer(me.id);
    room.players = room.players.filter((p) => p.token !== token);
    if (room.players.length === 0) {
      this.rooms.delete(room.id);
      return null;
    }
    return room;
  }

  playerIn(room, token) {
    return room.players.find((p) => p.token === token);
  }

  roomOf(token) {
    for (const r of this.rooms.values()) {
      if (r.players.some((p) => p.token === token)) return r;
    }
    return null;
  }
}

module.exports = { Lobby };
