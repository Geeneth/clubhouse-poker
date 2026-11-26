import { assertValidCards, RANKS, SUITS, type Card } from "./cards";

/** A deck is an ordered, read-only list of cards. The next card to deal is at index 0. */
export type Deck = readonly Card[];

export class EmptyDeckError extends Error {
  constructor(requested: number, remaining: number) {
    super(`Cannot deal ${requested} card(s): only ${remaining} left in the deck`);
    this.name = "EmptyDeckError";
  }
}

/** A fresh, ordered 52-card deck. */
export function createDeck(): Deck {
  return SUITS.flatMap((suit) => RANKS.map((rank): Card => ({ rank, suit })));
}

export class InvalidDeckError extends Error {
  constructor(reason: string) {
    super(`Invalid deck: ${reason}`);
    this.name = "InvalidDeckError";
  }
}

export class InvalidSeedError extends Error {
  constructor(seed: unknown) {
    super(`Invalid seed: ${String(seed)} (must be a finite integer)`);
    this.name = "InvalidSeedError";
  }
}

/** mulberry32: small deterministic PRNG. Returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle. Same seed always gives the same order. Does not modify the input. */
export function shuffle(deck: Deck, seed: number): Deck {
  if (typeof seed !== "number" || !Number.isInteger(seed)) throw new InvalidSeedError(seed);
  assertValidCards(deck);
  if (deck.length !== 52) {
    throw new InvalidDeckError(`a deck to shuffle needs all 52 cards, got ${deck.length}`);
  }
  const rand = mulberry32(seed);
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

/** Deal `count` cards off the top. Returns the cards and the remaining deck; the input is unchanged. */
export function deal(deck: Deck, count = 1): { cards: Card[]; deck: Deck } {
  if (!Number.isInteger(count) || count < 0) {
    throw new RangeError(`Cannot deal ${count} cards`);
  }
  assertValidCards(deck);
  if (count > deck.length) throw new EmptyDeckError(count, deck.length);
  return { cards: deck.slice(0, count), deck: deck.slice(count) };
}
