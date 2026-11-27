import { describe, expect, test } from "vitest";
import {
  cardId, createDeck, createTable, dealNextStreet, nextButton, shuffle, startHand, tableAfterHand,
  InvalidStackError, MAX_STACK, MAX_TABLE_CHIPS, TableError, type Seat, type Table,
} from "./index";

const blinds = { small: 5, big: 10 };
const deck = () => shuffle(createDeck(), 42);
const players = (n: number, stack = 100): Seat[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, stack }));
const table = (n: number, stack = 100) => createTable(players(n, stack));
const total = (h: ReturnType<typeof startHand>) => h.players.reduce((s, p) => s + p.stack + p.bet, 0);

describe("createTable", () => {
  test("accepts 2 to 8 players, rejects others", () => {
    expect(() => table(1)).toThrow(TableError);
    expect(() => table(2)).not.toThrow();
    expect(() => table(8)).not.toThrow();
    expect(() => table(9)).toThrow(TableError);
  });
  test("rejects bad stacks and duplicate ids", () => {
    expect(() => createTable([{ id: "a", stack: -1 }, { id: "b", stack: 5 }])).toThrow(TableError);
    expect(() => createTable([{ id: "a", stack: 1.5 }, { id: "b", stack: 5 }])).toThrow(TableError);
    expect(() => createTable([{ id: "a", stack: 5 }, { id: "a", stack: 5 }])).toThrow(TableError);
  });
  test("stacks must be whole numbers from 1 to 1,000,000,000", () => {
    const withStack = (stack: unknown) => () => createTable([{ id: "a", stack: stack as number }, { id: "b", stack: 5 }]);
    expect(MAX_STACK).toBe(1_000_000_000);
    expect(withStack(1)).not.toThrow();
    expect(withStack(1_000_000_000)).not.toThrow();
    for (const bad of [0, -1, -0, 1.5, 1_000_000_001, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, "100", null, undefined, {}, 10n]) {
      expect(withStack(bad), String(bad)).toThrow(InvalidStackError);
    }
    // the typed error is also a TableError, and says what is allowed
    expect(withStack(0)).toThrow(TableError);
    expect(withStack(0)).toThrow(/whole number from 1 to 1,000,000,000/);
  });

  test("playtest case: two stacks of Number.MAX_SAFE_INTEGER are rejected", () => {
    const huge = Number.MAX_SAFE_INTEGER;
    expect(() => createTable([{ id: "a", stack: huge }, { id: "b", stack: huge }])).toThrow(InvalidStackError);
  });

  test("8 players at the cap: chip totals stay exact", () => {
    const h = startHand(table(8, MAX_STACK), deck(), blinds);
    expect(total(h)).toBe(8 * MAX_STACK);
    expect(Number.isSafeInteger(total(h))).toBe(true);
  });

  test("empty seats are allowed", () => {
    expect(() => createTable([{ id: "a", stack: 5 }, null, { id: "b", stack: 5 }])).not.toThrow();
  });
});

describe("startHand", () => {
  test("3 players: blinds left of the button, first to act is the button", () => {
    const h = startHand(table(3), deck(), blinds);
    expect(h.button).toBe(0);
    expect(h.smallBlindSeat).toBe(1);
    expect(h.bigBlindSeat).toBe(2);
    expect(h.players.map((p) => p.bet)).toEqual([0, 5, 10]);
    expect(h.players.map((p) => p.stack)).toEqual([100, 95, 90]);
    expect(h.toAct).toBe(0);
    expect(h.street).toBe("preflop");
    expect(total(h)).toBe(300);
  });

  test("heads-up: dealer posts the small blind and acts first", () => {
    const h = startHand(table(2), deck(), blinds);
    expect(h.button).toBe(0);
    expect(h.smallBlindSeat).toBe(0);
    expect(h.bigBlindSeat).toBe(1);
    expect(h.players.map((p) => p.bet)).toEqual([5, 10]);
    expect(h.toAct).toBe(0);
  });

  test("8 players: everyone gets 2 distinct cards, dealing starts left of the button", () => {
    const d = deck();
    const h = startHand(table(8), d, blinds);
    expect(h.players).toHaveLength(8);
    expect(h.toAct).toBe(3);
    // button is seat 0, so seat 1 gets the first card and seat 1's second card is the 9th.
    expect(cardId(h.players[1]!.hole[0])).toBe(cardId(d[0]!));
    expect(cardId(h.players[2]!.hole[0])).toBe(cardId(d[1]!));
    expect(cardId(h.players[0]!.hole[0])).toBe(cardId(d[7]!));
    expect(cardId(h.players[1]!.hole[1])).toBe(cardId(d[8]!));
    const ids = [...h.players.flatMap((p) => p.hole), ...h.deck].map(cardId);
    expect(new Set(ids).size).toBe(52);
    expect(h.deck).toHaveLength(36);
    expect(total(h)).toBe(800);
  });

  test("short stacks post what they have and are all-in", () => {
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 3 }, { id: "c", stack: 7 }]);
    const h = startHand(t, deck(), blinds);
    expect(h.players[1]).toMatchObject({ bet: 3, stack: 0, status: "allIn" });
    expect(h.players[2]).toMatchObject({ bet: 7, stack: 0, status: "allIn" });
    expect(h.toAct).toBe(0);
  });

  test("a stack exactly equal to the blind is all-in", () => {
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 5 }, { id: "c", stack: 100 }]);
    expect(startHand(t, deck(), blinds).players[1]).toMatchObject({ bet: 5, stack: 0, status: "allIn" });
  });

  test("nobody left to act when everyone is all-in", () => {
    const h = startHand(table(2, 4), deck(), blinds);
    expect(h.players.every((p) => p.status === "allIn")).toBe(true);
    expect(h.toAct).toBeNull();
  });

  test("rejects bad decks, bad blinds and tables with fewer than 2 funded players", () => {
    expect(() => startHand(table(3), deck().slice(1), blinds)).toThrow(TableError);
    expect(() => startHand(table(3), [...deck().slice(1), deck()[1]!], blinds)).toThrow(TableError);
    expect(() => startHand(table(3), deck(), { small: 10, big: 5 })).toThrow(TableError);
    expect(() => startHand(table(3), deck(), { small: 0, big: 5 })).toThrow(TableError);
    expect(() => startHand(table(3), deck(), { small: 2.5, big: 5 })).toThrow(TableError);
    const t2 = createTable([{ id: "a", stack: 10 }, { id: "b", stack: 10 }]);
    const broke: Table = { ...t2, seats: t2.seats.map((s, i) => (i === 1 ? { ...s!, stack: 0 } : s)) }; // b busted in play

    expect(() => startHand(broke, deck(), blinds)).toThrow(TableError);
  });

  describe("checks the stacks of the table it is given", () => {
    // Tables can be built by hand (for example for the next hand), so startHand checks them too.
    const raw = (...stacks: unknown[]): Table =>
      ({ seats: stacks.map((stack, i) => ({ id: `p${i}`, stack: stack as number })), button: null });

    test("playtest case: two stacks of Number.MAX_SAFE_INTEGER are rejected", () => {
      const huge = Number.MAX_SAFE_INTEGER;
      expect(() => startHand(raw(huge, huge), deck(), blinds)).toThrow(InvalidStackError);
    });

    test("rejects fractional, negative, NaN, infinite, too large and non-number stacks", () => {
      for (const bad of [1.5, -5, -1, NaN, Infinity, -Infinity, MAX_TABLE_CHIPS + 1, 5_000_000_000 * 4, "100", null, undefined, {}, 10n]) {
        expect(() => startHand(raw(bad, 100), deck(), blinds), String(bad)).toThrow(InvalidStackError);
        expect(() => startHand(raw(100, 100, bad), deck(), blinds), String(bad)).toThrow(InvalidStackError);
      }
      expect(() => startHand(raw(1.5, 100), deck(), blinds)).toThrow(/whole number from 0 to 16,000,000,000/);
    });

    test("rejects a table whose total is over the cap, even if each stack is under it", () => {
      const half = MAX_TABLE_CHIPS / 2;
      expect(() => startHand(raw(half, half, 1), deck(), blinds)).toThrow(InvalidStackError);
      expect(() => startHand(raw(half, half, 1), deck(), blinds)).toThrow(/total of at most 16,000,000,000/);
    });

    test("accepts busted (0) seats and stacks above MAX_STACK won in play", () => {
      expect(MAX_TABLE_CHIPS).toBe(16_000_000_000);
      const h = startHand(raw(0, MAX_STACK, 0, MAX_STACK), deck(), blinds);
      expect(h.players.map((p) => p.seat)).toEqual([1, 3]);
      const big = startHand(raw(MAX_TABLE_CHIPS - 1, 1), deck(), blinds);
      expect(total(big)).toBe(MAX_TABLE_CHIPS);
    });
  });

  test("does not modify its inputs and is deterministic", () => {
    const t = table(4);
    const d = deck();
    const a = startHand(t, d, blinds);
    expect(t.button).toBeNull();
    expect(d).toHaveLength(52);
    expect(startHand(t, d, blinds)).toEqual(a);
  });
});

describe("button movement", () => {
  test("moves one seat each hand and wraps around", () => {
    let t: Table = table(3);
    const buttons: number[] = [];
    for (let i = 0; i < 5; i++) {
      const h = startHand(t, deck(), blinds);
      buttons.push(h.button);
      t = tableAfterHand(t, h);
    }
    expect(buttons).toEqual([0, 1, 2, 0, 1]);
  });

  test("skips empty and busted seats", () => {
    const start = createTable([
      { id: "a", stack: 50 }, null, { id: "b", stack: 50 }, { id: "c", stack: 50 }, { id: "d", stack: 50 },
    ]);
    // b busted in play
    const t0: Table = { ...start, seats: start.seats.map((s, i) => (i === 2 ? { ...s!, stack: 0 } : s)) };
    let t: Table = t0;
    const buttons: number[] = [];
    for (let i = 0; i < 4; i++) {
      const h = startHand(t, deck(), blinds);
      buttons.push(h.button);
      t = tableAfterHand(t, h);
    }
    expect(buttons).toEqual([0, 3, 4, 0]);
  });

  test("blinds follow the button, and heads-up applies once players bust", () => {
    let t: Table = table(3);
    let h = startHand(t, deck(), blinds);
    t = tableAfterHand(t, h);
    h = startHand(t, deck(), blinds); // button 1
    expect([h.smallBlindSeat, h.bigBlindSeat]).toEqual([2, 0]);
    // seat 2 busts: now heads-up between seats 0 and 1
    const seats = t.seats.map((s, i) => (i === 2 ? { ...s!, stack: 0 } : s));
    t = { seats, button: h.button };
    h = startHand(t, deck(), blinds);
    expect(h.button).toBe(0);
    expect([h.smallBlindSeat, h.bigBlindSeat]).toEqual([0, 1]);
    expect(nextButton(tableAfterHand(t, h))).toBe(1);
  });
});

describe("streets", () => {
  test("flop, turn and river are dealt in order from the deck", () => {
    const h0 = startHand(table(3), deck(), blinds);
    const remaining = [...h0.deck];
    const flop = dealNextStreet(h0);
    expect(flop.street).toBe("flop");
    expect(flop.board.map(cardId)).toEqual(remaining.slice(0, 3).map(cardId));
    const turn = dealNextStreet(flop);
    expect(turn.street).toBe("turn");
    expect(turn.board).toHaveLength(4);
    const river = dealNextStreet(turn);
    expect(river.street).toBe("river");
    expect(river.board.map(cardId)).toEqual(remaining.slice(0, 5).map(cardId));
    expect(river.deck).toHaveLength(remaining.length - 5);
    const all = [...river.players.flatMap((p) => p.hole), ...river.board, ...river.deck].map(cardId);
    expect(new Set(all).size).toBe(52);
    expect(() => dealNextStreet(river)).toThrow(TableError);
    expect(h0.board).toHaveLength(0);
  });
});
