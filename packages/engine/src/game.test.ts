import { describe, expect, test } from "vitest";
import {
  applyAction, createDeck, createTable, legalActions, nextHand, settleHand, settleShowdown, shuffle, startHand,
  TableError, type Action, type HandResult, type HandState, type Table,
} from "./index";

const blinds = { small: 5, big: 10 };
type Strategy = (h: HandState) => Action;

/** Everyone goes all-in (or calls an all-in they cannot raise). */
const shove: Strategy = (h) => {
  const types = legalActions(h).map((a) => a.type);
  return types.includes("allIn") ? { type: "allIn" } : types.includes("call") ? { type: "call" } : { type: "check" };
};
/** Fold when facing a bet, check otherwise: the big blind wins the blinds. */
const fold: Strategy = (h) => (legalActions(h).some((a) => a.type === "check") ? { type: "check" } : { type: "fold" });
/** Call or check everything down to showdown. */
const callDown: Strategy = (h) => (legalActions(h).some((a) => a.type === "check") ? { type: "check" } : { type: "call" });

/** Start a hand on `t` with a fixed seed, play it with `pick`, and pay it out. */
function play(t: Table, seed: number, pick: Strategy): { start: HandState; result: HandResult } {
  const start = startHand(t, shuffle(createDeck(), seed), blinds);
  let h = settleHand(start);
  while (h.stage === "betting") {
    const p = h.players.find((x) => x.seat === h.toAct)!;
    const r = applyAction(h, p.id, pick(h));
    if (!r.ok) throw new Error(r.reason);
    h = r.hand;
  }
  return { start, result: settleShowdown(h) };
}

const stacks = (t: Table) => t.seats.map((s) => (s ? s.stack : null));
const total = (t: Table) => t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0);

describe("nextHand", () => {
  test("blinds-only hands: stacks, button and blinds move each hand", () => {
    let t: Table = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 100 }, { id: "c", stack: 100 }]);
    const seen: { button: number; sb: number; bb: number; stacks: (number | null)[] }[] = [];
    for (let i = 0; i < 4; i++) {
      const { start, result } = play(t, 11 + i, fold);
      const n = nextHand(t, result.hand);
      expect(n.gameOver).toBeNull();
      expect(n.busted).toEqual([]);
      t = n.table;
      seen.push({ button: start.button, sb: start.smallBlindSeat, bb: start.bigBlindSeat, stacks: stacks(t) });
      expect(total(t)).toBe(300);
    }
    expect(seen).toEqual([
      { button: 0, sb: 1, bb: 2, stacks: [100, 95, 105] },
      { button: 1, sb: 2, bb: 0, stacks: [105, 95, 100] },
      { button: 2, sb: 0, bb: 1, stacks: [100, 100, 100] },
      { button: 0, sb: 1, bb: 2, stacks: [100, 95, 105] },
    ]);
  });

  test("plays a game to the end: side pots, busts, button skipping and the winner", () => {
    let t: Table = createTable([{ id: "a", stack: 100 }, null, { id: "b", stack: 150 }, { id: "c", stack: 50 }]);

    // Hand 1 (seed 1): button seat 0. Everyone all-in. c's straight wins the 150 main pot,
    // b's pair beats a's high card for the 100 side pot, and b's uncalled 50 comes back.
    const h1 = play(t, 1, shove);
    expect([h1.start.button, h1.start.smallBlindSeat, h1.start.bigBlindSeat]).toEqual([0, 2, 3]);
    expect(h1.result.winnings).toEqual({ c: 150, b: 150 });
    const n1 = nextHand(t, h1.result.hand);
    t = n1.table;
    expect(stacks(t)).toEqual([0, null, 150, 150]);
    expect(t.button).toBe(0);
    expect(n1.busted).toEqual(["a"]);
    expect(n1.knockedOut).toEqual(["a"]);
    expect(n1.gameOver).toBeNull();
    expect(total(t)).toBe(300);

    // Hand 2 (seed 2): a is busted and skipped. The button moves past the empty seat to b (seat 2);
    // heads-up, so b posts the small blind and c the big blind. c's straight wins everything.
    const h2 = play(t, 2, shove);
    expect(h2.start.players.map((p) => p.id)).toEqual(["b", "c"]);
    expect([h2.start.button, h2.start.smallBlindSeat, h2.start.bigBlindSeat]).toEqual([2, 2, 3]);
    expect(h2.start.players.map((p) => p.bet)).toEqual([5, 10]);
    const n2 = nextHand(t, h2.result.hand);
    t = n2.table;
    expect(stacks(t)).toEqual([0, null, 0, 300]);
    expect(n2.busted).toEqual(["a", "b"]);
    expect(n2.knockedOut).toEqual(["b"]);
    expect(n2.gameOver).toEqual({ winner: "c" });
    expect(total(t)).toBe(300);

    // No further hand can start.
    expect(() => startHand(t, shuffle(createDeck(), 3), blinds)).toThrow(TableError);
  });

  test("busted seats get no cards, no blinds and never the button", () => {
    // Seat 1 busts in hand 1; after that the button and blinds rotate over seats 0, 2 and 3 only.
    let t: Table = createTable([
      { id: "a", stack: 200 }, { id: "b", stack: 20 }, { id: "c", stack: 200 }, { id: "d", stack: 200 },
    ]);
    // Hand 1: button 0, SB b (seat 1), BB c. b shoves for 20 and everyone calls down.
    let h = settleHand(startHand(t, shuffle(createDeck(), 1), blinds));
    while (h.stage === "betting") {
      const p = h.players.find((x) => x.seat === h.toAct)!;
      const r = applyAction(h, p.id, p.id === "b" ? { type: "allIn" } : callDown(h));
      if (!r.ok) throw new Error(r.reason);
      h = r.hand;
    }
    const r1 = settleShowdown(h);
    const n1 = nextHand(t, r1.hand);
    t = n1.table;
    expect(total(t)).toBe(620);
    if (n1.busted.length === 0) throw new Error("seed 1 was chosen so that b loses; pick another seed");
    expect(r1.winnings).toEqual({ c: 80 });
    expect(stacks(t)).toEqual([180, 0, 260, 180]);
    expect(n1.busted).toEqual(["b"]);

    const buttons: number[] = [];
    for (let i = 0; i < 4; i++) {
      const { start, result } = play(t, 20 + i, fold);
      expect(start.players.map((p) => p.seat)).toEqual([0, 2, 3]);
      expect([start.smallBlindSeat, start.bigBlindSeat]).not.toContain(1);
      buttons.push(start.button);
      t = nextHand(t, result.hand).table;
      expect(t.seats[1]!.stack).toBe(0);
      expect(total(t)).toBe(620);
    }
    expect(buttons).toEqual([2, 3, 0, 2]);
  });

  test("chips are conserved over a long game until one player has them all", () => {
    let t: Table = createTable([
      { id: "a", stack: 120 }, { id: "b", stack: 80 }, null, { id: "c", stack: 200 }, { id: "d", stack: 100 },
    ]);
    const strategies = [callDown, fold, shove];
    let over: { winner: string } | null = null;
    let hands = 0;
    let lastButton: number | null = null;
    for (let seed = 100; seed < 300 && !over; seed++) {
      const { start, result } = play(t, seed, strategies[seed % 3]!);
      if (lastButton !== null) expect(start.button).not.toBe(lastButton);
      lastButton = start.button;
      const n = nextHand(t, result.hand);
      for (const s of n.table.seats) if (s) expect(Number.isInteger(s.stack) && s.stack >= 0).toBe(true);
      expect(total(n.table)).toBe(500);
      for (const id of n.busted) expect(n.table.seats.find((s) => s?.id === id)!.stack).toBe(0);
      t = n.table;
      over = n.gameOver;
      hands++;
    }
    expect(over).not.toBeNull();
    expect(t.seats.find((s) => s?.id === over!.winner)!.stack).toBe(500);
    expect(hands).toBeGreaterThan(1);
  });

  test("rejects a hand that is not paid out", () => {
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 100 }]);
    const h = settleHand(startHand(t, shuffle(createDeck(), 1), blinds));
    expect(() => nextHand(t, h)).toThrow(TableError);
    const folded = applyAction(h, h.players.find((p) => p.seat === h.toAct)!.id, { type: "fold" });
    if (!folded.ok) throw new Error(folded.reason);
    expect(() => nextHand(t, folded.hand)).toThrow(TableError);
    expect(nextHand(t, settleShowdown(folded.hand).hand).table.seats.map((s) => s!.stack)).toEqual([95, 105]);
  });

  test("rejects a hand from a different table", () => {
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 100 }]);
    const { result } = play(t, 1, fold);
    const otherIds = createTable([{ id: "x", stack: 100 }, { id: "b", stack: 100 }]);
    expect(() => nextHand(otherIds, result.hand)).toThrow(TableError);
    const otherStacks = createTable([{ id: "a", stack: 300 }, { id: "b", stack: 100 }]);
    expect(() => nextHand(otherStacks, result.hand)).toThrow(TableError);
  });

  test("does not modify its inputs", () => {
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 100 }, { id: "c", stack: 100 }]);
    const { result } = play(t, 3, fold);
    const before = JSON.stringify([t, result.hand]);
    nextHand(t, result.hand);
    expect(JSON.stringify([t, result.hand])).toBe(before);
  });
});
