import { cardId, type Card } from "./cards";
import { deal, type Deck } from "./deck";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;

export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableError";
  }
}

/** A seated player. A stack of 0 means busted. */
export interface Seat {
  readonly id: string;
  readonly stack: number;
}

/**
 * A table: seat index -> player (or null for an empty seat), plus the dealer button.
 * `button` is null until the first hand is started.
 */
export interface Table {
  readonly seats: readonly (Seat | null)[];
  readonly button: number | null;
}

export interface Blinds {
  readonly small: number;
  readonly big: number;
}

export type Street = "preflop" | "flop" | "turn" | "river";

export interface HandSeat {
  readonly seat: number;
  readonly id: string;
  /** Chips behind (not yet bet). */
  readonly stack: number;
  /** Chips bet on the current street. */
  readonly bet: number;
  readonly status: "active" | "allIn";
  readonly hole: readonly [Card, Card];
}

export interface HandState {
  readonly street: Street;
  readonly button: number;
  readonly smallBlindSeat: number;
  readonly bigBlindSeat: number;
  readonly blinds: Blinds;
  /** Players dealt into the hand, in seat order. */
  readonly players: readonly HandSeat[];
  readonly board: readonly Card[];
  /** Chips swept in from earlier streets (betting rounds, CLB-16, move bets here). */
  readonly pot: number;
  /** Seat that acts next, or null if nobody can act (everyone is all-in). */
  readonly toAct: number | null;
  /** The undealt cards. Never to be sent to clients. */
  readonly deck: Deck;
}

const isChips = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Create a table. Needs 2 to 8 seated players with non-negative integer stacks and unique ids. */
export function createTable(seats: readonly (Seat | null)[]): Table {
  if (seats.length > MAX_PLAYERS) throw new TableError(`A table has at most ${MAX_PLAYERS} seats`);
  const seated = seats.filter((s): s is Seat => s !== null);
  if (seated.length < MIN_PLAYERS || seated.length > MAX_PLAYERS) {
    throw new TableError(`A table needs ${MIN_PLAYERS} to ${MAX_PLAYERS} players, got ${seated.length}`);
  }
  if (new Set(seated.map((s) => s.id)).size !== seated.length) throw new TableError("Player ids must be unique");
  for (const s of seated) {
    if (!isChips(s.stack)) throw new TableError(`Invalid stack for ${s.id}: ${s.stack}`);
  }
  return { seats: seats.map((s) => (s ? { ...s } : null)), button: null };
}

/** Seats that can be dealt in: occupied and not busted. */
function activeSeats(table: Table): number[] {
  const out: number[] = [];
  table.seats.forEach((s, i) => {
    if (s && s.stack > 0) out.push(i);
  });
  return out;
}

/** First seat clockwise after `from` that is in `candidates`. */
function nextIn(candidates: readonly number[], from: number, seatCount: number): number {
  for (let step = 1; step <= seatCount; step++) {
    const seat = (from + step) % seatCount;
    if (candidates.includes(seat)) return seat;
  }
  throw new TableError("No seat found");
}

/**
 * Where the button goes for the next hand: one seat clockwise, skipping empty and busted seats.
 * The first hand puts the button on the lowest active seat.
 */
export function nextButton(table: Table): number {
  const active = activeSeats(table);
  if (active.length < MIN_PLAYERS) throw new TableError("Fewer than 2 players have chips");
  if (table.button === null) return active[0]!;
  return nextIn(active, table.button, table.seats.length);
}

/** The table for the hand after this one: same seats, button moved onto the hand's button. */
export function tableAfterHand(table: Table, hand: HandState): Table {
  return { seats: table.seats, button: hand.button };
}

function checkDeck(deck: Deck): void {
  if (deck.length !== 52 || new Set(deck.map(cardId)).size !== 52) {
    throw new TableError("A hand needs a fresh, complete 52-card deck");
  }
}

/**
 * Start a hand: move the button, post blinds, deal two hole cards to each active player.
 * The (already shuffled) deck is passed in, so this stays pure.
 * Heads-up, the dealer posts the small blind and acts first preflop.
 * No burn cards are used.
 */
export function startHand(table: Table, deck: Deck, blinds: Blinds): HandState {
  if (!isChips(blinds.small) || !isChips(blinds.big) || blinds.small < 1 || blinds.big < blinds.small) {
    throw new TableError("Blinds must be positive integers with big >= small");
  }
  checkDeck(deck);
  const button = nextButton(table);
  const seatCount = table.seats.length;
  const active = activeSeats(table);
  const headsUp = active.length === 2;
  const smallBlindSeat = headsUp ? button : nextIn(active, button, seatCount);
  const bigBlindSeat = nextIn(active, smallBlindSeat, seatCount);

  // Deal one card at a time starting left of the button, two rounds.
  const order: number[] = [];
  let seat = button;
  for (let i = 0; i < active.length; i++) {
    seat = nextIn(active, seat, seatCount);
    order.push(seat);
  }
  let rest = deck;
  const first = new Map<number, Card>();
  const second = new Map<number, Card>();
  for (const map of [first, second]) {
    for (const s of order) {
      const d = deal(rest, 1);
      map.set(s, d.cards[0]!);
      rest = d.deck;
    }
  }

  const players: HandSeat[] = active.map((s) => {
    const p = table.seats[s]!;
    const owed = s === smallBlindSeat ? blinds.small : s === bigBlindSeat ? blinds.big : 0;
    const bet = Math.min(owed, p.stack);
    const stack = p.stack - bet;
    return {
      seat: s,
      id: p.id,
      stack,
      bet,
      status: stack === 0 ? "allIn" : "active",
      hole: [first.get(s)!, second.get(s)!],
    };
  });

  // Preflop: first able player left of the big blind (heads-up that is the dealer).
  const canAct = players.filter((p) => p.status === "active").map((p) => p.seat);
  const toAct = canAct.length === 0 ? null : nextIn(canAct, bigBlindSeat, seatCount);

  return { street: "preflop", button, smallBlindSeat, bigBlindSeat, blinds, players, board: [], pot: 0, toAct, deck: rest };
}

const NEXT_STREET: Record<Street, { next: Street; count: number } | null> = {
  preflop: { next: "flop", count: 3 },
  flop: { next: "turn", count: 1 },
  turn: { next: "river", count: 1 },
  river: null,
};

/** Deal the next street's community cards (flop 3, turn 1, river 1), in order. Throws after the river. */
export function dealNextStreet(hand: HandState): HandState {
  const step = NEXT_STREET[hand.street];
  if (!step) throw new TableError("The river is already dealt");
  const { cards, deck } = deal(hand.deck, step.count);
  return { ...hand, street: step.next, board: [...hand.board, ...cards], deck };
}
