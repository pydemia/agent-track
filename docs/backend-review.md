# Backend bounded review

Date: 2026-11-11 (KST)

## Finding

**P2 Warning — `apps/api/runner.ts:31` (impact at `packages/storage/store.ts:172`): a source configuration change can retain stale authorization state.**

`state()` computes the state from the current source configuration, then spreads the cached `SourceView` last. If a source ID that was previously connected is reconfigured to a kind without a supported collector (for example, `codex` to `assistant`), `views()` reports the previous `connected` state and capabilities instead of `unsupported`. `Store.snapshot()` excludes only `forbidden` and `unsupported` sources, so cached runs and relations for that ID remain visible while the new source configuration is in effect. The source ID is stable, so this can also expose the prior source's cached projection under the replacement source grant. Clear cached state when source identity/configuration changes, or ensure current configuration-derived state takes precedence and invalidate old projections when source identity changes.

Regression coverage: `tests/backend-regression.test.ts` changes a previously connected synthetic local source to an unsupported kind and asserts that its view becomes `unsupported`. This uses an empty temporary directory and does not read host logs or credentials.

## Reviewed requirements and coverage

- Reviewed `apps/api/config.ts`, `auth.ts`, `server.ts`, `runner.ts`, `packages/storage/store.ts`, and `packages/adapters/demian/index.ts` plus `packages/adapters/codex/index.ts`.
- Proxy authentication requires a configured proxy key and allowlisted forwarded email; local mode is loopback-only and rejects forwarded host identity.
- Snapshot projection intersects source visibility with a connected attached-project grant; forbidden/unsupported sources suppress cached runs and derived relations.
- Event data passes through metadata allowlists; source sequence values remain decimal strings, duplicates are digest-checked, gaps preserve a contiguous cursor, and bindings retain append-only history.
- Existing endpoint behavior is GET-only; command endpoints intentionally return 405. Native project-scoped grant composition remains a documented integration limitation, not a completed release capability.
- Public Entra consent and deployment/UI verification were outside this backend review and were not accessed.

## Verification and ownership

The independent review reproduced the defect (16 passed, 1 failed). The parent correction pins a source identity hash in durable metadata, refuses an ID reused for a different source/scope, invalidates cached health, and aborts the superseded stream. Unsupported replacement configurations no longer reuse connected state. Regression revalidation is recorded in the implementation QA record. The worker changed only the regression test and this note; parent owns runtime correction and UI/deployment verification.

## Native collection follow-up

Parent reproduced another ordering defect with real HTTP fixtures: one known Run
returned403, then a delayed allowed SSE header reset the whole source to connected
and exposed the denied cached Run. `backend-regression.test.ts` failed before the
fix. The collector now awaits each stream authorization and publishes connected
only after all known Run snapshots/event reads succeed. A permission-denial revision
also prevents an older stream from reopening a source mid-cycle. The regression
passes. This conservative source-wide hiding preserves safety at the cost of
availability when one cached Run becomes inaccessible; per-Run ACL projection is
a separate future contract.
