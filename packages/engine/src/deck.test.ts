import { describe, expect, test } from "vitest";
import {
  cardId,
  createDeck,
  deal,
  DuplicateCardError,
  EmptyDeckError,
  InvalidCardError,
  InvalidDeckError,
  InvalidSeedError,
  isValidSeed,
  MAX_SEED,
  shuffle,
} from "./index";

const ids = (cards: readonly { rank: number; suit: string }[]) =>
  cards.map((c) => cardId(c as never));

describe("cards", () => {
  test("a card has a rank and suit and a short id", () => {
    expect(cardId({ rank: 14, suit: "spades" })).toBe("As");
    expect(cardId({ rank: 10, suit: "diamonds" })).toBe("Td");
  });
});

describe("deck", () => {
  test("has exactly 52 unique cards", () => {
    const deck = createDeck();
    expect(deck).toHaveLength(52);
    expect(new Set(ids(deck)).size).toBe(52);
  });
});

describe("shuffle", () => {
  test("same seed gives the same order", () => {
    expect(ids(shuffle(createDeck(), 42))).toEqual(ids(shuffle(createDeck(), 42)));
  });
  test("different seeds give different orders", () => {
    const seen = new Set([1, 2, 3, 4, 5].map((s) => ids(shuffle(createDeck(), s)).join()));
    expect(seen.size).toBe(5);
  });
  test("keeps all 52 unique cards and does not modify the input", () => {
    const deck = createDeck();
    const before = ids(deck);
    const shuffled = shuffle(deck, 7);
    expect(ids(deck)).toEqual(before);
    expect([...ids(shuffled)].sort()).toEqual([...before].sort());
    expect(ids(shuffled)).not.toEqual(before);
  });
});

describe("deal", () => {
  test("removes cards from the deck and never deals a card twice", () => {
    let deck = shuffle(createDeck(), 99);
    const dealt: string[] = [];
    for (let i = 0; i < 13; i++) {
      const r = deal(deck, 4);
      expect(r.deck).toHaveLength(deck.length - 4);
      dealt.push(...ids(r.cards));
      deck = r.deck;
    }
    expect(dealt).toHaveLength(52);
    expect(new Set(dealt).size).toBe(52);
    expect(deck).toHaveLength(0);
  });
  test("deals from the top and leaves the input deck unchanged", () => {
    const deck = createDeck();
    const r = deal(deck, 2);
    expect(ids(r.cards)).toEqual(ids(deck.slice(0, 2)));
    expect(deck).toHaveLength(52);
  });
  test("defaults to one card", () => {
    expect(deal(createDeck()).cards).toHaveLength(1);
  });
  test("dealing from an empty deck throws a clear error", () => {
    const empty = deal(createDeck(), 52).deck;
    expect(() => deal(empty)).toThrow(EmptyDeckError);
    expect(() => deal(empty)).toThrow(/only 0 left/);
  });
  test("dealing more than remains throws and deals nothing", () => {
    expect(() => deal(createDeck().slice(0, 3), 5)).toThrow(EmptyDeckError);
  });
  test("rejects invalid counts", () => {
    expect(() => deal(createDeck(), -1)).toThrow(RangeError);
    expect(() => deal(createDeck(), 1.5)).toThrow(RangeError);
  });
});

describe("validation", () => {
  const bad = [
    ["rank 15", { rank: 15, suit: "clubs" }],
    ["rank 1", { rank: 1, suit: "clubs" }],
    ["fractional rank", { rank: 2.5, suit: "clubs" }],
    ["string rank", { rank: "2", suit: "clubs" }],
    ["made-up suit", { rank: 5, suit: "a" }],
    ["null", null],
  ] as const;
  for (const [name, card] of bad) {
    test(`rejects ${name} in shuffle and deal`, () => {
      const deck = [...createDeck().slice(1), card as never];
      expect(() => shuffle(deck, 1)).toThrow(InvalidCardError);
      expect(() => deal(deck, 1)).toThrow(InvalidCardError);
    });
  }
  test("rejects duplicate or missing cards when shuffling", () => {
    const full = createDeck();
    expect(() => shuffle([...full.slice(1), full[1]!], 1)).toThrow(DuplicateCardError);
    expect(() => shuffle(full.slice(1), 1)).toThrow(InvalidDeckError);
    expect(() => shuffle([...full, full[0]!], 1)).toThrow(DuplicateCardError);
  });
  test("deal rejects a deck with duplicates", () => {
    const c = createDeck()[0]!;
    expect(() => deal([c, c], 1)).toThrow(DuplicateCardError);
  });
  test("rejects invalid seeds", () => {
    for (const seed of [NaN, Infinity, -Infinity, 1.5, "1" as never]) {
      expect(() => shuffle(createDeck(), seed)).toThrow(InvalidSeedError);
    }
  });
});

describe("shuffle seed range (CLB-20)", () => {
  const order = (seed: number) => ids(shuffle(createDeck(), seed)).join();

  test("MAX_SEED is 2^32 - 1", () => {
    expect(MAX_SEED).toBe(4_294_967_295);
    expect(MAX_SEED).toBe(2 ** 32 - 1);
  });

  test("playtest: 1 + 2^32 is rejected instead of aliasing seed 1", () => {
    expect(() => shuffle(createDeck(), 1 + 2 ** 32)).toThrow(InvalidSeedError);
    expect(() => shuffle(createDeck(), 1)).not.toThrow();
  });

  test("playtest: 1.5 is rejected instead of aliasing seed 1", () => {
    expect(() => shuffle(createDeck(), 1.5)).toThrow(InvalidSeedError);
  });

  test("playtest: NaN is rejected instead of aliasing seed 0", () => {
    expect(() => shuffle(createDeck(), NaN)).toThrow(InvalidSeedError);
  });

  test("playtest: Infinity and -Infinity are rejected", () => {
    expect(() => shuffle(createDeck(), Infinity)).toThrow(InvalidSeedError);
    expect(() => shuffle(createDeck(), -Infinity)).toThrow(InvalidSeedError);
  });

  test("playtest: the string 'abc' is rejected", () => {
    expect(() => shuffle(createDeck(), "abc" as never)).toThrow(InvalidSeedError);
  });

  test("playtest: -1 is rejected instead of aliasing 2^32 - 1", () => {
    expect(() => shuffle(createDeck(), -1)).toThrow(InvalidSeedError);
    expect(() => shuffle(createDeck(), MAX_SEED)).not.toThrow();
  });

  test.each([
    ["a negative number", -3],
    ["-0.5", -0.5],
    ["2^32", 2 ** 32],
    ["MAX_SAFE_INTEGER", Number.MAX_SAFE_INTEGER],
    ["a huge timestamp-like value", 1_732_700_000_000],
    ["a numeric string", "1"],
    ["a bigint", 1n],
    ["null", null],
    ["undefined", undefined],
    ["an object", {}],
    ["a boxed number", new Number(1)],
    ["true", true],
  ])("rejects %s", (_name, seed) => {
    expect(() => shuffle(createDeck(), seed as never)).toThrow(InvalidSeedError);
    expect(isValidSeed(seed)).toBe(false);
  });

  test("the error is typed, names itself and carries the rejected seed", () => {
    let caught: unknown;
    try {
      shuffle(createDeck(), -1);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(InvalidSeedError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as InvalidSeedError;
    expect(err.name).toBe("InvalidSeedError");
    expect(err.seed).toBe(-1);
    expect(err.message).toBe("Invalid seed: -1 (must be a whole number from 0 to 4294967295)");
  });

  test("the seed is checked before the deck", () => {
    expect(() => shuffle([], -1)).toThrow(InvalidSeedError);
  });

  test("accepts the edges 0 and 4,294,967,295", () => {
    for (const seed of [0, 1, MAX_SEED - 1, MAX_SEED]) {
      expect(isValidSeed(seed)).toBe(true);
      const shuffled = shuffle(createDeck(), seed);
      expect(new Set(ids(shuffled)).size).toBe(52);
    }
  });

  test("-0 is accepted and is the same seed as 0", () => {
    expect(isValidSeed(-0)).toBe(true);
    expect(order(-0)).toBe(order(0));
  });

  test("every accepted seed gives its own deck: edges and neighbours are all distinct", () => {
    const seeds = [0, 1, 2, 0x7fffffff, 0x80000000, MAX_SEED - 2, MAX_SEED - 1, MAX_SEED];
    const orders = seeds.map(order);
    expect(new Set(orders).size).toBe(seeds.length);
  });

  test("every accepted seed gives its own deck: a sweep of 2,000 seeds across the range has no repeats", () => {
    const seen = new Set<string>();
    const step = Math.floor(MAX_SEED / 1000);
    const seeds: number[] = [];
    for (let i = 0; i < 1000; i++) seeds.push(i, i * step + 1000);
    for (const seed of seeds) seen.add(order(seed));
    expect(seen.size).toBe(new Set(seeds).size);
  });
});
