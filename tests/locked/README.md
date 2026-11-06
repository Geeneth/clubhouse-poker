# Locked tests

Tests in this folder are written or approved by Geeneth. They define behaviour that must not drift: the invariants in `docs/invariants.md` and the game rules in `/context/spec.md`.

**Agents must never edit, move, rename, delete or skip anything in `tests/locked/`.** That includes loosening an assertion, adding `.skip` or `.only`, or changing the runner config so these tests stop running.

If a locked test fails, your code is wrong. Fix the code, not the test. If you believe a locked test is wrong, stop and tell Geeneth.

New locked tests are added only by Geeneth, or by an agent when Geeneth explicitly approves the contents. Tests agents write for their own tickets go next to the code (for example `packages/engine/src/*.test.ts`), not here.

`pnpm test` runs this folder together with every package.
