export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export type Suit = (typeof SUITS)[number];

/** Ranks 2..14, where 11 = J, 12 = Q, 13 = K, 14 = A. */
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
export type Rank = (typeof RANKS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

const RANK_CHARS: Record<Rank, string> = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
  10: "T", 11: "J", 12: "Q", 13: "K", 14: "A",
};
const SUIT_CHARS: Record<Suit, string> = { clubs: "c", diamonds: "d", hearts: "h", spades: "s" };

/** Short unique id for a card, like "As" or "Td". */
export function cardId(card: Card): string {
  return RANK_CHARS[card.rank] + SUIT_CHARS[card.suit];
}

export class InvalidCardError extends Error {
  constructor(readonly card: unknown) {
    super(`Invalid card: ${describe(card)}`);
    this.name = "InvalidCardError";
  }
}

export class DuplicateCardError extends Error {
  constructor(readonly id: string) {
    super(`Duplicate card: ${id}`);
    this.name = "DuplicateCardError";
  }
}

function describe(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/** True only for the 52 real cards: integer rank 2..14 and one of the four suits. */
export function isValidCard(card: unknown): card is Card {
  if (typeof card !== "object" || card === null) return false;
  const { rank, suit } = card as { rank?: unknown; suit?: unknown };
  return (
    typeof rank === "number" &&
    Number.isInteger(rank) &&
    rank >= 2 &&
    rank <= 14 &&
    typeof suit === "string" &&
    (SUITS as readonly string[]).includes(suit)
  );
}

/** Throws InvalidCardError for any non-card, DuplicateCardError if a card repeats. */
export function assertValidCards(cards: readonly unknown[]): asserts cards is readonly Card[] {
  const seen = new Set<string>();
  for (const c of cards) {
    if (!isValidCard(c)) throw new InvalidCardError(c);
    const id = cardId(c);
    if (seen.has(id)) throw new DuplicateCardError(id);
    seen.add(id);
  }
}
