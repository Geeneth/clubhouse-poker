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
