import { describe, expect, test } from "vitest";
import { compareHands, evaluateHand, evaluateHoleAndBoard, type Card, type Rank, type Suit } from "./index";

const R: Record<string, Rank> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
const S: Record<string, Suit> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
const cards = (s: string): Card[] => s.split(" ").map((x) => ({ rank: R[x[0]!]!, suit: S[x[1]!]! }));
const ev = (s: string) => evaluateHand(cards(s));
const cmp = (a: string, b: string) => Math.sign(compareHands(ev(a), ev(b)));

describe("categories", () => {
  test.each([
    ["As Kd 9h 7c 3d", "high-card"],
    ["As Ad 9h 7c 3d", "pair"],
    ["As Ad 9h 9c 3d", "two-pair"],
    ["As Ad Ah 9c 3d", "three-of-a-kind"],
    ["5s 6d 7h 8c 9d", "straight"],
    ["As Ks 9s 7s 3s", "flush"],
    ["As Ad Ah 9c 9d", "full-house"],
    ["As Ad Ah Ac 3d", "four-of-a-kind"],
    ["5s 6s 7s 8s 9s", "straight-flush"],
    ["As Ks Qs Js Ts", "straight-flush"],
  ])("%s is %s", (hand, category) => {
    expect(ev(hand).category).toBe(category);
  });

  test("royal flush beats a lower straight flush", () => {
    expect(cmp("As Ks Qs Js Ts", "9s Ks Qs Js Ts")).toBe(1);
  });
});

describe("straights", () => {
  test("wheel is a straight", () => {
    const v = ev("As 2d 3h 4c 5d");
    expect(v.category).toBe("straight");
    expect(v.tiebreak).toEqual([5]);
  });
  test("6-high straight beats the wheel", () => {
    expect(cmp("2s 3d 4h 5c 6d", "As 2d 3h 4c 5d")).toBe(1);
  });
  test("ace-high straight beats king-high", () => {
    expect(cmp("Ts Jd Qh Kc Ad", "9s Td Jh Qc Kd")).toBe(1);
  });
  test("no wraparound straight (Q K A 2 3)", () => {
    expect(ev("Qs Kd Ah 2c 3d").category).toBe("high-card");
  });
  test("steel wheel is a straight flush", () => {
    expect(ev("As 2s 3s 4s 5s").category).toBe("straight-flush");
  });
  test("wheel in 7 cards loses to a higher pair-free straight", () => {
    expect(ev("As 2d 3h 4c 5d Kh Kc").category).toBe("straight");
  });
});

describe("best of 5, 6 and 7 cards", () => {
  test("5 cards", () => expect(ev("As Ad 9h 9c 3d").category).toBe("two-pair"));
  test("6 cards picks the best five", () => {
    const v = ev("As Ad Ah 9c 9d 2s");
    expect(v.category).toBe("full-house");
    expect(v.cards).toHaveLength(5);
  });
  test("7 cards finds a hidden flush", () => {
    expect(ev("As Ks 9s 7s 3s Ad Ah").category).toBe("flush");
  });
  test("7 cards prefers full house over trips with two pairs", () => {
    expect(ev("Ks Kd Kh 9c 9d 9s 2c").tiebreak).toEqual([13, 9]);
  });
  test("three pair uses the best two and best kicker", () => {
    expect(ev("As Ad Kh Kc 3d 3s Qh").tiebreak).toEqual([14, 13, 12]);
  });
  test("hole + board helper", () => {
    const v = evaluateHoleAndBoard(cards("As Ad"), cards("Ah Ac 3d 7s 9h"));
    expect(v.category).toBe("four-of-a-kind");
  });
  test("rejects too few, too many and duplicate cards", () => {
    expect(() => evaluateHand(cards("As Ad 9h 9c"))).toThrow();
    expect(() => evaluateHand(cards("As Ad 9h 9c 3d 4d 5d 6d"))).toThrow();
    expect(() => evaluateHand(cards("As As 9h 9c 3d"))).toThrow();
  });
});

describe("kickers and ties", () => {
  test("two pair with a better kicker wins", () => {
    expect(cmp("As Ad Kh Kc Qd", "Ah Ac Ks Kd Jd")).toBe(1);
  });
  test("two pair: higher second pair beats better kicker", () => {
    expect(cmp("As Ad Qh Qc 2d", "Ah Ac Js Jd Kd")).toBe(1);
  });
  test("pair kickers are compared in order", () => {
    expect(cmp("As Ad Kh 7c 3d", "Ah Ac Ks 6d 5d")).toBe(1);
    expect(cmp("As Ad Kh 7c 3d", "Ah Ac Ks 7d 2d")).toBe(1);
  });
  test("flush vs flush compares card by card", () => {
    expect(cmp("As Js 9s 6s 3s", "Ah Jh 9h 5h 4h")).toBe(1);
    expect(cmp("Ks Qs 9s 6s 3s", "Kh Qh 9h 6h 2h")).toBe(1);
  });
  test("flush beats straight; full house beats flush", () => {
    expect(cmp("As Js 9s 6s 3s", "5d 6h 7c 8d 9h")).toBe(1);
    expect(cmp("As Ad Ah 9c 9d", "As Js 9s 6s 3s")).toBe(1);
  });
  test("full house compares trips before pair", () => {
    expect(cmp("3s 3d 3h 2c 2d", "2s 2h 2c As Ad")).toBe(1);
  });
  test("quads compare rank then kicker", () => {
    expect(cmp("3s 3d 3h 3c 2d", "2s 2h 2c 2d Ad")).toBe(1);
    expect(cmp("3s 3d 3h 3c Kd", "3s 3d 3h 3c Qd")).toBe(1);
  });
  test("identical ranks in different suits tie", () => {
    expect(compareHands(ev("As Kd 9h 7c 3d"), ev("Ah Ks 9d 7h 3c"))).toBe(0);
  });
  test("board plays for everyone: royal on board ties", () => {
    const board = cards("As Ks Qs Js Ts");
    const a = evaluateHoleAndBoard(cards("2c 3d"), board);
    const b = evaluateHoleAndBoard(cards("4h 4d"), board);
    expect(compareHands(a, b)).toBe(0);
  });
  test("board two pair plays for weak hands; a hole ace makes a full house", () => {
    const board = cards("Ah Ad Kc Kd Qs");
    expect(compareHands(evaluateHoleAndBoard(cards("2c 3d"), board), evaluateHoleAndBoard(cards("Jc 3h"), board))).toBe(0);
    expect(compareHands(evaluateHoleAndBoard(cards("Ac 3d"), board), evaluateHoleAndBoard(cards("2c 2h"), board))).toBeGreaterThan(0);
  });
  test("board straight, one player has a higher straight", () => {
    const board = cards("5s 6d 7h 8c 2d");
    expect(compareHands(evaluateHoleAndBoard(cards("9c 3d"), board), evaluateHoleAndBoard(cards("Ac Kd"), board))).toBeGreaterThan(0);
  });
});
