# Optional Assistant execution reader

Status: contract and portable producer service implemented and tested. **Not wired
into the native Assistant, deployed, provisioned or enabled in Track.** Public
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

Next native integration: verify the current core files against the running image,
add narrow coordinator read methods and opt-in service route wiring, test actual
SQLite/HTTP paths and existing UI authentication, then package an isolated overlay
with preservation/rollback checks. Existing reporting/gateway overlays, live
business/credential state and the original worktree must be preserved. Track still
needs an owner-bound adapter, current Projects grant checks and its own UI projection.

Source audit: the real public application runs in Persona's separate rootless
engine. Its audited image is
`sha256:ccdb8c9b7337cd46005472a0bd23c1620b7a87d68e49ea7eba642e7efbbddcf0`.
Installed `main.js`, `api.js` and `workbench/executions.js` hashes matched local
compiled files at the time of audit. The base revision label and container name
alone are not proof of all reporting/gateway source layers.
