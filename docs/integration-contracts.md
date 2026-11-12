# Native integration contracts: Demian, Projects, Assistant

## Session-relation consumer follow-up (2026-11-12)

Demian now has source-level GET metadata contracts for session-scoped managed-child
and peer-processing receipts. Track consumes their closed schemas through a live
Run/Project authorization intersection and encrypted browser continuations, with
typed Map/Trace nodes and peer context groups. The source manifest's eight files
match the Demian working tree; that tree remains uncommitted. A separately frozen
444-input API bundle was reproduced and activated on the original loopback8080
after read-only canary and encrypted DB/role recovery verification. Worker and
optional runtimes remain stopped/unconfigured. Native receipt rows are currently
zero, so fixture graphs are not production execution evidence. See
`session-relations-integration.md` and `session-relations-verification.json`.
The actual API/Track/Entra readback and preservation scope are recorded in
`demian-api-reactivation-verification.json`.

## Context-summary consumer contract follow-up (2026-11-12)

Track now supplies a private, scope-bound v1 context GET API, Node server client,
and a host React summary component. This is the reverse direction from native
event ingestion: a native application's authenticated BFF can read Track's
authorized projection without sharing the public Entra proxy key. Current
opt-in readers are limited to one QA Project and two existing QA Sessions.
Fresh source/Project/native Run grants and binding revisions are checked; raw
titles, messages, tool inputs/outputs and user identities are omitted.

An independent client on the native Linux application host verified the actual
QA Task's two succeeded Runs/two Sessions and original todo state, a Session's
two observed Runs, forbidden out-of-scope reads and a disconnected result.
This was a temporary read-only helper, not an embedded native application UI.
Native BFF user authorization, Demian/Projects component integration and native
editing/outage-isolation verification remain outstanding. See
`context-summary-contract.md` and `native-context-summary-verification.json`.

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
- The current working artifact module exposes `GET /api/v1/sessions/:sessionId/artifacts`, a recent100 metadata list; filter explicit `run_id` and revoked state rather than attributing every session attachment to a Run. It is not a Run-wide complete history route. Other evidence routes include run-scoped permissions. Control routes include `POST /api/v1/runs/:runId/cancel` and `POST /api/v1/runs/:runId/permissions/:permissionId/decision`; they are not read-adapter endpoints and require control authorization.

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

### Assistant execution metadata follow-up (2026-11-12)

A second read-only source audit reconfirmed baseline `ce066ebc` without modifying
the Persona worktree. `workbench/execution-routes.ts:28,83` and
`workbench/executions.ts:592,603` require the current work owner, list at most100
executions without a list cursor, and page up to100 metadata events. Native
event/revision values are safe integers, not Demian PostgreSQL int64 cursors.
The installed Assistant version and any producer deployment remain unverified.

`packages/contracts/src/workbench.ts:110` has an exact Projects Task reference:
`sourceService=projects`, `sourceId` **is the Task ID**, `projectId`, revision,
state, canonical URL and observation time. It is not a Track source ID. Resolving
it to a Track Task requires an explicitly configured native Projects source and
fresh current Projects access. Historical reference state is not current acceptance.
`packages/contracts/src/work-execution.ts:77` carries role assignment/state and
Assistant runtimeTask/thread/turn IDs, without a parent-child graph. Its execution
ID and the `runtime.runId` published to Projects are Assistant WorkExecution IDs;
they must not be joined to Demian Runs by ID or similar timestamps.

Producer implementation boundary: a separate optional owner-bound, metadata-only
Assistant read principal/API, wired through native `main.ts`/`api.ts`. It must
provide bounded stable execution paging and strict allowlisted events, reject
mutations and wrong owner/audience/scope/expiry, and reload revocation state on
each request. Existing UI cookies, Entra proxy secrets and outbound Note/Projects
credentials are not substitute service credentials. Do not read execution result
Markdown or Note bodies. Explicit Demian/desktop references remain unavailable
until their producer supplies them; role membership alone is not delegation.

Implementation scope for the optional producer: dedicated GET-only
`/api/integrations/track/v1/{capabilities,executions,...}` with an expiring,
revisioned reader bound to the current configured Entra work owner. Its own
credential is loaded from a private file, and checked again before each result
is returned. Existing UI proxy/session/CSRF checks remain on their routes.
Native coordinator reads must revalidate its frozen instruction, role membership,
runtime context and result proof; a withdrawn context is withheld from this API.
The list uses an owner-scoped stable row-id high-water cursor, HMAC bound to the
reader revision, a short expiry, and a response-size bound. It does not dispatch,
cancel, reconcile, publish a result, migrate a database or start background work.

Operational audit found the public Assistant in its separate rootless Docker
engine, not the rootful OAuth enrollment helper. Current image is
`sha256:ccdb8c9b7337cd46005472a0bd23c1620b7a87d68e49ea7eba642e7efbbddcf0`;
its base revision label is `b6070571e480bd7e342ca3a1f50dc79b0f190449`.
The deployment owner confirmed a full tracked-source build with no `/app` code
bind overlay. Reporting/gateway behavior and private state must be preserved.
Actual installed `main.js`, `api.js` and `workbench/executions.js` hashes match
a fresh clean build of `ce066eb`, which differs from the deployed source by docs. A
container name or base label alone is not treated as proof of the whole source.

Native source wiring is implemented in private [Persona PR21](https://github.com/pydemia/persona/pull/21),
head `5196c8bc9233da493c4146fec17b98e1c835dadc`. Dedicated HTTP auth and
owner-before-limit SQLite reads are tested. Strict runtime observation uses
`observe()` without lifecycle revalidation; the ordinary getter can terminate
an unrelated expired or revoked live Task and is not used for this reader.
Real Tasks/query-only database checks cover that side effect, current proof and
document snapshots. Full native suite:885passed/899total,0failed,14environment
skips. Source implementation is not deployment, native credential provisioning,
Track adapter/Projects-grant intersection or actual cross-app completion.

## Native artifact metadata implementation

Track now provides authenticated `GET /api/runs/:runKey/artifacts`. It rechecks
current Track user/source/Run grants around a fresh native Run/Session read and
artifact lookup. The adapter validates version1 manifests, retains only exact
Run/session matches that are not revoked, and exports filename/media/size/hash/
representation/time. Organization/owner IDs, content bytes, summary text and
reference URI are omitted. The native content endpoint is never requested.
A recent100 list remains explicitly incomplete even when it returns fewer items.
Native403/404 hides the artifact result independently from the Run snapshot.
The actual dedicated native Run has one `answer.txt` manifest; API metadata and
public Trail were compared. Revoked/foreign Run and mid-request Track revocation
were checked with fixtures. Evidence is queried on demand, not persisted in the
event journal or synthesized as a source-sequence event.

## Projects reader implementation (2026-11-11)

The deployed Projects image is pydemia-projects:story-b313610cb90a73bc. Its native
read API at /api/integrations/assistant/v1 now has a separate Track principal
with only projects:read and tasks:read. Existing Assistant keys/principals are
not reused. The current owner-bound account has7 authorized projects/26tasks;
Track refreshes capabilities and exact native Project scope before publishing
metadata, and rechecks after awaited task reads. Other Track actors cannot
borrow that credential. This is a single-owner deployment, not delegated
multi-user native authentication.

GET tokens sign the full raw path including the integration prefix and query,
empty-body SHA256, method, native account-bound principal/revision, nonce and
30second lifetime. Native Project.version differs from Task.revision; missing
requires_test defaults to true. Task title/body ownership remains with Projects.
Track retains minimal title/ID/revision/state metadata only; native response
bodies are transiently decoded and discarded. No native business writes occur.

Track exposes /api/projects/catalog and /api/projects/:sourceId/:projectId/tasks
with native opaque cursor/as_of paging. This is live read support. Explicit
Run binding workflows, native execution references, assignment/acceptance and
embedded context summaries were unimplemented at this baseline. The actual dedicated-reader
scope reduction and restoration are recorded in projects-live-verification.json.

## Explicit Track binding implementation

The Run detail now explicitly selects an existing native Task and its observed
revision. POST /api/bindings is restricted to the current single Entra owner,
checks native Run/session identity and current Task/Project access, and records
only the server-derived metadata. It appends Track history, current binding and
actor/request receipt in one SQLite transaction with an expected binding version.
Native business state is unchanged. Task edits racing after a GET cannot be
atomically conditioned across two services; the record preserves the observed
revision, not a native mutation receipt. Native assignment/start remains separate.

Historical records are filtered against current Project scope. The exact request
UUID replays its original receipt even after a later binding, provided current
source/Task/Project access remains valid. Unsupported source commands are not
introduced by binding. Actual QA evidence is native-binding-verification.json.

## Native permission review and decisions

Track now reads native GET /api/v1/runs/:id/permissions and sends decisions only
to POST /api/v1/runs/:id/permissions/:permissionId/decision. The native decision
transaction conditions on pending/unexpired state and applies its own actor/Run
checks. allow_session grants the same tool in that Session, not arbitrary tools
or other Sessions. Track metadata listing excludes arguments; explicit owner
review is a fresh, bounded, no-store response containing the tool input/reason.
This opt-in review is separate from default metadata collection. Arguments and
provider identity are never journaled or put in decision receipts.

The approval fingerprint pins request/Run/call/tool/input/reason/actor/expiry.
Current owner opt-in and Run/Project grants are rechecked around source I/O.
Client deadlines are bounded to120seconds; native expiry still controls final
acceptance. Unknown outcomes and restart recovery never resend. Read-only
reconciliation labels source observations with unknown attribution. An already
resolved native request cannot show active approval controls from a stale list.

Actual QA covered allow_once and two fileChange calls after one allow_session
request, public UI deny, natural native expiry without a Track decision, rejected
late decisions, Project-scope revocation/restoration and mobile review cleanup.
Native-approval verification files record these separately from fixture evidence.
The original builtin write_file attempt had no such tool in codex-native; it
was not counted as an approval. Native editor fileChange supplied the actual
approval bridge. Its current feed does not emit a separate file.diff event.

## On-demand file evidence

GET /api/runs/:key/files replays native events only through the currently journaled
high water. It validates native Run/session access before and after replay and
refreshes current Project scope before publication. The old normalized journal
payload/digests/cursors are unchanged; paths are a separate read projection.

The exact codex-app-server/fileChange tool.requested contains input.changes
paths/kind; matching tool.completed supplies ok. Only an earlier unique request
plus a successful exact call/invocation completion reports a change. Unfinished,
failed, reused or conflicting evidence remains pending/failed/ambiguous. Direct
workspace.diff.updated paths are also accepted; arbitrary tool output is not.
Patch text, previews, input/output and native provider IDs are never exported or
persisted. FileSignal keeps only safe metadata and an internal evidence digest.

Replay is bounded to2000events/8MiB,100paths per proposal and500display rows;
gaps, premature EOF and display omissions remain incomplete. This is evidence
through the selected observation window, not a filesystem diff or a claim about
the current final file contents. Current native fileChange lacks a standalone
diff event; an indexed/paged producer contract can replace bounded replay later.
Actual success/denial/expiry, file bytes/hashes, immutable-journal preservation
and public UI/Project revocation checks are in native-files-verification.json.
## Native Task creation (AT-11, owner QA scope enabled)

The Projects reader remains read-only. `ProjectsTaskWriter` is a separate client
requiring a dedicated owner/account/principal credential and the exact
projectsRead/tasksRead/tasksCreate capability profile. tasksUpdate/resultsAttach
are rejected. Its fixed task POST signs the exact serialized body; operation GET
checks the original operation, Project, POST path and request body digest. Creation
also checks the producer's canonical operation hash. Responses are bounded to1MiB
and only Task metadata leaves the adapter. Drafts are capped at8KiB UTF-8, body5000
characters, criteria20×500; the local expiry guard runs after credential/capability
awaits immediately before dispatch.

`TaskCreationService` keeps actor/UUID/source/Project, pinned writer identity,
request digests and native Task ID/revision in `task_creation_receipts`. It keeps
no title, body, criteria or source error. A SQLite transaction elects one dispatcher;
one unresolved create per actor/Project blocks a second UUID. Exact replay returns
its existing receipt. Transport/malformed success remains unknown, never resent.
Operation lookup reconciles with a fresh grant for the exact stored source/Project;
late reads cannot overwrite terminal receipts. Interrupted dispatches recover as
unknown. Created confirms native Task creation, not runtime acceptance or business
approval. The owner-only BFF exposes POST `/api/projects/task-creation` and GET
`/api/projects/:source/:project/task-creation`. Startup recovers interrupted
receipts. Mutation Origin, current owner, reader grant and the separate creator
principal are checked; a synchronous guard after credential awaits rejects local
authority changes before POST. Responses recheck access after native acceptance.
The UI preserves draft and operation ID on an unknown response and never retries
the mutation automatically. Aborted/unmounted views ignore late replies, and
terminal receipt states absorb delayed reads. Receipt history is the most recent100
records for the current actor/Project; reconciliation failure is separately marked
incomplete. The currently provisioned creator covers only the named Test QA Project;
other reader Projects remain read-only. Actual native Task creation and public UI
were checked; runtime assignment remains pending.
