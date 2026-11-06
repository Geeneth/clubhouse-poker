# Invariants

Rules that must hold at all times, in every code path. They come from the vision and spec and are owned by Geeneth. Agents never edit this file. If a ticket seems to conflict with an invariant, stop and ask.

"Engine" means `packages/engine`, where all game rules live. "Server" means `packages/server`.

## Chips

1. **Chips are conserved.** Within a hand, the chips in all stacks, bets and pots always sum to the same total. Chips are never created or destroyed by betting, folding, side pots, showdown or payout.
2. **Across a night, the only way the total grows is a rebuy.** Total chips in play always equals every player's starting stack plus the rebuys taken.
3. **No negative or fractional chips.** Stacks, bets and pots are non-negative integers.
4. **A player can never bet more than their stack.** A bet for the whole stack is an all-in.
5. **Pots are paid out in full.** After showdown (or when everyone else folds) the pot and all side pots are empty and every chip has gone to an eligible player.
6. **Side pots are correct.** A player can only win from a pot they contributed to, and every pot is split only among eligible players still in the hand.
7. **Ties split the pot, and nothing is lost.** Each pot is split evenly among its tied winners. Any indivisible remainder is given out one chip at a time, starting with the tied winner closest to the left of the dealer button and continuing clockwise (the casino odd chip rule). Each side pot is split separately. A remainder never disappears.

## Cards

8. **No duplicate cards.** There are 52 distinct cards. No card appears twice across the deck, the board and all hole cards.
9. **Each hand is dealt from a fresh, complete deck.** Two hole cards per active player and up to five board cards (flop 3, turn 1, river 1). No cards are dealt out of order.
10. **The best hand wins at showdown.** Hand ranking follows standard Texas Hold'em. Equal hands tie.

## Action order and legality

11. **Only the player whose turn it is can act.** Actions from anyone else are rejected and change nothing.
12. **Only legal actions are accepted.** Fold, check, call, bet, raise and all-in are each allowed only when the rules permit them. Check is not allowed facing a bet. Bet and raise sizes respect the minimums. Folded, all-in and busted players never act.
13. **Betting rounds run in order:** preflop, flop, turn, river, showdown. Rounds never skip or repeat, and a round ends only when the betting is settled.
14. **The dealer button moves every hand,** and small and big blinds are posted automatically from the correct seats.
15. **Blinds never go down** during a night. They rise only on the schedule set by the host's blind speed.
16. **Seats are 2 to 8 players.** A game does not start outside that range.
17. **The turn timer is enforced.** When time runs out, the player checks if that is legal, otherwise folds. A turn can never pass without an action or a timeout.
18. **A rebuy happens once per player,** at the starting stack, and only after busting.
19. **The night ends only when** one player holds all the chips or the host ends it.

## Secrecy and fairness

20. **Hidden cards are never sent to other players.** A client only ever receives what its own screen is allowed to see. A phone gets its own hole cards and nobody else's.
21. **The table screen never receives hole cards before showdown,** and never receives the undealt deck.
22. **Folded players' cards are never revealed.** Only hands that reach showdown are shown, and only at the end of the hand.
23. **Busted players, spectators and kicked players never receive hole cards** of players still in a hand.
24. **The server is authoritative.** Clients send intents only. Clients never decide the outcome, the deck order or another player's state.
25. **Deck order is never exposed** to any client, in any message, before or after the hand.

## Connections

26. **Disconnecting never changes the game.** The game continues and the turn timer keeps running for a disconnected player.
27. **Reconnecting restores the same seat, cards and chips,** and nothing more than that player is allowed to see.
28. **Only the host can** pause, resume, kick or end the night. Other players' requests for these are rejected.

## Architecture

29. **The engine is pure.** No networking, no clocks, no global state and no randomness it does not receive from outside. Given the same state, input and shuffle, it returns the same result.
30. **Game rules live only in the engine.** The server and web app never re-implement rules.
31. **Coins are fake.** There is no real-money play in any form.
