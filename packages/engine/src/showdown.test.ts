import { describe, expect, test } from "vitest";
import {
  applyAction, buildPots, createDeck, createTable, settleHand, settleShowdown, shuffle, startHand,
  type Action, type Card, type HandState, type Seat,
} from "./index";

const c = (rank: number, suit: Card["suit"]): Card => ({ rank, suit }) as Card;
const blinds = { small: 5, big: 10 };
const mk = (stacks: number[], seed = 7): HandState =>
  settleHand(startHand(createTable(stacks.map((stack, i): Seat => ({ id: `p${i}`, stack }))), shuffle(createDeck(), seed), blinds));
const act = (h: HandState, id: string, a: Action): HandState => {
  const r = applyAction(h, id, a);
  if (!r.ok) throw new Error(r.reason);
  return r.hand;
};
const M = (o: Record<string, number>) => new Map(Object.entries(o));
const chips = (h: HandState) => h.pot + h.players.reduce((s, p) => s + p.stack + p.bet, 0);
const P = (id: string, contributed: number, status: "active" | "allIn" | "folded" = "allIn") => ({ id, contributed, status });
/** Give players fixed hole cards and a fixed board, keeping everything else. */
const rig = (h: HandState, holes: Record<string, [Card, Card]>, board: Card[]): HandState => ({
  ...h, board, players: h.players.map((p) => ({ ...p, hole: Object.hasOwn(holes, p.id) ? holes[p.id]! : p.hole })),
});

describe("buildPots", () => {
  test("one pot when everyone put in the same", () => {
    expect(buildPots([P("a", 50), P("b", 50), P("c", 50)])).toEqual([{ amount: 150, eligible: ["a", "b", "c"] }]);
  });
  test("three-way all-in with different stacks makes a main pot and two side pots", () => {
    expect(buildPots([P("a", 30), P("b", 80), P("c", 200)])).toEqual([
      { amount: 90, eligible: ["a", "b", "c"] },
      { amount: 100, eligible: ["b", "c"] },
      { amount: 120, eligible: ["c"] },
    ]);
  });
  test("folded chips fill pots but the folder is not eligible", () => {
    expect(buildPots([P("a", 30), P("b", 80, "folded"), P("c", 100, "active"), P("d", 100, "active")])).toEqual([
      { amount: 120, eligible: ["a", "c", "d"] },
      { amount: 190, eligible: ["c", "d"] },
    ]);
  });
  test("a folded contribution above every live level goes in the last pot", () => {
    const pots = buildPots([P("a", 20), P("b", 50, "folded")]);
    expect(pots).toEqual([{ amount: 70, eligible: ["a"] }]);
  });
});

describe("settleShowdown", () => {
  const board = [c(2, "clubs"), c(7, "diamonds"), c(9, "hearts"), c(11, "spades"), c(13, "clubs")];
  const allIn = (stacks: number[]) => {
    let h = mk(stacks);
    while (h.stage === "betting") h = act(h, h.players.find((p) => p.seat === h.toAct)!.id, { type: "allIn" });
    return h;
  };

  test("three-way all-in: each pot goes to the best eligible hand", () => {
    // p0 (30) best hand, p1 (80) second, p2 (200) worst. p2's uncalled excess returns to them.
    const h = rig(allIn([30, 80, 200]), {
      p0: [c(14, "spades"), c(14, "hearts")], // pair of aces
      p1: [c(13, "hearts"), c(3, "diamonds")], // pair of kings
      p2: [c(12, "hearts"), c(4, "diamonds")], // queen high
    }, board);
    expect(h.stage).toBe("showdown");
    const r = settleShowdown(h);
    expect(r.awards.map((a) => a.pot.amount)).toEqual([90, 100, 120]);
    const stack = (id: string) => r.hand.players.find((p) => p.id === id)!.stack;
    expect(stack("p0")).toBe(90);
    expect(stack("p1")).toBe(100);
    expect(stack("p2")).toBe(120);
    expect(r.hand.pot).toBe(0);
    expect(r.hand.stage).toBe("complete");
    expect(r.revealed.map((x) => x.id).sort()).toEqual(["p0", "p1", "p2"]);
  });

  test("short stack has the best hand but cannot win the side pots", () => {
    const h = rig(allIn([30, 80, 200]), {
      p0: [c(14, "spades"), c(14, "hearts")],
      p1: [c(12, "hearts"), c(4, "diamonds")],
      p2: [c(13, "hearts"), c(3, "diamonds")],
    }, board);
    const r = settleShowdown(h);
    expect(r.winnings).toEqual(M({ p0: 90, p2: 220 }));
  });

  test("tied side pot splits evenly and the odd chip goes left of the button", () => {
    // Both p1 and p2 play the board's straight (royal-ish board) and tie; p0 is the short stack with a worse hand.
    const tieBoard = [c(10, "clubs"), c(11, "diamonds"), c(12, "hearts"), c(13, "spades"), c(14, "clubs")];
    const base = allIn([31, 82, 82]); // pots: 93 main, then 102 side (even) -> adjust below for odd
    const h = rig(base, {
      p0: [c(2, "spades"), c(3, "hearts")],
      p1: [c(4, "spades"), c(5, "hearts")],
      p2: [c(6, "spades"), c(7, "hearts")],
    }, tieBoard);
    const r = settleShowdown(h);
    // main pot 93 split three ways (31 each); side pot 102 split two ways (51 each): no odd chip
    expect(r.winnings).toEqual(M({ p0: 31, p1: 51 + 31, p2: 51 + 31 }));
    expect(chips(r.hand)).toBe(chips(h));
  });

  test("odd chip in a split side pot goes to the tied winner closest left of the button", () => {
    const tieBoard = [c(10, "clubs"), c(11, "diamonds"), c(12, "hearts"), c(13, "spades"), c(14, "clubs")];
    const base = allIn([20, 51, 51, 51]); // button p0; side pot: 31*3 = 93 split by 3? use 2 tied via folds
    const h0 = rig(base, {
      p0: [c(2, "spades"), c(3, "hearts")],
      p1: [c(4, "spades"), c(5, "hearts")],
      p2: [c(6, "spades"), c(7, "hearts")],
      p3: [c(8, "spades"), c(9, "hearts")],
    }, tieBoard);
    // everyone ties on the broadway board: main 80 over 4 = 20 each; side 93 over 3 = 31 each.
    expect(settleShowdown(h0).winnings).toEqual(M({ p0: 20, p1: 51, p2: 51, p3: 51 }));
    // Make p3 fold-in-effect by marking folded: 4 live -> p1,p2 tie for a side pot of odd size.
    const h = { ...h0, players: h0.players.map((p) => (p.id === "p3" ? { ...p, status: "folded" as const } : p)) };
    const r = settleShowdown(h);
    // main: 80 over p0,p1,p2 -> 26 each +2 odd to p1, p2; side: 31+31+... p3 folded chips fill pots.
    const total = [...r.winnings.values()].reduce((s, n) => s + n, 0);
    expect(total).toBe(chips(h));
    expect(r.awards[0]!.payouts).toEqual(M({ p0: 26, p1: 27, p2: 27 }));
  });

  test("odd chip order wraps around the button", () => {
    const tieBoard = [c(10, "clubs"), c(11, "diamonds"), c(12, "hearts"), c(13, "spades"), c(14, "clubs")];
    const h = rig(allIn([10, 10, 10]), {
      p0: [c(2, "spades"), c(3, "hearts")], p1: [c(4, "spades"), c(5, "hearts")], p2: [c(6, "spades"), c(7, "hearts")],
    }, tieBoard);
    // A folded fourth player left 1 extra chip in the pot: 31 chips, 3 ways = 10 each + 1 odd.
    const folder = { ...h.players[0]!, id: "p3", seat: 3, status: "folded" as const, contributed: 1, stack: 0, bet: 0 };
    const fixed: HandState = { ...h, pot: h.pot + 1, players: [...h.players, folder] };
    const r = settleShowdown(fixed);
    // button is p0 (seat 0): first left of it is p1
    expect(fixed.button).toBe(0);
    expect(r.awards[0]!.payouts.get("p1")).toBe(r.awards[0]!.payouts.get("p2")! + 1);
  });

  test("a fold-out awards the pot with no showdown and reveals nothing", () => {
    let h = mk([100, 100, 100]);
    h = act(h, "p0", { type: "raise", amount: 30 });
    h = act(h, "p1", { type: "fold" });
    h = act(h, "p2", { type: "fold" });
    expect(h.stage).toBe("fold");
    const r = settleShowdown(h);
    expect(r.revealed).toEqual([]);
    expect(r.winnings).toEqual(M({ p0: 45 }));
    expect(r.hand.players.find((p) => p.id === "p0")!.stack).toBe(115);
    expect(r.hand.pot).toBe(0);
  });

  test("rejects a hand that is still being played, or already paid", () => {
    const h = mk([100, 100]);
    expect(() => settleShowdown(h)).toThrow();
    const done = settleShowdown(act(h, "p0", { type: "fold" })).hand;
    expect(() => settleShowdown(done)).toThrow();
  });

  test("an id of '__proto__' is just a key: chips are conserved and paid in full (CLB-23)", () => {
    // Repro: ids '__proto__' and 'x', 100 each, both all-in; '__proto__' wins the showdown.
    // Before the fix, winnings/payouts were plain objects, so the winner's stack became
    // "0[object Object]" and their 200 chips vanished.
    const table = createTable([{ id: "__proto__", stack: 100 }, { id: "x", stack: 100 }]);
    let h = settleHand(startHand(table, shuffle(createDeck(), 7), blinds));
    while (h.stage === "betting") h = act(h, h.players.find((p) => p.seat === h.toAct)!.id, { type: "allIn" });
    expect(h.stage).toBe("showdown");
    const holes = new Map<string, [Card, Card]>([
      ["__proto__", [c(14, "spades"), c(14, "hearts")]],
      ["x", [c(12, "hearts"), c(4, "diamonds")]],
    ]);
    h = { ...h, board, players: h.players.map((p) => ({ ...p, hole: holes.get(p.id)! })) };
    const r = settleShowdown(h);
    const stack = (id: string) => r.hand.players.find((p) => p.id === id)!.stack;
    expect(stack("__proto__")).toBe(200);
    expect(stack("x")).toBe(0);
    expect(r.winnings).toEqual(new Map([["__proto__", 200]]));
    expect(r.awards.flatMap((a) => [...a.payouts.entries()])).toEqual([["__proto__", 200]]);
    expect(chips(r.hand)).toBe(200);
    expect(r.hand.pot).toBe(0);
    expect(r.hand.players.every((p) => Number.isInteger(p.stack) && p.stack >= 0)).toBe(true);
    // The engine's own objects are untouched.
    expect(Object.getPrototypeOf(r.winnings)).toBe(Map.prototype);
    expect(Object.getPrototypeOf(r.hand.players[0]!)).toBe(Object.prototype);
  });

  test("ids that look like Object properties are paid like any other id", () => {
    for (const ids of [["constructor", "toString"], ["hasOwnProperty", "valueOf"], ["__proto__", "constructor"]]) {
      const table = createTable(ids.map((id) => ({ id, stack: 100 })));
      let h = settleHand(startHand(table, shuffle(createDeck(), 3), blinds));
      while (h.stage === "betting") h = act(h, h.players.find((p) => p.seat === h.toAct)!.id, { type: "allIn" });
      const r = settleShowdown(h);
      expect(chips(r.hand)).toBe(200);
      expect(r.hand.pot).toBe(0);
      expect(r.hand.players.every((p) => Number.isInteger(p.stack) && p.stack >= 0)).toBe(true);
      expect([...r.winnings.values()].reduce((s, n) => s + n, 0)).toBe(200);
    }
  });

  test("does not modify its input", () => {
    const h = act(mk([100, 100]), "p0", { type: "fold" });
    const copy = JSON.stringify(h);
    settleShowdown(h);
    expect(JSON.stringify(h)).toBe(copy);
  });
});

describe("chip conservation", () => {
  test("total chips before and after are equal over many seeded hands with random play", () => {
    let seedState = 12345;
    const rnd = () => ((seedState = (seedState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let seed = 1; seed <= 300; seed++) {
      const n = 2 + Math.floor(rnd() * 7);
      const stacks = Array.from({ length: n }, () => 10 + Math.floor(rnd() * 300));
      const before = stacks.reduce((s, x) => s + x, 0);
      let h = mk(stacks, seed);
      let guard = 0;
      while (h.stage === "betting" && guard++ < 500) {
        const p = h.players.find((x) => x.seat === h.toAct)!;
        const r = rnd();
        const toCall = h.currentBet - p.bet;
        let a: Action;
        if (r < 0.15) a = { type: "fold" };
        else if (r < 0.3) a = { type: "allIn" };
        else if (r < 0.5 && p.stack > toCall) a = { type: h.currentBet === 0 ? "bet" : "raise", amount: Math.min(p.bet + p.stack, h.currentBet + h.minRaise + Math.floor(rnd() * 40)) };
        else a = toCall > 0 ? { type: "call" } : { type: "check" };
        const res = applyAction(h, p.id, a);
        h = res.ok ? res.hand : act(h, p.id, toCall > 0 ? { type: "call" } : { type: "check" });
        expect(chips(h)).toBe(before);
      }
      const r = settleShowdown(h);
      expect(chips(r.hand)).toBe(before);
      expect(r.hand.pot).toBe(0);
      expect(r.hand.players.every((p) => Number.isInteger(p.stack) && p.stack >= 0 && p.bet === 0)).toBe(true);
    }
  });
});
