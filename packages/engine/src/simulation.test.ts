/**
 * CLB-18: random whole-game simulation, checking the invariants in docs/invariants.md after every action.
 *
 * Every game is driven only through the engine's public API (createTable, startHand, settleHand,
 * legalActions, applyAction, settleShowdown, nextHand), and every action is picked from legalActions.
 * Everything random comes from one seed, so a failing game can be replayed exactly:
 *
 *   CLB_SIM_SEED=<seed> pnpm test simulation
 *
 * runs only that game (and the failure message also lists every action taken, by hand).
 *
 * Which invariants the engine can show, and how each is checked:
 *   1  chips conserved within a hand        checkHand: stacks + bets + pot == the total at hand start
 *   2  total only grows with a rebuy          checkTable: the table total never changes (no rebuys exist yet)
 *   3  no negative or fractional chips        checkHand / checkTable: every stack, bet, contribution and pot
 *   4  never bet more than the stack          checkHand: contributed == stack at start - stack; all-in iff 0 behind
 *   5  pots paid in full                      checkResult: pot and bets are 0, every chip went to a winner
 *   6  side pots correct                      checkResult: payouts match an independent pot oracle; winners eligible
 *   7  ties split, odd chips left of button   checkResult: same oracle, splitting each pot separately
 *   8  no duplicate cards                     checkCards: deck + board + holes are the 52 distinct real cards
 *   9  fresh deck, dealt in order             checkCards: every card is exactly where the shuffled deck puts it
 *  10  best hand wins                         checkResult: the oracle ranks hands with evaluateHoleAndBoard
 *  11  only the player to act can act         probeIllegal: everyone else (and unknown ids) is rejected
 *  12  only legal actions accepted            probeIllegal: check facing a bet, under-min and over-stack sizes,
 *                                             and acting after the betting is over are rejected; the player
 *                                             to act is never folded or all-in
 *  13  rounds in order, end only when settled checkHand: streets only move forward, the board matches the
 *                                             street, and a street ends only once every active player has
 *                                             acted and matched the highest contribution
 *  14  button moves, blinds from right seats  checkStart: button, small and big blind seats and posted amounts
 *  15  blinds never go down                   the harness raises blinds on a schedule; checkStart asserts the
 *                                             hand's blinds never drop (the schedule itself is decided later)
 *  16  2 to 8 players                         games use 2 to 8 players; a separate test checks createTable
 *  19  night ends when one player has it all  checkTable: gameOver iff exactly one seat has chips, holding all
 *  22  folded cards never revealed            checkResult: only live players at a real showdown are revealed
 *  29  engine is pure                         every state is deep-frozen (any mutation throws), and replaying
 *                                             a seed or its recorded actions gives an identical game
 *
 * Not checkable in the engine (they belong to later tickets and other packages): 17 turn timer and
 * 26-28 connections and host controls (server), 18 rebuys (not built yet), 20-21, 23-25 secrecy
 * (what the server sends), 30 rules only in the engine and 31 fake coins (architecture, not state).
 */
import { describe, expect, test } from "vitest";
import {
  applyAction, cardId, compareHands, createDeck, createTable, evaluateHoleAndBoard, isValidCard, legalActions,
  nextHand, settleHand, settleShowdown, shuffle, startHand,
  type Action, type Blinds, type Card, type Deck, type HandResult, type HandState, type HandValue, type LegalAction,
  type Seat, type Table,
} from "./index";

// ---------------------------------------------------------------------------------------------
// Seeded randomness (the engine's own PRNG is private; this one only drives the test players).

/** mulberry32. Seeds are 0..4294967295. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number): number => lo + Math.floor(r() * (hi - lo + 1));

// ---------------------------------------------------------------------------------------------
// Game set-up and the action log.

interface GameConfig {
  readonly seats: readonly (Seat | null)[];
  readonly blinds: Blinds;
  /** Blinds double every this many hands (invariant 15: they never go down). */
  readonly blindsEvery: number;
  readonly maxHands: number;
}

/** One logged action: which hand, who, and what they did. */
interface LoggedAction {
  readonly hand: number;
  readonly id: string;
  readonly action: Action;
}

/** A random but valid table: 2 to 8 players over up to 8 seats, stacks in 1..1e9 (mostly small). */
function randomConfig(r: () => number): GameConfig {
  const players = int(r, 2, 8);
  const seatCount = int(r, players, 8);
  const seats: (Seat | null)[] = Array.from({ length: seatCount }, () => null);
  const free = seats.map((_, i) => i);
  for (let n = 0; n < players; n++) {
    const at = free.splice(int(r, 0, free.length - 1), 1)[0]!;
    const kind = r();
    // Some tiny stacks (short blinds, instant all-ins), mostly normal ones, a few huge ones.
    const stack = kind < 0.15 ? int(r, 1, 12) : kind < 0.95 ? int(r, 20, 2000) : int(r, 1, 1_000_000_000);
    seats[at] = { id: `p${n}`, stack };
  }
  const small = int(r, 1, 10);
  return { seats, blinds: { small, big: small * int(r, 1, 3) }, blindsEvery: int(r, 5, 25), maxHands: 120 };
}

const blindsFor = (config: GameConfig, handNo: number): Blinds => {
  const factor = 2 ** Math.floor(handNo / config.blindsEvery);
  return { small: config.blinds.small * factor, big: config.blinds.big * factor };
};

/** A random legal action, with a random size for bets and raises. Only offers what legalActions returns. */
function randomAction(r: () => number, legal: readonly LegalAction[]): Action {
  const weights: Record<LegalAction["type"], number> = { fold: 1, check: 4, call: 4, bet: 2, raise: 2, allIn: 0.4 };
  const total = legal.reduce((s, a) => s + weights[a.type], 0);
  let roll = r() * total;
  let pick = legal[legal.length - 1]!;
  for (const a of legal) {
    roll -= weights[a.type];
    if (roll < 0) { pick = a; break; }
  }
  if (pick.type === "bet" || pick.type === "raise") {
    const size = r();
    // Favour the minimum and the maximum, the edges where bugs live.
    const amount = size < 0.4 ? pick.min : size < 0.55 ? pick.max : int(r, pick.min, pick.max);
    return { type: pick.type, amount };
  }
  return { type: pick.type };
}

// ---------------------------------------------------------------------------------------------
// Invariant checks. Each throws an Error saying which invariant broke.

class InvariantError extends Error {}
function check(cond: boolean, invariant: number, msg: string): asserts cond {
  if (!cond) throw new InvariantError(`Invariant ${invariant} broken: ${msg}`);
}
const isChips = (n: unknown): boolean => typeof n === "number" && Number.isInteger(n) && n >= 0;

const STREETS = ["preflop", "flop", "turn", "river"] as const;
const BOARD_SIZE = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;

/** Everything a hand's checks need to know about how it started. */
interface HandContext {
  readonly handNo: number;
  readonly table: Table;
  readonly shuffled: Deck;
  readonly total: number;
  /** Stack each player started the hand with (before blinds). */
  readonly startStacks: ReadonlyMap<string, number>;
  /** Players dealt in, in dealing order (left of the button, clockwise). */
  readonly dealOrder: readonly number[];
  readonly prevButton: number | null;
  readonly prevBlinds: Blinds | null;
}

const tableTotal = (t: Table): number => t.seats.reduce((s, p) => s + (p ? p.stack : 0), 0);
const activeSeats = (t: Table): number[] => t.seats.flatMap((s, i) => (s && s.stack > 0 ? [i] : []));
/** First seat in `candidates` clockwise after `from`. */
function after(candidates: readonly number[], from: number, seatCount: number): number {
  for (let step = 1; step <= seatCount; step++) {
    const s = (from + step) % seatCount;
    if (candidates.includes(s)) return s;
  }
  throw new Error("no seat");
}

function checkTable(t: Table, expectedTotal: number, gameOver: { winner: string } | null): void {
  for (const s of t.seats) if (s) check(isChips(s.stack), 3, `seat ${s.id} has stack ${s.stack}`);
  check(tableTotal(t) === expectedTotal, 2, `table total ${tableTotal(t)}, expected ${expectedTotal} (no rebuys)`);
  const withChips = t.seats.filter((s): s is Seat => !!s && s.stack > 0);
  check((gameOver !== null) === (withChips.length === 1), 19, `gameOver ${JSON.stringify(gameOver)} with ${withChips.length} players holding chips`);
  if (gameOver) {
    check(withChips[0]!.id === gameOver.winner && withChips[0]!.stack === expectedTotal, 19, `winner ${gameOver.winner} must hold all ${expectedTotal}`);
  }
}

/** Invariants 8 and 9: the 52 real cards, each exactly where the shuffled deck says it is dealt. */
function checkCards(h: HandState, ctx: HandContext): void {
  const n = ctx.dealOrder.length;
  const all = [...h.deck, ...h.board, ...h.players.flatMap((p) => p.hole)];
  check(all.every(isValidCard), 8, "a card is not a real card");
  check(all.length === 52 && new Set(all.map(cardId)).size === 52, 8, `${all.length} cards, ${new Set(all.map(cardId)).size} distinct`);
  const same = (a: Card | undefined, b: Card | undefined) => !!a && !!b && cardId(a) === cardId(b);
  ctx.dealOrder.forEach((seat, i) => {
    const p = h.players.find((x) => x.seat === seat)!;
    check(same(p.hole[0], ctx.shuffled[i]) && same(p.hole[1], ctx.shuffled[n + i]), 9, `seat ${seat}'s hole cards are out of order`);
  });
  check(h.board.every((c, i) => same(c, ctx.shuffled[2 * n + i])), 9, "the board is not dealt in deck order (no burns)");
  check(h.deck.length === 52 - 2 * n - h.board.length && h.deck.every((c, i) => same(c, ctx.shuffled[2 * n + h.board.length + i])), 9, "the undealt deck is not the rest of the shuffled deck");
}

/** Invariants 9, 14 and 15 at the start of a hand. */
function checkStart(h: HandState, ctx: HandContext): void {
  const t = ctx.table;
  const active = activeSeats(t);
  check(h.players.length === active.length && h.players.every((p, i) => p.seat === active[i]), 9, "every player with chips (and only them) is dealt in, in seat order");
  const button = ctx.prevButton === null ? active[0]! : after(active, ctx.prevButton, t.seats.length);
  check(h.button === button, 14, `button on seat ${h.button}, expected ${button} (previous ${ctx.prevButton})`);
  if (ctx.prevButton !== null) check(h.button !== ctx.prevButton, 14, "the button did not move");
  const sb = active.length === 2 ? button : after(active, button, t.seats.length);
  const bb = after(active, sb, t.seats.length);
  check(h.smallBlindSeat === sb && h.bigBlindSeat === bb, 14, `blinds on seats ${h.smallBlindSeat}/${h.bigBlindSeat}, expected ${sb}/${bb}`);
  for (const p of h.players) {
    const stack = t.seats[p.seat]!.stack;
    const owed = p.seat === sb ? h.blinds.small : p.seat === bb ? h.blinds.big : 0;
    check(p.bet === Math.min(owed, stack) && p.contributed === p.bet, 14, `seat ${p.seat} posted ${p.bet}, expected ${Math.min(owed, stack)}`);
  }
  if (ctx.prevBlinds) {
    check(h.blinds.small >= ctx.prevBlinds.small && h.blinds.big >= ctx.prevBlinds.big, 15, "blinds went down");
  }
}

/** Per-street bookkeeping: who has acted on the current street. */
/**
 * Per-street bookkeeping kept by the harness, independently of the engine's own fields:
 * who has acted, the size of the last full raise, and who has acted since it (they may not
 * raise again unless a new full raise reopens the betting).
 */
interface StreetTrack {
  street: HandState["street"];
  acted: Set<string>;
  minRaise: number;
  actedSinceFullRaise: Set<string>;
}
const newTrack = (h: HandState): StreetTrack =>
  ({ street: h.street, acted: new Set(), minRaise: h.blinds.big, actedSinceFullRaise: new Set() });

/**
 * Invariants 1, 3, 4, 12 and 13 on any state during a hand. `before` is the state the last action
 * was applied to (null right after startHand/settleHand), `actor` who acted.
 */
function checkHand(h: HandState, ctx: HandContext, before: HandState | null, actor: string | null, track: StreetTrack): void {
  for (const p of h.players) {
    check(isChips(p.stack) && isChips(p.bet) && isChips(p.contributed), 3, `${p.id}: stack ${p.stack}, bet ${p.bet}, contributed ${p.contributed}`);
    check(p.contributed === ctx.startStacks.get(p.id)! - p.stack, 4, `${p.id} contributed ${p.contributed} but went from ${ctx.startStacks.get(p.id)} to ${p.stack}`);
    check(p.bet <= p.contributed, 4, `${p.id} bet ${p.bet} more than they put in (${p.contributed})`);
    if (p.status === "allIn") check(p.stack === 0, 4, `${p.id} is all-in with ${p.stack} behind`);
    if (p.status === "active") check(p.stack > 0, 4, `${p.id} has no chips but is not all-in`);
  }
  check(isChips(h.pot), 3, `pot ${h.pot}`);
  const inPlay = h.pot + h.players.reduce((s, p) => s + p.stack + p.bet, 0);
  check(inPlay === ctx.total, 1, `stacks + bets + pot = ${inPlay}, expected ${ctx.total}`);
  check(h.currentBet === Math.max(0, ...h.players.map((p) => p.bet)), 12, `currentBet ${h.currentBet} is not the highest bet`);
  check(h.minRaise >= h.blinds.big, 12, `minimum raise ${h.minRaise} is below the big blind ${h.blinds.big}`);

  check(h.board.length === BOARD_SIZE[h.street], 13, `${h.board.length} board cards on the ${h.street}`);
  if (h.stage === "showdown") check(h.street === "river" && h.players.every((p) => p.bet === 0), 13, "showdown before the river betting is settled");
  if (h.stage === "betting") {
    const toAct = h.players.find((p) => p.seat === h.toAct);
    if (h.toAct !== null) check(toAct?.status === "active", 12, `seat ${h.toAct} is to act but is ${toAct?.status ?? "not in the hand"}`);
    check((legalActions(h).length > 0) === (h.toAct !== null), 12, "legal actions exist iff someone is to act");
  } else {
    check(h.toAct === null && legalActions(h).length === 0, 12, `nobody may act once the stage is ${h.stage}`);
  }

  if (before) {
    const from = STREETS.indexOf(before.street);
    const to = STREETS.indexOf(h.street);
    check(to >= from, 13, `went back from ${before.street} to ${h.street}`);
    check(before.stage === "betting", 13, `acted in stage ${before.stage}`);
    if (actor) {
      track.acted.add(actor);
      const bet = h.players.find((p) => p.id === actor)!.bet;
      const size = bet - before.currentBet;
      if (to === from && size >= track.minRaise) {
        track.minRaise = size;
        track.actedSinceFullRaise = new Set([actor]);
      } else {
        track.actedSinceFullRaise.add(actor);
      }
    }
    if (to > from) {
      // The old street closed: it must have been settled after this action.
      const live = h.players.filter((p) => p.status !== "folded");
      const top = Math.max(...live.map((p) => p.contributed));
      const active = h.players.filter((p) => p.status === "active");
      for (const p of active) {
        check(p.contributed === top, 13, `${before.street} ended with ${p.id} owing ${top - p.contributed}`);
        if (active.length >= 2) check(track.acted.has(p.id), 13, `${before.street} ended before ${p.id} acted`);
      }
      check(h.players.every((p) => p.bet === 0), 13, "bets were not swept into the pot");
      Object.assign(track, newTrack(h));
    }
  }
  if (h.stage === "betting") {
    check(h.minRaise === track.minRaise, 12, `minimum raise is ${h.minRaise}, but the last full raise was ${track.minRaise}`);
  }
}

/** Invariants 11 and 12: actions from the wrong player, or illegal sizes, are rejected. */
function probeIllegal(h: HandState, track: StreetTrack): void {
  const rejected = (id: string, a: Action, what: string, inv: number) => {
    const r = applyAction(h, id, a);
    check(!r.ok, inv, `${what} was accepted: ${id} ${JSON.stringify(a)}`);
  };
  rejected("nobody-here", { type: "fold" }, "an unknown player", 11);
  if (h.stage !== "betting" || h.toAct === null) {
    for (const p of h.players) rejected(p.id, { type: "fold" }, "acting when nobody may act", 12);
    return;
  }
  const me = h.players.find((p) => p.seat === h.toAct)!;
  for (const p of h.players) {
    if (p !== me) {
      rejected(p.id, { type: "fold" }, "folding out of turn", 11);
      rejected(p.id, { type: "call" }, "calling out of turn", 11);
    }
  }
  const legal = legalActions(h);
  const toCall = h.currentBet - me.bet;
  if (toCall > 0) rejected(me.id, { type: "check" }, "checking facing a bet", 12);
  else rejected(me.id, { type: "call" }, "calling nothing", 12);
  const max = me.bet + me.stack;
  const sizing = legal.find((a): a is Extract<LegalAction, { min: number }> => a.type === "bet" || a.type === "raise");
  const sizeType = h.currentBet === 0 ? "bet" : "raise";
  const reopened = !track.actedSinceFullRaise.has(me.id);
  const allIn = legal.find((a) => a.type === "allIn");
  if (!reopened) {
    // A short all-in does not reopen the betting for players who already acted.
    check(!sizing && (!allIn || max <= h.currentBet), 12, `${me.id} may raise although no full raise reopened the betting`);
  } else if (max >= h.currentBet + track.minRaise) {
    check(!!sizing, 12, `${me.id} faces a full raise and covers a min-raise but cannot raise`);
  }
  rejected(me.id, { type: sizeType, amount: max + 1 }, "betting more than the stack", 4);
  if (sizing) {
    check(sizing.min === h.currentBet + h.minRaise && sizing.max === max, 12, `${sizing.type} range ${sizing.min}..${sizing.max}`);
    if (sizing.min - 1 > h.currentBet) rejected(me.id, { type: sizing.type, amount: sizing.min - 1 }, "a bet under the minimum", 12);
  } else if (max > h.currentBet && max >= h.currentBet + h.minRaise) {
    // No raise offered although the stack covers one: only allowed when betting was not reopened.
    check(!me.raiseOpen, 12, `${me.id} could raise but no raise was offered`);
    rejected(me.id, { type: sizeType, amount: h.currentBet + h.minRaise }, "a raise when betting was not reopened", 12);
  }
}

/** Invariants 5, 6, 7, 10 and 22: pay-out matches an independent oracle. */
function checkResult(before: HandState, result: HandResult, ctx: HandContext, seatCount: number): void {
  const h = result.hand;
  check(h.stage === "complete" && h.pot === 0 && h.players.every((p) => p.bet === 0), 5, "the pot is not empty after the payout");
  const live = before.players.filter((p) => p.status !== "folded");
  const showdown = before.stage === "showdown" && live.length > 1;
  const values = new Map<string, HandValue>();
  if (showdown) for (const p of live) values.set(p.id, evaluateHoleAndBoard(p.hole, before.board));

  // Oracle: peel contribution levels off one at a time; each slice goes to the best live hands that reached it.
  const left = new Map(before.players.map((p) => [p.id, p.contributed]));
  const expected = new Map(before.players.map((p) => [p.id, p.stack]));
  const leftOfButton = (seat: number) => (seat - before.button - 1 + seatCount) % seatCount;
  while ([...left.values()].some((c) => c > 0)) {
    const contenders = live.filter((p) => left.get(p.id)! > 0);
    check(contenders.length > 0, 5, "chips left in the pot with no live player eligible");
    const level = Math.min(...contenders.map((p) => left.get(p.id)!));
    let amount = 0;
    for (const [id, c] of left) {
      const take = contenders.length === 1 ? c : Math.min(c, level); // a lone contender takes the rest back
      amount += take;
      left.set(id, c - take);
    }
    let winners = contenders;
    if (showdown) {
      const best = contenders.reduce((b, p) => (compareHands(values.get(p.id)!, values.get(b.id)!) > 0 ? p : b));
      winners = contenders.filter((p) => compareHands(values.get(p.id)!, values.get(best.id)!) === 0);
    }
    winners = [...winners].sort((a, b) => leftOfButton(a.seat) - leftOfButton(b.seat));
    const share = Math.floor(amount / winners.length);
    winners.forEach((w, i) => expected.set(w.id, expected.get(w.id)! + share + (i < amount - share * winners.length ? 1 : 0)));
  }
  for (const p of h.players) {
    check(p.stack === expected.get(p.id), 6, `${p.id} ended with ${p.stack}, expected ${expected.get(p.id)} (pots, side pots, splits)`);
  }
  for (const award of result.awards) {
    check(award.pot.eligible.every((id) => live.some((p) => p.id === id)), 6, `a pot lists a folded player as eligible: ${award.pot.eligible}`);
  }
  check(result.awards.reduce((s, a) => s + a.pot.amount, 0) === before.players.reduce((s, p) => s + p.contributed, 0), 5, "the pots do not add up to everything put in");
  const revealed = result.revealed.map((r) => r.id).sort();
  check(JSON.stringify(revealed) === JSON.stringify(showdown ? live.map((p) => p.id).sort() : []), 22, `revealed ${revealed} (showdown: ${showdown})`);
}

// ---------------------------------------------------------------------------------------------
// The simulation.

/** Deep-freeze a state so any mutation by the engine throws (invariant 29). */
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}

interface GameRun {
  readonly seed: number;
  readonly config: GameConfig;
  readonly actions: readonly LoggedAction[];
  readonly hands: number;
  readonly finalTable: Table;
  readonly winner: string | null;
}

/**
 * Play one game. With `script`, actions are replayed from the list instead of picked at random
 * (the deal still comes from the seed). `extraCheck` lets a test inject a failing check.
 */
function simulateGame(
  seed: number,
  opts: {
    script?: readonly LoggedAction[];
    extraCheck?: (h: HandState, actionNo: number) => void;
    onHand?: (start: HandState, end: HandState, result: HandResult, runout: boolean) => void;
  } = {},
): GameRun {
  // Two streams: the table and the shuffles, and the players' choices. Replaying recorded actions
  // skips the second one but still deals exactly the same cards.
  const r = rng(seed);
  const choices = rng((seed ^ 0x9e3779b9) >>> 0);
  const config = randomConfig(r);
  const actions: LoggedAction[] = [];
  let handNo = 0;
  try {
    let table = freeze(createTable(config.seats));
    const total = tableTotal(table);
    let prevButton: number | null = null;
    let prevBlinds: Blinds | null = null;
    let winner: string | null = null;
    for (; handNo < config.maxHands; handNo++) {
      const shuffled = freeze(shuffle(createDeck(), int(r, 0, 4294967295)));
      const blinds = blindsFor(config, handNo);
      const start = freeze(startHand(table, shuffled, blinds));
      const dealOrder: number[] = [];
      const active = activeSeats(table);
      let s = start.button;
      for (let i = 0; i < active.length; i++) dealOrder.push((s = after(active, s, table.seats.length)));
      const ctx: HandContext = {
        handNo, table, shuffled, total, dealOrder, prevButton, prevBlinds,
        startStacks: new Map(start.players.map((p) => [p.id, table.seats[p.seat]!.stack])),
      };
      checkStart(start, ctx);
      const track = newTrack(start);
      let h = freeze(settleHand(start));
      let runout = h.stage === "showdown";
      checkHand(h, ctx, null, null, track);
      checkCards(h, ctx);
      while (h.stage === "betting") {
        probeIllegal(h, track);
        const me = h.players.find((p) => p.seat === h.toAct)!;
        let action: Action;
        if (opts.script) {
          const next = opts.script[actions.length];
          if (!next || next.hand !== handNo || next.id !== me.id) throw new Error(`The script does not match the game at action ${actions.length}`);
          action = next.action;
        } else {
          action = randomAction(choices, legalActions(h));
        }
        actions.push({ hand: handNo, id: me.id, action });
        const res = applyAction(h, me.id, action);
        check(res.ok, 12, `a legal action was rejected: ${res.ok ? "" : res.reason}`);
        const before = h;
        h = freeze(res.hand);
        if (h.stage === "showdown" && before.street !== "river") runout = true;
        checkHand(h, ctx, before, me.id, track);
        checkCards(h, ctx);
        opts.extraCheck?.(h, actions.length);
      }
      probeIllegal(h, track);
      const result = freeze(settleShowdown(h));
      checkResult(h, result, ctx, table.seats.length);
      opts.onHand?.(start, h, result, runout);
      checkCards(result.hand, ctx);
      const next = freeze(nextHand(table, result.hand));
      checkTable(next.table, total, next.gameOver);
      prevButton = start.button;
      prevBlinds = blinds;
      table = next.table;
      if (next.gameOver) {
        winner = next.gameOver.winner;
        handNo++;
        break;
      }
    }
    return { seed, config, actions, hands: handNo, finalTable: table, winner };
  } catch (e) {
    throw new Error(failureReport(seed, config, handNo, actions, e), { cause: e });
  }
}

/** A message with everything needed to replay the failure. */
function failureReport(seed: number, config: GameConfig, handNo: number, actions: readonly LoggedAction[], e: unknown): string {
  const byHand = new Map<number, string[]>();
  for (const a of actions) {
    const list = byHand.get(a.hand) ?? [];
    list.push(`${a.id} ${a.action.type}${"amount" in a.action ? ` ${a.action.amount}` : ""}`);
    byHand.set(a.hand, list);
  }
  const lines = [...byHand].map(([n, list]) => `  hand ${n}: ${list.join(", ")}`);
  return [
    `Simulation failed: ${e instanceof Error ? e.message : String(e)}`,
    `  seed: ${seed}   (replay with CLB_SIM_SEED=${seed} pnpm test simulation)`,
    `  failed in hand ${handNo}, after ${actions.length} actions`,
    `  table: ${JSON.stringify(config.seats)}  blinds: ${JSON.stringify(config.blinds)} doubling every ${config.blindsEvery} hands`,
    `  actions:`,
    ...lines,
    `  actions as JSON (for simulateGame(seed, { script })): ${JSON.stringify(actions)}`,
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------

const replaySeed = process.env.CLB_SIM_SEED;
const GAMES = 2000;
const FIRST_SEED = 20261127;

describe("hand simulation", () => {
  if (replaySeed !== undefined) {
    test(`replays seed ${replaySeed}`, () => {
      simulateGame(Number(replaySeed));
    });
    return;
  }

  test(`${GAMES} random games keep every invariant after every action`, { timeout: 60_000 }, () => {
    let hands = 0;
    let actions = 0;
    let finished = 0;
    for (let g = 0; g < GAMES; g++) {
      const run = simulateGame((FIRST_SEED + g * 7919) >>> 0);
      hands += run.hands;
      actions += run.actions.length;
      if (run.winner) finished++;
    }
    // Make sure the run is meaningful: thousands of hands, and many games played to the end.
    expect(hands).toBeGreaterThan(10_000);
    expect(actions).toBeGreaterThan(hands);
    expect(finished).toBeGreaterThan(GAMES / 2);
  });

  test("covers the interesting cases: side pots, split pots, folds, run-outs and short blinds", () => {
    const seen = { sidePots: 0, splits: 0, oddChips: 0, folds: 0, showdowns: 0, runouts: 0, shortBlinds: 0, headsUp: 0, eightHanded: 0 };
    for (let g = 0; g < 60; g++) {
      simulateGame((FIRST_SEED + g * 7919) >>> 0, {
        onHand: (start, end, result, runout) => {
          if (start.players.length === 2) seen.headsUp++;
          if (start.players.length === 8) seen.eightHanded++;
          if (start.players.some((p) => p.status === "allIn")) seen.shortBlinds++;
          if (end.stage === "fold") seen.folds++;
          else seen.showdowns++;
          if (runout) seen.runouts++;
          if (result.awards.length > 1) seen.sidePots++;
          for (const aw of result.awards) {
            const winners = countWinners(aw.pot.eligible, result);
            if (winners > 1) seen.splits++;
            if (winners > 1 && aw.pot.amount % winners !== 0) seen.oddChips++;
          }
        },
      });
    }
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(0);
  });

  test("a game replays identically from its seed, and from its recorded actions", () => {
    for (const seed of [0, 1, 4294967295, 123456789]) {
      const a = simulateGame(seed);
      const b = simulateGame(seed);
      expect(b).toEqual(a);
      const scripted = simulateGame(seed, { script: a.actions });
      expect(scripted).toEqual(a);
    }
  });

  test("an invariant failure reports the seed and the actions so it can be replayed", () => {
    const seed = 42;
    const full = simulateGame(seed);
    expect(full.actions.length).toBeGreaterThan(3);
    let err: Error | undefined;
    try {
      simulateGame(seed, { extraCheck: (_h, n) => { if (n === 3) throw new Error("injected failure"); } });
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    const msg = err!.message;
    expect(msg).toContain("injected failure");
    expect(msg).toContain(`seed: ${seed}`);
    expect(msg).toContain(`CLB_SIM_SEED=${seed}`);
    const first3 = full.actions.slice(0, 3);
    expect(msg).toContain(JSON.stringify(first3));
    // The printed actions really replay the game up to the failure.
    const json = JSON.parse(msg.slice(msg.indexOf("[", msg.indexOf("actions as JSON")))) as LoggedAction[];
    expect(json).toEqual(first3);
  });

  test("a broken invariant is caught: tampering with chips fails the chip check", () => {
    // Sanity check of the checker itself: a state that creates a chip out of nothing must fail.
    const t = createTable([{ id: "a", stack: 100 }, { id: "b", stack: 100 }]);
    const shuffled = shuffle(createDeck(), 7);
    const start = startHand(t, shuffled, { small: 1, big: 2 });
    const ctx: HandContext = {
      handNo: 0, table: t, shuffled, total: 200, dealOrder: [1, 0], prevButton: null, prevBlinds: null,
      startStacks: new Map([["a", 100], ["b", 100]]),
    };
    const track = newTrack(start);
    expect(() => checkHand(start, ctx, null, null, track)).not.toThrow();
    const forged: HandState = { ...start, pot: 1 };
    expect(() => checkHand(forged, ctx, null, null, track)).toThrow(/Invariant 1/);
    const swapped: HandState = { ...start, board: [start.deck[1]!, start.deck[0]!, start.deck[2]!], street: "flop", deck: start.deck.slice(3) };
    expect(() => checkCards(swapped, ctx)).toThrow(/Invariant 9/);
  });

  test("tables outside 2 to 8 players never start (invariant 16)", () => {
    const seat = (i: number): Seat => ({ id: `p${i}`, stack: 100 });
    expect(() => createTable([seat(0)])).toThrow();
    expect(() => createTable(Array.from({ length: 9 }, (_, i) => seat(i)))).toThrow();
    expect(() => createTable(Array.from({ length: 2 }, (_, i) => seat(i)))).not.toThrow();
    expect(() => createTable(Array.from({ length: 8 }, (_, i) => seat(i)))).not.toThrow();
  });
});

/** How many players tie for the best shown hand among `eligible` (0 when nothing was shown). */
function countWinners(eligible: readonly string[], result: HandResult): number {
  const shown = result.revealed.filter((r) => eligible.includes(r.id));
  if (shown.length === 0) return 0;
  const best = shown.reduce((b, r) => (compareHands(r.value, b.value) > 0 ? r : b));
  return shown.filter((r) => compareHands(r.value, best.value) === 0).length;
}
