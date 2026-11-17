import { dealNextStreet, type HandSeat, type HandState } from "./table";

/** A legal action. Bet/raise amounts are the player's total bet on this street ("raise to"). */
export type LegalAction =
  | { readonly type: "fold" }
  | { readonly type: "check" }
  | { readonly type: "call"; readonly amount: number }
  | { readonly type: "bet"; readonly min: number; readonly max: number }
  | { readonly type: "raise"; readonly min: number; readonly max: number }
  | { readonly type: "allIn"; readonly amount: number };

export type Action =
  | { readonly type: "fold" | "check" | "call" | "allIn" }
  | { readonly type: "bet" | "raise"; readonly amount: number };

export type ActionResult =
  | { readonly ok: true; readonly hand: HandState }
  | { readonly ok: false; readonly reason: string };

const reject = (reason: string): ActionResult => ({ ok: false, reason });

const nextIn = (hand: HandState, from: number, pred: (p: HandSeat) => boolean): number | null => {
  const n = hand.players.length;
  const i = hand.players.findIndex((p) => p.seat === from);
  for (let step = 1; step <= n; step++) {
    const p = hand.players[(i + step) % n]!;
    if (pred(p)) return p.seat;
  }
  return null;
};

const needsToAct = (hand: HandState, p: HandSeat): boolean =>
  p.status === "active" && (p.raiseOpen || p.bet < hand.currentBet);

/** The betting round is over: nobody left who must act. A lone active player with nobody to bet against is done too. */
function roundComplete(hand: HandState): boolean {
  const active = hand.players.filter((p) => p.status === "active");
  if (active.length === 0) return true;
  if (active.length === 1 && active[0]!.bet >= hand.currentBet) return true;
  return !active.some((p) => needsToAct(hand, p));
}

/**
 * Close finished betting rounds: sweep bets into the pot and deal the next street, repeating
 * while nobody can act (everyone all-in runs the board out). Ends in "showdown" after the river.
 * Call this on a hand straight from startHand (it does nothing if play is already open).
 */
export function settleHand(hand: HandState): HandState {
  let h = hand;
  while (h.stage === "betting" && roundComplete(h)) {
    const swept: HandState = {
      ...h,
      pot: h.pot + h.players.reduce((s, p) => s + p.bet, 0),
      players: h.players.map((p) => ({ ...p, bet: 0 })),
      currentBet: 0,
    };
    if (h.street === "river") {
      h = { ...swept, stage: "showdown", toAct: null };
      break;
    }
    const dealt = dealNextStreet(swept);
    const players = dealt.players.map((p) => ({ ...p, raiseOpen: true }));
    h = { ...dealt, players, minRaise: h.blinds.big, toAct: null };
    h = { ...h, toAct: nextIn(h, h.button, (p) => p.status === "active") };
  }
  if (h.stage === "betting" && h.toAct === null) {
    h = { ...h, toAct: nextIn(h, h.button, (p) => needsToAct(h, p)) };
  }
  return h;
}

/** Why this player cannot act now, or null if it is their turn. */
function whyNotTurn(hand: HandState, id: string): string | null {
  const p = hand.players.find((x) => x.id === id);
  if (!p) return `Unknown player ${id}`;
  if (hand.stage !== "betting") return "The betting is over for this hand";
  if (p.status === "folded") return "You have folded";
  if (p.status === "allIn") return "You are all-in and cannot act";
  if (hand.toAct !== p.seat) return "It is not your turn";
  return null;
}

/** Legal actions for the player to act. Empty when nobody can act. */
export function legalActions(hand: HandState): LegalAction[] {
  if (hand.stage !== "betting" || hand.toAct === null) return [];
  const p = hand.players.find((x) => x.seat === hand.toAct)!;
  const toCall = hand.currentBet - p.bet;
  const max = p.bet + p.stack;
  const out: LegalAction[] = [{ type: "fold" }];
  if (toCall <= 0) out.push({ type: "check" });
  else out.push({ type: "call", amount: Math.min(toCall, p.stack) });
  const min = hand.currentBet + hand.minRaise;
  if (p.raiseOpen && max >= min) {
    out.push(hand.currentBet === 0 ? { type: "bet", min, max } : { type: "raise", min, max });
  }
  if (p.stack > 0) out.push({ type: "allIn", amount: p.stack });
  return out;
}

/**
 * Apply an action by player `id`. Returns the new hand, or a rejection with a reason
 * (the input hand is never modified).
 */
export function applyAction(hand: HandState, id: string, action: Action): ActionResult {
  const bad = whyNotTurn(hand, id);
  if (bad) return reject(bad);
  const p = hand.players.find((x) => x.id === id)!;
  const toCall = hand.currentBet - p.bet;
  const max = p.bet + p.stack;
  let to: number; // new total bet on this street
  switch (action.type) {
    case "fold": {
      const players = hand.players.map((x) => (x === p ? { ...x, status: "folded" as const } : x));
      const left = players.filter((x) => x.status !== "folded");
      if (left.length === 1) {
        const pot = hand.pot + players.reduce((s, x) => s + x.bet, 0);
        return { ok: true, hand: { ...hand, players: players.map((x) => ({ ...x, bet: 0 })), pot, currentBet: 0, stage: "fold", toAct: null } };
      }
      return { ok: true, hand: settleHand({ ...hand, players, toAct: nextIn({ ...hand, players }, p.seat, (x) => needsToAct({ ...hand, players }, x)) }) };
    }
    case "check":
      if (toCall > 0) return reject(`You cannot check facing a bet of ${hand.currentBet}; call, raise or fold`);
      to = p.bet;
      break;
    case "call":
      if (toCall <= 0) return reject("There is nothing to call; check instead");
      to = p.bet + Math.min(toCall, p.stack);
      break;
    case "allIn":
      to = max;
      break;
    case "bet":
    case "raise": {
      const a = action.amount;
      if (!Number.isInteger(a) || a < 0) return reject("The amount must be a whole number of chips");
      if (action.type === "bet" && hand.currentBet > 0) return reject(`There is already a bet of ${hand.currentBet}; raise instead`);
      if (action.type === "raise" && hand.currentBet === 0) return reject("There is no bet to raise; bet instead");
      if (a > max) return reject(`You only have ${p.stack} chips behind (most you can bet is ${max})`);
      if (!p.raiseOpen && a < max) return reject("The betting was not reopened to you; you can only call, fold or go all-in");
      if (a < hand.currentBet + hand.minRaise && a < max) {
        return reject(`The minimum ${action.type} is to ${hand.currentBet + hand.minRaise}`);
      }
      to = a;
      break;
    }
  }
  const added = to - p.bet;
  const size = to - hand.currentBet;
  const raised = size > 0;
  const fullRaise = raised && size >= hand.minRaise;
  if (raised && !p.raiseOpen && !fullRaise && to !== max) return reject("The betting was not reopened to you");
  const players = hand.players.map((x) => {
    if (x === p) {
      const stack = x.stack - added;
      return { ...x, stack, bet: to, contributed: x.contributed + added, status: stack === 0 ? ("allIn" as const) : x.status, raiseOpen: false };
    }
    return fullRaise && x.status === "active" ? { ...x, raiseOpen: true } : x;
  });
  const next: HandState = {
    ...hand,
    players,
    currentBet: Math.max(hand.currentBet, to),
    minRaise: fullRaise ? size : hand.minRaise,
  };
  return { ok: true, hand: settleHand({ ...next, toAct: nextIn(next, p.seat, (x) => needsToAct(next, x)) }) };
}
