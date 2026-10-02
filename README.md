# Koira (Skitgubbe)

A browser-based multiplayer card game. Players join from a lobby, optionally with
password-protected games.

Played with a standard 52-card deck, 2–10 players. Ace is the highest card (rank 14).

## Round 1

1. Each player is dealt 3 cards (configurable). The rest of the deck is the draw pile.
2. Each player secretly selects one card; cards are revealed simultaneously.
3. The highest card wins the whole pile. Won cards are put **aside** into the winner's
   won-pile — they do not affect hand size. (These become the player's round 2 hand.)
4. If the highest cards tie, the tied players each play another card into the same pile.
   Repeat until there is a unique highest card. The winner takes the whole pile,
   including all tie-breakers.
5. After the trick, in seating order, each player with fewer than 3 cards in hand draws
   one card from the pile, until the pile is empty or all hands are full.
6. The **last card in the deck** determines the trump suit. The last player to draw it
   shows it to everyone and takes it into their hand. It must be played during round 1
   (it cannot remain in the player's hand when round 1 ends).
7. Round 1 ends when the draw pile is empty and all hands are empty.

## Round 2

1. Round 2 is started by the player who drew the trump card.
2. On an empty table the leader may play any single card, or a **straight** — two or
   more consecutive cards starting from 2, in any suit mix. A straight counts as a
   single play.
3. Each following player must play a card that is **bigger than the last played card**
   (the top of the straight counts), or a **trump card**. If there is a trump card on
   the table, a bigger trump card must be played.
4. A player may instead **continue the straight** (play one or more consecutive cards
   right after the straight's current top). Continuing is optional.
5. If a player cannot (or does not want to) play, they **pick up the bottom-most card**
   of the pile into their hand. A straight does not protect: the bottom-most card is
   the 2. Turn passes.
6. When the number of plays in the current pile equals the number of players that were
   in the game when the pile started, the whole pile is **discarded** (removed from
   the game). The player who made the final play leads the next pile.
7. Straights are only allowed before the first pile has been discarded. After the
   first discard, no more straights are ever played.
8. A player who empties their hand **leaves the game** (safe). The only way to leave
   the game is to play a card. A player with no cards (won nothing in round 1) must
   wait until there are cards on the table and then pick up the bottom-most card.
9. The game continues until only one player remains — the last player holding cards
   loses.
