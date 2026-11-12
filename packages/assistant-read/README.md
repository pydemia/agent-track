# Optional Assistant execution reader

Status: contract and portable producer service implemented and tested. Native
coordinator/HTTP wiring is implemented in private [Persona PR21](https://github.com/pydemia/persona/pull/21).
**Not deployed, provisioned or enabled in Track.** Public
Assistant source remains unsupported until those steps and real authorized reads
are verified. No new credential or native database mutation was performed here.

`service.ts` depends only on Node APIs, Zod and `contracts/assistant.ts`. The same
metadata contract can be shipped into an isolated, version-pinned native build.
The `AssistantReadPort` must be implemented by the native coordinator with owner
filtering before SQL limit/order and strict current frozen-context authorization.
Only then may it return execution/event metadata; withdrawn context returns null.

The intended GET-only prefix is `/api/integrations/track/v1`, with capabilities,
execution paging, one execution and its metadata events. The dedicated reader is
bound to the current configured Entra work owner and an expiring revisioned private
credential. It cannot borrow UI cookies/proxy keys or outbound Note/Projects keys.
It rechecks authority before returning results. List cursors retain an owner-scoped
row-ID high water and expire after at most15 minutes; Assistant event cursors are
safe-integer decimals and are separate from Demian PostgreSQL int64 sequences.

Clean baseline compilation reproduced the installed core hashes. The candidate
adds strict native coordinator reads, opt-in service auth and observational runtime
snapshots. It avoids lifecycle getters that can stop an unrelated live Task; real
Tasks query-only SQLite and existing UI authentication checks cover that boundary.
The full native suite passed885/899, failed0, environment skips14. Native CI is
tracked separately in `docs/assistant-native-reader-verification.json`.

Next: build a full tracked-source candidate image with new preservation/rollback,
fresh backup and guard pins; do not reuse the old resume-boot receipt. Existing
reporting/gateway behavior, live business/credential state and the original worktree
must be preserved. No `/app` bind-code overlay exists in current production. Track still
needs an owner-bound adapter, current Projects grant checks and its own UI projection.

Source audit: the real public application runs in Persona's separate rootless
engine. Its audited image is
`sha256:ccdb8c9b7337cd46005472a0bd23c1620b7a87d68e49ea7eba642e7efbbddcf0`.
Installed `main.js`, `api.js` and `workbench/executions.js` hashes matched a fresh
clean-baseline build. The base revision label and container name
alone are not proof of all reporting/gateway source layers.
