/**
 * CLB-18: whole hands played from the blinds to the payout through the engine's public API,
 * with fixed seeds, checking the exact cards, pots, revealed hands and stacks.
 */
import { describe, expect, test } from "vitest";
import {
  applyAction, cardId, createDeck, createTable, legalActions, nextHand, settleHand, settleShowdown, shuffle, startHand,
  type Action, type HandResult, type HandState, type Seat,
} from "./index";

const blinds = { small: 5, big: 10 };

/**
 * Play a hand: each step names who must be the player to act and what they do.
 * Returns the hand before payout, the result, and the board after each street.
 */
function playHand(seats: readonly (Seat | null)[], seed: number, script: readonly [string, Action][]) {
  const table = createTable(seats);
  const start = startHand(table, shuffle(createDeck(), seed), blinds);
  let h: HandState = settleHand(start);
  const streets: string[] = [];
  for (const [id, action] of script) {
    expect(h.stage).toBe("betting");
    const toAct = h.players.find((p) => p.seat === h.toAct)!;
    expect(`${h.street}: ${toAct.id}`).toBe(`${h.street}: ${id}`);
    const r = applyAction(h, id, action);
    if (!r.ok) throw new Error(`${id} ${JSON.stringify(action)} rejected: ${r.reason}`);
    if (r.hand.street !== h.street) streets.push(`${r.hand.street} ${r.hand.board.map(cardId).join(" ")}`);
    h = r.hand;
  }
  expect(h.stage).not.toBe("betting");
  const result = settleShowdown(h);
  return { table, start, end: h, result, streets, next: nextHand(table, result.hand) };
}

const holes = (h: HandState) => Object.fromEntries(h.players.map((p) => [p.id, p.hole.map(cardId).join(" ")]));
const stacks = (r: HandResult) => Object.fromEntries(r.hand.players.map((p) => [p.id, p.stack]));
const shown = (r: HandResult) => r.revealed.map((x) => `${x.id}: ${x.value.category}`);
const pots = (r: HandResult) => r.awards.map((a) => ({ amount: a.pot.amount, eligible: [...a.pot.eligible] }));
const call: Action = { type: "call" };
const check: Action = { type: "check" };
const fold: Action = { type: "fold" };
const allIn: Action = { type: "allIn" };

describe("full hands from the blinds to the payout", () => {
  test("heads-up, seed 2: bets on every street, a river raise, and the straight wins", () => {
    const { start, end, result, streets, next } = playHand(
      [{ id: "ann", stack: 1000 }, { id: "bob", stack: 1000 }],
      2,
      [
        ["ann", call], ["bob", check], // preflop: the button (small blind) acts first heads-up
        ["bob", { type: "bet", amount: 20 }], ["ann", call], // flop: the big blind acts first
        ["bob", check], ["ann", check], // turn
        ["bob", { type: "bet", amount: 50 }], ["ann", { type: "raise", amount: 150 }], ["bob", call], // river
      ],
    );
    expect([start.button, start.smallBlindSeat, start.bigBlindSeat]).toEqual([0, 0, 1]);
    expect(start.players.map((p) => [p.id, p.bet, p.stack])).toEqual([["ann", 5, 995], ["bob", 10, 990]]);
    expect(holes(start)).toEqual({ ann: "4c 7h", bob: "8c 3s" });
    expect(streets).toEqual(["flop 9d Ts Js", "turn 9d Ts Js 7d", "river 9d Ts Js 7d 6d"]);
    expect(end.stage).toBe("showdown");
    expect(end.pot).toBe(360);
    expect(pots(result)).toEqual([{ amount: 360, eligible: ["ann", "bob"] }]);
    expect(shown(result)).toEqual(["ann: pair", "bob: straight"]);
    expect(stacks(result)).toEqual({ ann: 820, bob: 1180 });
    expect(next.table.seats.map((s) => s?.stack)).toEqual([820, 1180]);
    expect(next.gameOver).toBeNull();
  });

  test("four-way all-in, seed 6: main pot and two side pots each go to a different player", () => {
    const { start, result, streets, next } = playHand(
      [{ id: "ann", stack: 50 }, { id: "bob", stack: 120 }, { id: "cat", stack: 300 }, { id: "dan", stack: 300 }],
      6,
      [["dan", allIn], ["ann", allIn], ["bob", allIn], ["cat", call]],
    );
    expect([start.button, start.smallBlindSeat, start.bigBlindSeat]).toEqual([0, 1, 2]);
    expect(holes(start)).toEqual({ ann: "Ac Ah", bob: "7s 3c", cat: "Qc 8d", dan: "Kh Qs" });
    // Nobody can act once everyone is all-in, so the board runs out in one go.
    expect(streets).toEqual(["river Ad 9c 6s 3s 9d"]);
    expect(pots(result)).toEqual([
      { amount: 200, eligible: ["ann", "bob", "cat", "dan"] },
      { amount: 210, eligible: ["bob", "cat", "dan"] },
      { amount: 360, eligible: ["cat", "dan"] },
    ]);
    expect(shown(result)).toEqual(["ann: full-house", "bob: two-pair", "cat: pair", "dan: pair"]);
    // ann's aces full win the main pot, bob's two pair the first side pot, dan's king kicker the last.
    expect(stacks(result)).toEqual({ ann: 200, bob: 210, cat: 0, dan: 360 });
    expect(next.busted).toEqual(["cat"]);
    expect(next.knockedOut).toEqual(["cat"]);
  });

  test("four-way all-in, seed 5: a tied main pot is split while the side pots go to single winners", () => {
    const { result } = playHand(
      [{ id: "ann", stack: 50 }, { id: "bob", stack: 120 }, { id: "cat", stack: 300 }, { id: "dan", stack: 300 }],
      5,
      [["dan", allIn], ["ann", allIn], ["bob", allIn], ["cat", call]],
    );
    expect(shown(result)).toEqual(["ann: two-pair", "bob: two-pair", "cat: pair", "dan: pair"]);
    expect(stacks(result)).toEqual({ ann: 100, bob: 310, cat: 0, dan: 360 });
  });

  test("three-handed, seed 25: a split pot gives the odd chip to the first winner left of the button", () => {
    const { start, end, result, streets } = playHand(
      [{ id: "ann", stack: 100 }, { id: "bob", stack: 100 }, { id: "cat", stack: 100 }],
      25,
      [
        ["ann", call], ["bob", fold], ["cat", check],
        ["cat", check], ["ann", check], ["cat", check], ["ann", check], ["cat", check], ["ann", check],
      ],
    );
    expect([start.button, start.smallBlindSeat, start.bigBlindSeat]).toEqual([0, 1, 2]);
    expect(holes(start)).toEqual({ ann: "Jd 9h", bob: "7s Kc", cat: "2c Jc" });
    expect(streets).toEqual(["flop Js 5h Jh", "turn Js 5h Jh 5d", "river Js 5h Jh 5d Ah"]);
    expect(end.pot).toBe(25);
    // Both play jacks full of fives. bob folded, so his cards are not shown.
    expect(shown(result)).toEqual(["ann: full-house", "cat: full-house"]);
    expect(pots(result)).toEqual([{ amount: 25, eligible: ["ann", "cat"] }]);
    // 25 splits 12/12; the odd chip goes to cat (seat 2), the first winner left of the button (seat 0).
    expect(stacks(result)).toEqual({ ann: 102, bob: 95, cat: 103 });
  });

  test("everyone folds, seed 3: the uncalled bet comes back and no cards are shown", () => {
    const { end, result, next } = playHand(
      [{ id: "ann", stack: 1000 }, { id: "bob", stack: 1000 }],
      3,
      [["ann", call], ["bob", check], ["bob", { type: "bet", amount: 200 }], ["ann", fold]],
    );
    expect(end.stage).toBe("fold");
    expect(end.board.map(cardId)).toEqual(["Ac", "4c", "7c"]);
    expect(result.revealed).toEqual([]);
    // bob's 200 is returned in full; bob wins only ann's 10.
    expect(stacks(result)).toEqual({ ann: 990, bob: 1010 });
    expect(next.table.seats.map((s) => s?.stack)).toEqual([990, 1010]);
  });

  test("the same seed and actions always give the same hand", () => {
    const script: [string, Action][] = [["dan", allIn], ["ann", allIn], ["bob", allIn], ["cat", call]];
    const seats = [{ id: "ann", stack: 50 }, { id: "bob", stack: 120 }, { id: "cat", stack: 300 }, { id: "dan", stack: 300 }];
    expect(playHand(seats, 6, script).result).toEqual(playHand(seats, 6, script).result);
  });

  test("legal actions along the way match the rules (heads-up, seed 2)", () => {
    const t = createTable([{ id: "ann", stack: 1000 }, { id: "bob", stack: 1000 }]);
    let h = settleHand(startHand(t, shuffle(createDeck(), 2), blinds));
    expect(legalActions(h)).toEqual([
      { type: "fold" }, { type: "call", amount: 5 }, { type: "raise", min: 20, max: 1000 }, { type: "allIn", amount: 995 },
    ]);
    h = (applyAction(h, "ann", call) as { ok: true; hand: HandState }).hand;
    // The big blind gets the option to raise even though everyone just called.
    expect(legalActions(h)).toEqual([
      { type: "fold" }, { type: "check" }, { type: "raise", min: 20, max: 1000 }, { type: "allIn", amount: 990 },
    ]);
  });
});
