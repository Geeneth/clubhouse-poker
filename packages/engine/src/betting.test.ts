import { describe, expect, test } from "vitest";
import {
  applyAction, createDeck, createTable, legalActions, settleHand, shuffle, startHand,
  type Action, type HandState, type Seat,
} from "./index";

const blinds = { small: 5, big: 10 };
const mk = (stacks: number[]): HandState =>
  settleHand(startHand(createTable(stacks.map((stack, i): Seat => ({ id: `p${i}`, stack }))), shuffle(createDeck(), 7), blinds));
const total = (h: HandState) => h.pot + h.players.reduce((s, p) => s + p.stack + p.bet, 0);
const act = (h: HandState, id: string, a: Action): HandState => {
  const r = applyAction(h, id, a);
  if (!r.ok) throw new Error(r.reason);
  return r.hand;
};
const who = (h: HandState) => h.players.find((p) => p.seat === h.toAct)!.id;
const types = (h: HandState) => legalActions(h).map((a) => a.type);
const find = (h: HandState, t: string) => legalActions(h).find((a) => a.type === t);

describe("legal actions", () => {
  test("preflop facing the big blind: fold, call, raise, all-in with min and max", () => {
    const h = mk([100, 100, 100]); // p0 button acts first
    expect(who(h)).toBe("p0");
    expect(types(h)).toEqual(["fold", "call", "raise", "allIn"]);
    expect(find(h, "call")).toEqual({ type: "call", amount: 10 });
    expect(find(h, "raise")).toEqual({ type: "raise", min: 20, max: 100 });
    expect(find(h, "allIn")).toEqual({ type: "allIn", amount: 100 });
  });
  test("big blind option: check or raise", () => {
    let h = mk([100, 100, 100]);
    h = act(h, "p0", { type: "call" });
    h = act(h, "p1", { type: "call" });
    expect(who(h)).toBe("p2");
    expect(types(h)).toEqual(["fold", "check", "raise", "allIn"]);
  });
  test("no bet yet: check or bet (min is the big blind)", () => {
    let h = mk([100, 100, 100]);
    h = act(h, "p0", { type: "call" });
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "check" });
    expect(h.street).toBe("flop");
    expect(types(h)).toEqual(["fold", "check", "bet", "allIn"]);
    expect(find(h, "bet")).toEqual({ type: "bet", min: 10, max: 90 });
  });
  test("short stack: call is capped and no raise is offered", () => {
    const h = mk([100, 100, 100]);
    const r = act(h, "p0", { type: "raise", amount: 50 });
    const p1 = act(r, "p1", { type: "fold" });
    expect(types(p1)).toEqual(["fold", "call", "raise", "allIn"]);
    const small = mk([100, 100, 25]);
    const raised = act(small, "p0", { type: "raise", amount: 50 });
    const f = act(raised, "p1", { type: "fold" });
    expect(find(f, "call")).toEqual({ type: "call", amount: 15 });
    expect(find(f, "raise")).toBeUndefined();
    expect(find(f, "allIn")).toEqual({ type: "allIn", amount: 15 });
  });
  test("nothing is legal when the hand is over", () => {
    const h = act(mk([100, 100]), "p0", { type: "fold" });
    expect(legalActions(h)).toEqual([]);
  });
});

describe("rejections change nothing", () => {
  const h = mk([100, 100, 100]);
  const expectReject = (hand: HandState, id: string, a: Action, re: RegExp) => {
    const snapshot = JSON.stringify(hand);
    const r = applyAction(hand, id, a);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(re);
    expect(JSON.stringify(hand)).toBe(snapshot);
  };
  test("out of turn", () => expectReject(h, "p1", { type: "call" }, /not your turn/));
  test("unknown player", () => expectReject(h, "zz", { type: "call" }, /Unknown/));
  test("check facing a bet", () => expectReject(h, "p0", { type: "check" }, /cannot check/));
  test("below the minimum raise", () => expectReject(h, "p0", { type: "raise", amount: 15 }, /minimum raise is to 20/));
  test("more than the stack", () => expectReject(h, "p0", { type: "raise", amount: 101 }, /only have 100/));
  test("unknown action type", () => {
    expectReject(h, "p0", { type: "bogus" } as unknown as Action, /Unknown action/);
    expectReject(h, "p0", {} as unknown as Action, /Unknown action/);
    expectReject(h, "p0", null as unknown as Action, /Unknown action/);
  });
  test("bet or raise with a missing or non-numeric amount", () => {
    expectReject(h, "p0", { type: "raise" } as unknown as Action, /whole number/);
    expectReject(h, "p0", { type: "raise", amount: "50" } as unknown as Action, /whole number/);
    expectReject(h, "p0", { type: "bet" } as unknown as Action, /whole number|already a bet/);
  });
  test("fractional or negative amounts", () => {
    expectReject(h, "p0", { type: "raise", amount: 20.5 }, /whole number/);
    expectReject(h, "p0", { type: "raise", amount: -1 }, /whole number/);
  });
  test("bet when there is already a bet; raise when there is none", () => {
    expectReject(h, "p0", { type: "bet", amount: 30 }, /raise instead/);
    let f = act(h, "p0", { type: "call" });
    f = act(f, "p1", { type: "call" });
    f = act(f, "p2", { type: "check" });
    expectReject(f, "p1", { type: "raise", amount: 30 }, /bet instead/);
    expectReject(f, "p1", { type: "call" }, /nothing to call/);
    expectReject(f, "p1", { type: "bet", amount: 5 }, /minimum bet is to 10/);
  });
  test("acting after folding, and acting while all-in", () => {
    const f = act(h, "p0", { type: "fold" });
    expectReject(f, "p0", { type: "check" }, /folded/);
    const a = act(mk([100, 100, 100]), "p0", { type: "allIn" });
    const c = act(a, "p1", { type: "call" });
    expectReject(c, "p0", { type: "fold" }, /all-in/);
  });
  test("acting after the hand is over", () => {
    const f = act(mk([100, 100]), "p0", { type: "fold" });
    expectReject(f, "p1", { type: "check" }, /over/);
  });
});

describe("minimum raise", () => {
  test("a raise must be at least the previous raise size", () => {
    let h = mk([200, 200, 200]);
    h = act(h, "p0", { type: "raise", amount: 40 }); // raise of 30
    expect(find(h, "raise")).toMatchObject({ min: 70 });
    const r = applyAction(h, "p1", { type: "raise", amount: 60 });
    expect(r.ok).toBe(false);
    h = act(h, "p1", { type: "raise", amount: 70 });
    expect(h.minRaise).toBe(30);
    expect(find(h, "raise")).toMatchObject({ min: 100 });
  });
  test("a short all-in does not reopen betting for players who already acted", () => {
    let h = mk([200, 200, 35]);
    h = act(h, "p0", { type: "raise", amount: 30 }); // raise of 20
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "allIn" }); // to 35: only +5, a short raise
    expect(h.currentBet).toBe(35);
    expect(h.minRaise).toBe(20);
    expect(who(h)).toBe("p0");
    expect(types(h)).toEqual(["fold", "call"]);
    expect(applyAction(h, "p0", { type: "raise", amount: 100 }).ok).toBe(false);
    h = act(h, "p0", { type: "call" });
    expect(types(h)).toEqual(["fold", "call"]);
  });
  test("after a short all-in, a player not reopened cannot raise or shove (full-stack too)", () => {
    let h = mk([1000, 1000, 130]);
    h = act(h, "p0", { type: "raise", amount: 100 });
    h = act(h, "p1", { type: "fold" });
    h = act(h, "p2", { type: "allIn" }); // to 130, +30 < 90: short
    expect(who(h)).toBe("p0");
    expect(legalActions(h)).toEqual([{ type: "fold" }, { type: "call", amount: 30 }]);
    for (const a of [{ type: "raise", amount: 1000 }, { type: "raise", amount: 500 }, { type: "allIn" }] as Action[]) {
      const r = applyAction(h, "p0", a);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/not reopened/);
    }
    expect(applyAction(h, "p0", { type: "call" }).ok).toBe(true);
  });
  test("a short all-in call is still allowed when not reopened", () => {
    let h = mk([1000, 1000, 130]);
    h = act(h, "p0", { type: "raise", amount: 100 });
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "allIn" });
    expect(who(h)).toBe("p0");
    expect(types(h)).toEqual(["fold", "call"]);
  });
  test("a short all-in still lets players who have not acted raise", () => {
    let h = mk([200, 200, 200, 14]);
    // seats: p0 button, p1 SB, p2 BB, p3 first to act with 14 chips (all-in short)
    expect(who(h)).toBe("p3");
    h = act(h, "p3", { type: "allIn" }); // to 14, +4 short
    expect(h.currentBet).toBe(14);
    expect(types(h)).toContain("raise");
    expect(find(h, "raise")).toMatchObject({ min: 24 });
  });
  test("a full all-in raise reopens betting", () => {
    let h = mk([200, 200, 60]);
    h = act(h, "p0", { type: "raise", amount: 30 });
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "allIn" }); // to 60, +30 >= 20: full
    expect(h.minRaise).toBe(30);
    expect(who(h)).toBe("p0");
    expect(types(h)).toContain("raise");
  });
});

describe("turn order and streets", () => {
  test("preflop with 4 players starts left of the big blind; later streets left of the button", () => {
    let h = mk([100, 100, 100, 100]);
    expect(who(h)).toBe("p3");
    h = act(h, "p3", { type: "call" });
    h = act(h, "p0", { type: "call" });
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "check" });
    expect(h.street).toBe("flop");
    expect(h.board).toHaveLength(3);
    expect(who(h)).toBe("p1");
  });
  test("heads-up: dealer acts first preflop and second on later streets", () => {
    let h = mk([100, 100]);
    expect(who(h)).toBe("p0");
    expect(h.smallBlindSeat).toBe(0);
    h = act(h, "p0", { type: "call" });
    h = act(h, "p1", { type: "check" });
    expect(h.street).toBe("flop");
    expect(who(h)).toBe("p1");
    h = act(h, "p1", { type: "check" });
    expect(who(h)).toBe("p0");
  });
  test("folded and all-in players are skipped", () => {
    let h = mk([100, 100, 100, 100]);
    h = act(h, "p3", { type: "fold" });
    h = act(h, "p0", { type: "allIn" });
    h = act(h, "p1", { type: "fold" });
    expect(who(h)).toBe("p2");
    h = act(h, "p2", { type: "call" });
    expect(h.street).toBe("river"); // only all-in p0 and active p2: board runs out
    expect(h.stage).toBe("showdown");
  });
  test("streets advance in order through to showdown", () => {
    let h = mk([100, 100]);
    h = act(h, "p0", { type: "call" });
    h = act(h, "p1", { type: "check" });
    const seen: string[] = [h.street];
    for (let i = 0; i < 3; i++) {
      h = act(h, who(h), { type: "check" });
      h = act(h, who(h), { type: "check" });
      seen.push(h.street);
    }
    expect(seen).toEqual(["flop", "turn", "river", "river"]);
    expect(h.stage).toBe("showdown");
    expect(h.board).toHaveLength(5);
    expect(h.toAct).toBeNull();
  });
});

describe("end of round and hand", () => {
  test("round continues until the raise is matched", () => {
    let h = mk([100, 100, 100]);
    h = act(h, "p0", { type: "raise", amount: 30 });
    h = act(h, "p1", { type: "call" });
    expect(h.street).toBe("preflop");
    h = act(h, "p2", { type: "raise", amount: 60 });
    h = act(h, "p0", { type: "call" });
    expect(h.street).toBe("preflop");
    h = act(h, "p1", { type: "call" });
    expect(h.street).toBe("flop");
    expect(h.pot).toBe(180);
    expect(h.players.every((p) => p.bet === 0)).toBe(true);
  });
  test("the hand ends early when all but one fold", () => {
    let h = mk([100, 100, 100]);
    h = act(h, "p0", { type: "fold" });
    h = act(h, "p1", { type: "fold" });
    expect(h.stage).toBe("fold");
    expect(h.toAct).toBeNull();
    expect(h.board).toHaveLength(0);
    expect(h.pot).toBe(15);
    expect(total(h)).toBe(300);
  });
  test("everyone all-in runs the board out", () => {
    let h = mk([100, 100]);
    h = act(h, "p0", { type: "allIn" });
    h = act(h, "p1", { type: "call" });
    expect(h.stage).toBe("showdown");
    expect(h.board).toHaveLength(5);
    expect(h.pot).toBe(200);
  });
  test("blinds that put everyone all-in settle immediately", () => {
    const h = mk([3, 7]);
    expect(h.stage).toBe("showdown");
    expect(h.board).toHaveLength(5);
  });
  test("chips are conserved and contributions tracked", () => {
    let h = mk([100, 150, 80]);
    expect(total(h)).toBe(330);
    h = act(h, "p0", { type: "raise", amount: 30 });
    h = act(h, "p1", { type: "call" });
    h = act(h, "p2", { type: "call" });
    expect(total(h)).toBe(330);
    h = act(h, "p1", { type: "bet", amount: 50 });
    h = act(h, "p2", { type: "allIn" });
    h = act(h, "p0", { type: "call" });
    expect(total(h)).toBe(330);
    expect(h.players.map((p) => p.contributed)).toEqual([80, 80, 80]);
  });
});
