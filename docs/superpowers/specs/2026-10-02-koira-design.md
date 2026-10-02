# Koira (Skitgubbe) — Design

Date: 2026-10-02. Game rules: see `README.md` (authoritative).

## Goal

Browser-based real-time multiplayer card game. Players enter a nickname (no login),
see a lobby of open games, create/join games (optionally password-protected), and play.
Hosted on a single Node.js server (LAN/VPS). No persistence across restarts.

## Architecture

```
koira/
  server/
    index.js      — express + socket.io bootstrap
    lobby.js      — rooms: create/join/password/list, lobby broadcasts
    game.js       — game engine (pure, no socket knowledge): round 1 + round 2 state machine
    cards.js      — card model (suit, rank 2–14), deck creation, crypto-random shuffle
  public/
    index.html / app.js / style.css — single-page client (vanilla JS)
  test/
    cards.test.js, game.test.js, round2.test.js   (node:test)
  package.json
```

- **Server-authoritative**: clients send intents only (`createGame`, `joinGame`,
  `startGame`, `playCard`, `playStraight`, `pickup`, `selectRound1`), referencing card
  IDs from their own hand. The server validates everything.
- **Realtime**: Socket.IO rooms, one room per game. On every state change the server
  emits a per-player personalized state: own hand visible, others show card counts.
- **Sessions**: nickname + random session token in `localStorage`; socket reconnect
  reattaches to the game by token.

## Lobby & rooms

- Lobby list broadcast to all connected clients: game name, host, player count,
  lock icon if password-protected.
- Create game: name, optional password, hand size (default 3, configurable),
  decks (1 for now; engine keeps deck count a parameter for future multi-deck).
- Join: password check if locked; max 10 players.
- Start: host only, min 2 players. Room disappears from lobby list while in progress.
- Disconnect mid-game: 60 s grace period to reconnect (state preserved). After grace,
  the player is removed: their hand and won-pile are removed from the game and the
  game continues with the remaining players. Round 2 pile thresholds are unaffected
  (fixed at pile start).
- Empty rooms (everyone left) are deleted.

## Game engine

Pure module, no I/O. Holds: players (seating order), hands, won-piles, draw pile,
table state, phase, whose turn, trump.

### Round 1

1. Shuffle, deal `handSize` to each player.
2. Trick: each player secretly selects a card (simultaneous). Reveal all. Highest
   rank wins; whole pile (incl. tie-breakers) → winner's won-pile.
3. Ties: tied players select again into the same pile; repeat.
4. Replenish hands to `handSize` from draw pile, in seating order, until empty/full.
5. Last card of pile = trump card: suit is trump, revealed to all, goes into the
   last drawer's hand. Engine-enforced: must be played before round 1 ends (if it's
   their last card it must be their final play).
6. Round 1 ends when draw pile and all hands are empty.

### Round 2

1. Leader: trump-card player. Fixed seating order, skipping eliminated/left players.
2. Empty table: leader plays any single card, or a straight (≥2 consecutive from 2,
   any suits; counts as one play).
3. Follow: single card with rank > last played rank; or a trump card (if no trump on
   top); or if a trump is on top, a higher trump. Or optionally continue the straight
   (≥1 consecutive card(s) right after the straight's top). Or pick up the
   bottom-most card of the pile.
4. Pile discard: when plays in current pile == player count at pile start → whole
   pile discarded; the final player leads the next pile.
5. Straights allowed only before the first pile discard. After that, never.
6. Empty-hand player (won nothing in round 1): must wait for cards on table, then
   picks up the bottom-most card. Cannot leave the game.
7. Player empties hand → out (safe). Last player holding cards loses; game ends
   when one player remains.

## Error handling

- Invalid intents (not your turn, card not in hand, illegal play) → server responds
  with an error event to that client only; state unchanged.
- Player leaves at end of a round or during round 1: same disconnect rule (hand/won
  cards removed, game continues if ≥2 remain; otherwise game over).

## Testing

- `node:test` unit tests on the pure engine: deck/deal, round 1 trick resolution
  (incl. ties, trump must-play), round 2 play legality (higher card, trump rules,
  straights, pickup, pile discard, threshold fixed at pile start, straights disabled
  after first discard), win/elimination flow.
- Manual smoke test of socket flow (create/join/play) via the browser.

## Out of scope

- Multi-deck support (parameterized, not exposed).
- Persistence, accounts, reconnect across server restarts.
- Bots/AI players.
