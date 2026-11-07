# Clubhouse Poker: agent rules

Clubhouse Poker is Texas Hold'em played like a Jackbox party game: a shared table screen, with each player's phone as their private hand. Couch mode first.

## Before any work

Read `/context/vision.md` and `/context/spec.md` in full. They describe the game and are owned by Geeneth. They are read-only: never edit them.

## Rules every agent follows

1. **Never edit `docs/invariants.md` or anything in `tests/locked/`.** If a change seems to conflict with an invariant or a locked test, your code is wrong. Stop and ask rather than editing them.
2. **One ticket per branch,** named after the ticket, like `CLB-12-hand-evaluator`. Never work on `main`, and branch from an up-to-date `main`.
3. **Start every commit message with the ticket ID,** like `CLB-12: Add hand evaluator`.
4. **Every change comes with tests.** Put them next to the code (`*.test.ts`). Do not put them in `tests/locked/`.
5. **Game rules live in the engine package** (`packages/engine`). The server and web app never re-implement them.
6. **The engine stays pure:** no networking, no clocks, no global state, and randomness (shuffles) is passed in.
7. **Hidden cards never leave the server** except to their owner. See `docs/invariants.md`.
8. Ask before making big stack decisions (new frameworks, new runtime dependencies of note).

## Repo layout

```
CLAUDE.md                  these rules
docs/invariants.md         rules that must always hold (read-only)
tests/locked/              tests owned by Geeneth (read-only)
packages/engine/           pure game rules, no networking
packages/server/           game server: authoritative state, WebSockets (ws)
packages/web/              Svelte 5 + Vite app: table screen (/) and phone controller (/play/)
assets/                    brand assets (logo)
```

## Commands

Requires Node 22+ and pnpm.

```
pnpm install      install dependencies
pnpm test         run all tests (every package and tests/locked)
pnpm typecheck    typecheck every package
```
