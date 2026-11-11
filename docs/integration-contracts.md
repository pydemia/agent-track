# Native integration contracts: Demian, Projects, Assistant

Status date: 2026-11-11. This is a source audit for Agent Track adapters, not a claim of deployed cross-app integration. Source paths below are repository-relative unless marked otherwise. Demian proposal context: `C:/Users/pydemia/git/demian/docs/agent-track-integration/proposal.ko.md`. Existing Track constraints: `docs/product-plan.md`, `docs/development-plan.md`, `docs/multi-project-overview.md`.

## Findings at a glance

| Host | Implemented and supportable now | Missing for Track |
|---|---|---|
| Demian | Authenticated Workspace/Session/Run reads; per-Run resumable SSE; per-Run message paging; selected lineage and artifact reads; permission-gated control. Runtime invocation and cowork events; managed child runs; peer-processing records. | No organization/project-wide run index or event feed, no Track binding API, no Track-specific read principal, no host-independent deep-link contract. A Run SSE is not a global feed. |
| Projects | Authenticated project/item CRUD and reads; access/membership permission model; SkillRun history; separate Assistant service routes for project/task read and controlled result writes. | No Demian Run external-reference model, no Track summary/feed, no canonical deep-link helper documented for foreign app selection. Projects owns project/item state and revisions. |
| Assistant (Persona) | User-session API for conversations/messages/tasks/actions and streaming; command ledger and event sequence; Projects task capabilities through explicit assistant integration. | No read-only Track API/principal or export feed; current conversation/task APIs are user-facing and command/SSE sequences are not Demian run-event cursors. No stable cross-app deep-link contract found. |

## Demian: read, stream, events, control, auth

Primary code: `apps/api/src/server.ts` (`register...`, route definitions, `principalFor`, `authorize`); `packages/protocol/src/index.ts` (`PublicEvent`, `RunResource`, `API_VERSION`); `apps/worker/src/events.ts` (`mapRuntimeEvent`); `nodejs/src/events.ts` (runtime event union); `packages/db/src/native-lineage.ts`; `packages/db/src/managed-children.ts`; `apps/api/src/peer-processing.ts`; `apps/web/src/components/ChatClient.tsx`, `apps/web/src/components/PeerProcessingPanel.tsx`.

Implemented read routes in `apps/api/src/server.ts`:

- `GET /api/v1/workspaces`, `GET /api/v1/workspaces/:workspaceId`.
- `GET /api/v1/sessions?workspace_id=...`, `GET /api/v1/sessions/:sessionId`.
- `GET /api/v1/sessions/:sessionId/messages?limit=1..500&after=<decimal>` returns message data and per-message entry metadata; response includes `next_cursor`, `has_more`, `incomplete_history`, `history_source`.
- `GET /api/v1/runs/:runId` returns one Run.
- `GET /api/v1/runs/:runId/events?after=<decimal>` streams SSE, honoring `Last-Event-ID` in preference to query cursor and emitting `id: sequence_text`. Stream rechecks access while connected. This is the supported incremental event source for a known Run.
- `GET /api/v1/runs/:runId/lineage?after=...&limit=...` reads native lineage only when the applicable artifact and lineage checks pass; absence/denial can mean lineage unavailable, not no child.
- Other evidence routes include `/api/v1/runs/:runId/artifacts` and run-scoped permissions. Control routes include `POST /api/v1/runs/:runId/cancel` and `POST /api/v1/runs/:runId/permissions/:permissionId/decision`; they are not read-adapter endpoints and require control authorization.

Run events carry `api_version`, `run_id`, `type`, `created_at`, `data`, `sequence_text` and legacy `sequence`. In `packages/protocol/src/index.ts`, `sequence_text` is the canonical positive PostgreSQL int64 decimal and authoritative SSE cursor; `sequence` may be null when not exactly representable as a JavaScript safe integer. Keep sequence/cursors as validated decimal strings end to end. Do not cast through JS Number, sort different source streams by timestamp as causal order, or treat a session message sequence as a run event sequence. `apps/api/src/server.ts` validates cursors against PostgreSQL int64 bounds using BigInt; SSE event ID is `sequence_text`.

`nodejs/src/events.ts` defines distinct invocation events (`agent.invocation.*`) with `invocationId`, optional `parentInvocationId`, and `agentSessionId`; cowork events (`cowork.group.*`, `cowork.member.*`) carry `groupId`, `memberId`, and parent invocation; these are mapped by `apps/worker/src/events.ts` into durable run events. `managed_child_receipts` in `packages/db/src/managed-children.ts` records a distinct child Run with parent/child invocation IDs and its own status/events. Peer-processing has its own receipts/snapshots and web routes/UI (`apps/api/src/peer-processing.ts`, `apps/web/src/components/PeerProcessingPanel.tsx`). These relationships are not interchangeable:

- `invocation`: logical agent invocation with invocation identity and optional parent; not necessarily a separate Demian Run.
- `cowork`: group/member workflow and statuses; members are not automatically Runs.
- `managed-child`: a separate, addressable Run linked to invocation IDs.
- `peer`: provenance/context transfer between conversations/sessions; not native parent-child execution.

Track must persist the source relation kind, source IDs, and evidence. Never flatten all four into one generic child edge or count invocation/member nodes as distinct Runs.

Auth is principal- and organization-scoped, not a public project feed. Routes call `principalFor(request)` and applicable `authorize(..., "view", {kind:"session", id, organizationId})`; run evidence can additionally require `assertArtifactRunReader`, and lineage requires `assertNativeLineageReader`. Use a server-side adapter identity with explicit least-privilege access and pass each user/project authorization check through Track; do not reuse browser cookies, copy bearer credentials into URLs, or assume that possessing a Session/Run ID grants access. Current controls recheck access per event stream. A Track deep link should carry opaque source selector IDs in path/query only; opening it in Demian must undergo Demian's normal authentication/authorization.

## Projects: ownership, reads, permission, links

Primary code: `src/projects/api.py` (`signed_in`, `/api/projects`, `/api/items`, `/api/projects/{project_id}/runs`, `/api/runs/{run_id}`); `src/projects/database.py` (`Project`, `ProjectMembership`, `Item`); `src/projects/project_access.py` (`require_project_access`, `project.read`); `src/projects/assistant_integration.py` (`PREFIX`, `authenticate`, `allowed_project`, `/capabilities`, `/projects`, `/tasks`); UI consumers `web/src/api.ts`, `web/src/hooks.ts`, `web/src/ProjectPages.tsx`, `web/src/TaskWorkspace.tsx`, `web/src/RunsPage.tsx`.

Projects owns its Project and Item/Task records, revisions, access policy, and SkillRun lifecycle. Core authenticated routes include `GET /api/projects`, `GET /api/projects/{project_id}`, `GET /api/items/{item_id}`, `GET /api/projects/{project_id}/runs`, `GET /api/runs/{run_id}` and `/api/projects/{project_id}/trace`. The last is requirement/relation impact trace, not runtime trace. Browser routes are encoded by `web/src/hooks.ts`; current UI uses project/task selections in its own route state. A stable foreign-app deep-link contract is not declared in the API; generate a URL only from the observed route implementation and verify it at integration time.

Web requests rely on the Projects signed-in session (`src/projects/api.py:signed_in`; `src/projects/auth.py:authenticate_proxy` for configured proxy auth). Server authorization is project-specific: `src/projects/project_access.py` checks `project.read` plus the requested permission against owner/role/membership policy; an ID or Task↔Run binding confers no read permission. The cross-app adapter must authenticate separately to Projects, verify `project.read` for every attached Project, and avoid exposing Task title/body/metadata or Run summaries to a caller who can access Track but not the Project. Do not infer visibility from Assistant's service account.

A distinct Assistant service integration exists at `src/projects/assistant_integration.py`, mounted under `PREFIX` (inspect constant there). It authenticates a service principal (`authenticate`) and checks explicit capabilities and allowed project scope; read endpoints are `/capabilities`, `/projects`, `/tasks`, `/tasks/{task_id}`, `/projects/{project_id}/tasks`. Write paths include task create/update and `/tasks/{task_id}/results`; this is for Assistant task operations, not a generic Agent Track API. Capabilities are separately named `projects:read`, `tasks:read` and write/result permissions. Reuse it only if its configured service-purpose and scopes match an explicitly designed Track adapter; do not claim its credential or grants exist for Track.

No external Demian Run reference or observation summary is present in Project/Item model contract found in `database.py` and the web `models.ts`. Add an explicit external-reference table/projection in a future integration, keyed by `(source, source_instance, external_id)` and attached to Project ID + Item ID + observed revision. Keep SkillRun ID and Demian Run ID distinct. Projects remains authoritative for task state, completion, and acceptance; Track stores a read projection and must not overwrite native records.

## Assistant / Persona: user APIs and Projects task bridge

Primary code: `apps/server/src/api.ts` (`createApp`, `sequenceSchema`, conversation/task/action routes, SSE); `apps/server/src/auth.ts` (user session); `apps/server/src/tasks.ts` (task command execution); `packages/contracts` (`taskCommandSchema`, conversation/message schemas); `apps/server/src/worker/command-ledger.ts` (if command ledger implementation is consulted); Projects counterpart `projects/src/projects/assistant_integration.py`.

Assistant's app API is a user-facing authenticated conversation and task surface. It exposes conversation/message/task/action routes and server-sent updates from `apps/server/src/api.ts`; sequence query parsing uses `sequenceSchema`, which accepts a bounded decimal then transforms it to a JS number constrained by `Number.MAX_SAFE_INTEGER`. This is a different sequence contract from Demian's int64 `sequence_text`; never use Assistant's event ID/cursor to resume a Demian stream or represent both as one integer field. Assistant routes execute task commands and can produce side effects; they are not a read-only export endpoint. No supported Track service principal, filtered event export, project-wide run aggregation, or immutable Track receipt was found.

Assistant-to-Projects integration is concrete and distinct: `projects/src/projects/assistant_integration.py` defines the service principal, capability negotiation, project/task reads and guarded task/result writes. Result writes return operation receipts/status for idempotent continuation. This integration does not turn Assistant's conversation/task stream into a general Track ingestion API. Before adapting, define whether Track reads only Assistant's task/result projections or also conversations; the latter requires a new privacy-reviewed, least-privilege read contract. Do not read raw transcripts as a substitute.

Authenticate Track-to-Assistant through an explicitly created service contract if/when available. Do not borrow an interactive user cookie, infer conversation visibility from a task link, or treat a Projects service token as an Assistant token. Current deep links are user app navigation, not a versioned inter-app route promise; preserve stable opaque conversation/task IDs and resolve them through Assistant's authenticated UI.

## Adapter plan and unsupported cases

1. **Demian read adapter first:** resolve a known authorized Session/Run from normal Demian lists; persist `(source, source_instance, workspace_id, session_id, run_id)` and its binding provenance. Page messages only when specifically needed; consume each known Run's SSE with durable string cursor, dedupe by source instance + run ID + sequence string, and retain gap/reconnect/incomplete-history markers. There is no supported global discovery feed, so seed run IDs through an explicit binding or a future Demian index API; do not poll/discover all org Runs by guessing routes.
2. **Typed relation projection:** map invocation, cowork group/member, managed child Run, and peer provenance to separate relation kinds. Treat native lineage, managed-child receipts, and peer conversation APIs as independently permissioned optional evidence. Missing/inaccessible lineage is `unsupported` or `redacted`, never proof that no relation exists.
3. **Projects read adapter:** use its authenticated read path and enforce `project.read`; add a native external execution-reference contract with owner-approved write semantics before creating bindings in Projects. Until then, binding creation belongs to a future explicit workflow and cannot be presumed supported. Keep Project/Item IDs and revisions as source-owned identifiers.
4. **Assistant adapter deferred:** no Track read/export contract is present. Propose a narrow read-only endpoint with purpose, allowed project/task/conversation scope, versioned sequence/cursor, redaction, revocation, and audit behavior. Until then mark Assistant conversation/run ingestion unsupported; if Projects already has Assistant result references, show those only through their existing authorized contract.
5. **Deep links:** use links to each host's authenticated UI with exact opaque source IDs. Demian workspace/session/run selection, Projects project/item selection, and Assistant conversation/task selection are independent. No cross-app deep-link or SSO token exchange contract was verified; never put credentials in URLs.
6. **Capability and health display:** distinguish `supported`, `partial`, `unsupported`, `forbidden`, `disconnected`, `incomplete_history`, and `stale`. Store last successful observation and source capability/version. A successful Run, agent report, verification, Projects acceptance, and adapter connectivity are independent states.

Concrete current blockers: (a) Demian has per-Run reads/SSE but no global Track discovery/feed or binding; (b) Projects has no Demian external-reference/read-summary contract; (c) Assistant has no Track read-only principal/feed; (d) project membership, session visibility, and artifact/native-lineage restrictions do not compose automatically across services; (e) host deep-link URL shapes are UI implementation details and not stable published integration contracts. These must be resolved as scoped adapters/contracts; do not represent them as existing support.


## 2026-11-11 native/Persona follow-up

Demian installed service was located at `C:/Users/pydemia/.demian/service/`.
Its `secrets.json` provides an existing loopback bearer via `apiToken`; Track
references it with `credentialFormat=demian-service`, without copying or printing
it. This is a trusted single-owner service credential, not a new least-privilege
multi-user Track principal. Current Track adapters read metadata and optionally dispatch native cancel for an explicitly configured single owner. Cancel rechecks source policy; no multi-user grant is inferred.
A dedicated empty-workspace native Run succeeded and produced17 durable events;
Track retained cursor17 through restart and displayed the same public Trace.

At the user's explicit request, the Persona chat `assistant 통합`
(`01a1ac97-c8d9-7ff0-9f45-5fa3ff3f4797`) checked its current source read-only.
Its audit baseline is `ce066ebc87d69ff514e63df102767969967eab49` in
`C:/Users/pydemia/.codex/worktrees/assistant-work-system/persona`.
The original checkout is `C:/Users/pydemia/git/persona`; its recorded server source
is `pydemia-server:/home/pydemia/git/persona`.

Additional implemented Assistant reads are:

- `GET /api/work/v1/executions`: owner-scoped, up to100 rows, no list cursor.
- `GET /api/work/v1/instructions/{instructionId}/executions` and
  `/api/work/v1/executions/{executionId}`: owner-scoped metadata.
- `GET /api/work/v1/executions/{executionId}/events?after={sequence}`:
  JSON `{events,cursor}`, not SSE or Demian's int64 stream.
- `/api/work/v1/executions/{executionId}/result` includes Note body/attachments;
  do not use as a metadata-only export.
- Existing deep links are
  `https://assistant.pydemia.ai/#workbench/projects/{instructionId}/executions/{executionId}`
  and `https://assistant.pydemia.ai/?conversation={conversationId}`.
  The `projects/` selector here is an instructionId, not a Projects Project ID.

These require verified Entra proxy identity plus Assistant session cookie and
owner checks. Existing Note/Projects HMAC is outbound, audience `note|projects`;
it does not authorize Track to read Assistant. `/api/session` is login metadata,
not an execution directory; Workbench runtimeTaskId deliberately returns404 at
`/api/tasks/{id}`. Thread/turn role metadata is not a desktop-wide API.

The Persona audit did not locate a pydemia-desktop implementation in local
repositories/worktrees, installed apps/processes or accessible GitHub results.
There is no evidence that it is another name for Persona/Assistant. This remains
an unresolved integration location, not proof the app does not exist. The worker
did not modify source, restart services, read credentials or publish anything.

The Demian chat also answered the user's authorized read-only consultation.
Its working checkout is `codex/common-sessions`, HEAD
`297678ea08529358aee5a48bef1b94fbea0d7275`; managed-child/peer modules and the
Track integration proposal are untracked working files, not that commit's contents.
Known-operation managed-child reads are
`GET /api/v1/sessions/{sessionId}/managed-children/{operation}`; peer processing
receipts have a separate operation-scoped read under stored peer conversations.
Both require their native user authorization and reject delegated context.
No complete managed-child history directory exists there. Peer conversation and
processing responses contain message/output text; do not store them as metadata.

Do not use peer `directory` or `managed-child-targets` as read-only history feeds:
the former can register a daemon sender and the latter can refresh deployment
state. The Demian device connector (`docs/device-connections.ko.md`,
`nodejs/src/device-connector.ts`) is real but does not establish that a separate
pydemia-desktop app exists. Both consulted chats could not locate that app.
Whether the user's name instead denotes the current `PYDEMIA-DESKTOP` PC is
awaiting clarification; no substitute app is fabricated.

Assistant's additional Projects task read is
`GET /api/work/v1/projects/tasks/{taskId}?projectId=...` in the separate
`assistant-demian-gateway/persona` worktree (`codex/demian-runtime-gateway`,
HEAD `ebb507a6ba43877bff530a4a975203b4374516fd`, relevant working changes).
It is an Assistant task import, not a Track read principal or summary API.
