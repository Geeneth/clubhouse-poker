import { assertValidCards, type Card } from "./cards";

export const HAND_CATEGORIES = [
  "high-card",
  "pair",
  "two-pair",
  "three-of-a-kind",
  "straight",
  "flush",
  "full-house",
  "four-of-a-kind",
  "straight-flush",
] as const;
export type HandCategory = (typeof HAND_CATEGORIES)[number];

export interface HandValue {
  readonly category: HandCategory;
  /** Ranks that decide ties within the category, most important first. A wheel straight is [5]. */
  readonly tiebreak: readonly number[];
  /** The five cards that make the hand. */
  readonly cards: readonly Card[];
}

function evaluateFive(cards: readonly Card[]): HandValue {
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  // Group by count desc, then rank desc.
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0]!.suit);
  const sorted = cards.map((c) => c.rank as number).sort((a, b) => b - a);
  let straightHigh = 0;
  if (groups.length === 5) {
    if (sorted[0]! - sorted[4]! === 4) straightHigh = sorted[0]!;
    else if (sorted.join() === "14,5,4,3,2") straightHigh = 5; // wheel
  }
  const shape = groups.map((g) => g[1]).join("");
  const ranks = groups.map((g) => g[0]);
  const make = (category: HandCategory, tiebreak: readonly number[]): HandValue => ({
    category,
    tiebreak,
    cards,
  });
  if (straightHigh && flush) return make("straight-flush", [straightHigh]);
  if (shape === "41") return make("four-of-a-kind", ranks);
  if (shape === "32") return make("full-house", ranks);
  if (flush) return make("flush", ranks);
  if (straightHigh) return make("straight", [straightHigh]);
  if (shape === "311") return make("three-of-a-kind", ranks);
  if (shape === "221") return make("two-pair", ranks);
  if (shape === "2111") return make("pair", ranks);
  return make("high-card", ranks);
}

/** Compare two hand values: positive if a wins, negative if b wins, 0 for a tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  const d = HAND_CATEGORIES.indexOf(a.category) - HAND_CATEGORIES.indexOf(b.category);
  if (d !== 0) return d;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const diff = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Best five-card hand from 5 to 7 distinct cards (hole cards plus board). */
export function evaluateHand(cards: readonly Card[]): HandValue {
  if (cards.length < 5 || cards.length > 7) {
    throw new RangeError(`evaluateHand needs 5 to 7 cards, got ${cards.length}`);
  }
  assertValidCards(cards);
  let best: HandValue | undefined;
  const pick: Card[] = [];
  const walk = (start: number): void => {
    if (pick.length === 5) {
      const v = evaluateFive([...pick]);
      if (!best || compareHands(v, best) > 0) best = v;
      return;
    }
    for (let i = start; i < cards.length; i++) {
      pick.push(cards[i]!);
      walk(i + 1);
      pick.pop();
    }
  };
  walk(0);
  return best!;
}

/** Evaluate hole cards plus board. */
export function evaluateHoleAndBoard(hole: readonly Card[], board: readonly Card[]): HandValue {
  return evaluateHand([...hole, ...board]);
}

