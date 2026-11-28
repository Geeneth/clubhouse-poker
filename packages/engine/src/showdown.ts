import type { Card } from "./cards";
import { compareHands, evaluateHoleAndBoard, type HandValue } from "./evaluator";
import { TableError, type HandSeat, type HandState } from "./table";

/** A pot and the players (ids) who may win it. */
export interface Pot {
  readonly amount: number;
  readonly eligible: readonly string[];
}

export interface PotAward {
  readonly pot: Pot;
  /** Chips paid out per player id from this pot (winners only). Keyed by opaque id. */
  readonly payouts: ReadonlyMap<string, number>;
}

export interface ShowdownReveal {
  readonly id: string;
  readonly hole: readonly [Card, Card];
  readonly value: HandValue;
}

export interface HandResult {
  /** The hand with every pot paid into stacks: pot is 0, stage is "complete". */
  readonly hand: HandState;
  /** Main pot first, then side pots. */
  readonly awards: readonly PotAward[];
  /**
   * Total won per player id (only players who won something). A Map, so any id string
   * (even "__proto__") is just a key and can never touch the engine's own objects.
   */
  readonly winnings: ReadonlyMap<string, number>;
  /** Hands shown at showdown. Empty when everyone else folded (nothing is revealed). */
  readonly revealed: readonly ShowdownReveal[];
}

/**
 * Build the main pot and side pots from each player's total contribution.
 * A pot is made for each distinct all-in/contribution level among players still in the hand;
 * folded players' chips go into the pots up to their contribution but they can win none.
 * Chips above the highest live level (an uncalled bet) are put in the last pot.
 */
export function buildPots(players: readonly Pick<HandSeat, "id" | "contributed" | "status">[]): Pot[] {
  const live = players.filter((p) => p.status !== "folded");
  const levels = [...new Set(live.map((p) => p.contributed))].filter((l) => l > 0).sort((a, b) => a - b);
  const pots: { amount: number; eligible: string[] }[] = [];
  let prev = 0;
  levels.forEach((level, i) => {
    const last = i === levels.length - 1;
    let amount = 0;
    for (const p of players) {
      const upper = last ? p.contributed : Math.min(p.contributed, level);
      amount += Math.max(0, upper - prev);
    }
    const eligible = live.filter((p) => p.contributed >= level).map((p) => p.id);
    const before = pots[pots.length - 1];
    if (before && before.eligible.join() === eligible.join()) before.amount += amount;
    else pots.push({ amount, eligible });
    prev = level;
  });
  return pots;
}

/**
 * Pay out every pot of a finished hand (stage "showdown" or "fold"). Pure: returns a new hand.
 * Each pot goes to the best hand among its eligible players; ties split evenly and odd chips go
 * one at a time to tied winners starting left of the button.
 */
export function settleShowdown(hand: HandState): HandResult {
  if (hand.stage !== "showdown" && hand.stage !== "fold") {
    throw new TableError(`Cannot pay out a hand in stage "${hand.stage}"`);
  }
  const pots = buildPots(hand.players);
  const potTotal = pots.reduce((s, p) => s + p.amount, 0);
  const inHand = hand.pot + hand.players.reduce((s, p) => s + p.bet, 0);
  if (potTotal !== inHand) throw new TableError(`Pots (${potTotal}) do not match the chips in play (${inHand})`);

  const live = hand.players.filter((p) => p.status !== "folded");
  const showdown = hand.stage === "showdown" && live.length > 1;
  const values = new Map<string, HandValue>();
  if (showdown) {
    if (hand.board.length !== 5) throw new TableError("Showdown needs a full board");
    for (const p of live) {
      values.set(p.id, evaluateHoleAndBoard(p.hole, hand.board));
    }
  }
  // Clockwise order starting left of the button.
  const order = [...hand.players]
    .sort((a, b) => (a.seat > hand.button ? a.seat : a.seat + 1000) - (b.seat > hand.button ? b.seat : b.seat + 1000))
    .map((p) => p.id);

  const winnings = new Map<string, number>();
  const awards: PotAward[] = pots.map((pot) => {
    let winners = [...pot.eligible];
    if (showdown) {
      let best: HandValue | undefined;
      winners = [];
      for (const id of pot.eligible) {
        const v = values.get(id)!;
        const c = best ? compareHands(v, best) : 1;
        if (c > 0) { best = v; winners = [id]; } else if (c === 0) winners.push(id);
      }
    }
    winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    const odd = pot.amount - share * winners.length;
    const payouts = new Map<string, number>();
    winners.forEach((id, i) => {
      const paid = share + (i < odd ? 1 : 0);
      payouts.set(id, paid);
      winnings.set(id, (winnings.get(id) ?? 0) + paid);
    });
    return { pot, payouts };
  });

  const players = hand.players.map((p) => ({ ...p, stack: p.stack + (winnings.get(p.id) ?? 0), bet: 0 }));
  const revealed: ShowdownReveal[] = showdown
    ? live.map((p) => ({ id: p.id, hole: p.hole, value: values.get(p.id)! }))
    : [];
  return { hand: { ...hand, players, pot: 0, currentBet: 0, stage: "complete", toAct: null }, awards, winnings, revealed };
}
