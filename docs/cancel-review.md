# Native cancellation integration review

Scope reviewed: `apps/web/src/RunControls.tsx`, `apps/api/commands.ts`,
`apps/api/server.ts`, `packages/commands/index.ts`, and
`tests/commands.test.ts`. No live Run or native service was called.

## Confirmed: a Run already marked cancelling can trigger another cancel

**Evidence:** `apps/web/src/RunControls.tsx:10` includes `cancelling` in
`cancellable`, and line 105 enables the action for that status. The API checks
write authorization and the Run capability, but does not reject a cancelling
status (`apps/api/commands.ts:17-20`). `CommandService.execute` treats only
terminal statuses specially (`packages/commands/index.ts:124-150`), so a fresh
observation of `cancelling` falls through to `ports.cancel` at line 134. Every
new click uses a new UUID (`RunControls.tsx:73`), so idempotency does not
coalesce it with an earlier request.

**Failure path:** if a native Run entered `cancelling` due to an earlier request
whose receipt is unavailable to this actor (for example, initiated outside
Track), or before Track's first request, the user can issue another native
cancel. The service will dispatch it. Whether the native endpoint treats that
repeat as harmless is not established by this review; duplicate dispatch itself
is source-confirmed, while any native side effect is conditional.

**Minimal correction:** treat an observed `cancelling` status as an
already-in-progress outcome and do not call `ports.cancel`; persist an
unattributed/unknown receipt so the UI remains blocked pending terminal
observation. Remove `cancelling` from the UI's directly cancellable statuses
(or render a status-only affordance). Keep polling/reconciliation so a later
`cancelled` observation can settle the receipt.

`tests/command-ui-regression.test.ts` captures the no-second-dispatch invariant.
It failed against the reviewed implementation. The parent removed `cancelling`
from actionable UI states and records `runtime_cancelling_observed` as unknown
without dispatch. The regression now passes. An additional atomic SQLite check
rejects a different UUID while the same actor/Run has an unresolved cancellation;
the concurrency/unknown regression also passes.

## Conditional race: cursor validation is not atomic with dispatch

`packages/commands/index.ts:99-120` reads and compares the current cursor, then
awaits authorization again before dispatch at lines 131-134. The adapter's
`cancel` call receives only the Run ID (`apps/api/commands.ts:37-48`); it does
not carry the cursor or a conditional version. Therefore, if the native Run
advances or changes state after the observation and before the cancel request,
the dispatch is still made against that changed state. This is a real
time-of-check/time-of-use gap in the Track code; the effect depends on the
native endpoint's behavior for concurrent state changes, which was not
inspected or invoked.

**Minimal correction:** have the native cancel contract accept and atomically
check the expected cursor/version, returning a conflict without dispatch when
it changed. A second Track-side read immediately before dispatch can narrow the
window but cannot close it.

Parent checked the native route in Demian `apps/api/src/server.ts`: it rechecks
artifact/session/cancel policy and handles terminal Runs, but accepts no expected
cursor. Track's cursor is a local journal freshness check, not a native atomic
precondition. This limitation remains explicit; no native API change is claimed.

## Coverage and limits

The command tests exercise stale-cursor rejection, receipt idempotency,
authorization revocation, and non-replay after ambiguous transport outcomes.
This review did not inspect the native service, inspect private configuration,
or exercise a live cancellation. The `cancelling` duplicate-dispatch finding is
confirmed from the reviewed source and captured by the scoped regression test;
the time-of-check/time-of-use consequence is conditional on concurrent native
state changes.
