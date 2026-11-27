import { TableError, type HandState, type Seat, type Table } from "./table";

/** What a finished hand leaves behind for the next one. */
export interface NextHand {
  /**
   * The table for the next hand: every stack updated with what was won and lost, and the
   * button left on this hand's button (startHand moves it on, skipping busted and empty seats).
   */
  readonly table: Table;
  /** Ids of every seated player with no chips left (busted, skipped for the next hand), in seat order. */
  readonly busted: readonly string[];
  /** Ids of players who busted in this hand (they had chips when it started), in seat order. */
  readonly knockedOut: readonly string[];
  /** Set when only one player has chips left: the game is over and they won it. */
  readonly gameOver: { readonly winner: string } | null;
}

const total = (seats: readonly (Seat | null)[]): number => seats.reduce((s, p) => s + (p ? p.stack : 0), 0);

/**
 * Turn a paid-out hand (stage "complete", from settleShowdown) into the table for the next hand.
 * `table` must be the table the hand was started from. Pure: returns a new table.
 * Throws a TableError if the hand is not finished or does not belong to this table.
 */
export function nextHand(table: Table, hand: HandState): NextHand {
  if (hand.stage !== "complete") {
    throw new TableError(`The hand must be paid out before the next one (stage is "${hand.stage}")`);
  }
  if (hand.pot !== 0 || hand.players.some((p) => p.bet !== 0)) {
    throw new TableError("The hand still has chips in the pot");
  }
  const stacks = new Map<number, number>();
  for (const p of hand.players) {
    const seat = table.seats[p.seat];
    if (!seat || seat.id !== p.id) throw new TableError(`Seat ${p.seat} does not hold ${p.id} at this table`);
    if (!Number.isInteger(p.stack) || p.stack < 0) throw new TableError(`Invalid stack for ${p.id}: ${p.stack}`);
    stacks.set(p.seat, p.stack);
  }
  const seats = table.seats.map((s, i) => (s ? { ...s, stack: stacks.get(i) ?? s.stack } : null));
  if (total(seats) !== total(table.seats)) {
    throw new TableError(`Chips are not conserved: the table had ${total(table.seats)}, the hand leaves ${total(seats)}`);
  }

  const seated = seats.filter((s): s is Seat => s !== null);
  const busted = seated.filter((s) => s.stack === 0).map((s) => s.id);
  const knockedOut = hand.players.filter((p) => p.stack === 0).map((p) => p.id);
  const withChips = seated.filter((s) => s.stack > 0);
  const gameOver = withChips.length === 1 ? { winner: withChips[0]!.id } : null;
  return { table: { seats, button: hand.button }, busted, knockedOut, gameOver };
}
