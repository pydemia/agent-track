# Assistant metadata reader client

`packages/adapters/assistant/index.ts` consumes the optional native reader at
`/api/integrations/track/v1`. The native implementation is in private Persona PR21.
Track now includes optional source configuration, live authority/API wiring and a
distinct WorkExecution UI. Code availability does not activate the source: the
production reader/configuration and cross-app verification are separate steps.
The current owner source was activated on 2026-11-12 and verified through normal
Entra UI login; see `assistant-live-verification.json`.

## Identity and authentication

The client requires an absolute credential-file path and an exact configured
source ID, Track user, immutable native owner ID, principal ID and canonical
origin. The credential document contains these fields:

| Field | Meaning |
| --- | --- |
| `version`, `audience` | `1`, `agent-track` |
| `sourceId`, `user` | Exact Track source and authorized actor |
| `ownerId` | Native immutable `sso-sub:` SHA-256 identity; not an email lookup |
| `principalId` | Dedicated reader principal |
| `revision` | Positive safe integer, matching native capabilities |
| `notBefore`, `expiresAt` | Explicit validity window |
| `nativeOrigin` | Exact canonical HTTPS origin or HTTP loopback origin |
| `secretFile` | Absolute path to a separate base64url reader key |

The secret is sent only as Bearer authentication with
`X-Agent-Track-Principal`. This service credential is separate from Entra browser
login, native UI sessions, Projects keys and the Track proxy key. Default user
login remains Entra ID. Credential creation and distribution are operational
steps, not performed by this library.

Every data read checks native capabilities before and after the response. Owner,
principal and grant revision must match. Bounded configuration and key reads are
repeated throughout the request; changes, expiry or revocation prevent return.
Configuration and key files are limited to 16 KiB and 4 KiB. Response bodies are
limited to 1 MiB, and each HTTP request has a ten-second deadline. Redirects are
not followed, cookies are omitted, and transport/body errors are replaced with a
static error and bounded status code.

## Data semantics

- `capabilities()` reads the dedicated reader contract.
- `executions(cursor?)` reads at most 50 native WorkExecutions per page, using the
  producer's opaque continuation. A page is explicitly not a complete history.
- `execution(id)` reads one exact WorkExecution and its native role assignments.
- `events(id, after?)` reads at most 100 ordered execution-state events. Its decimal
  cursor is an Assistant safe integer, separate from Demian int64 event cursors.

WorkExecution, role assignment and runtime Task/thread/turn references retain
their native identities. They are not projected into Demian Runs. The native
contract reports `demianReferencesSupported: false` and `controls: false`.
Execution completion is not Projects Task acceptance. Cross-app task projection
must intersect these references with a fresh current Projects grant before
exposing the task or its grouping in Track.

## Verification and remaining integration

The client suite covers strict identity/origin binding, file growth and rotation,
capability changes, late transport/body responses, bounded metadata, exact detail
scope and event continuations. A real loopback HTTP suite exercises the canonical
producer with the built-in fetch transport: list/detail/events, post-read native
revocation, and redirect refusal without credential forwarding. These HTTP tests
use a fixture port, not a production native database or credential.

Native per-database encrypted snapshots, SQLite restoration and Windows DPAPI
owner verification are recorded separately in
`assistant-native-recovery-verification.json`; they are not an atomic cross-DB
snapshot or frozen cutover baseline.

The Assistant integration Root owns native container/guard changes and has
provisioned the dedicated credential. Track owns its client configuration and
private loopback transport. No key or native owner credential is sent to the
browser. Production activation followed the Root's native-ready evidence; native read,
current Projects intersection, UI groups and a Track restart were then verified.

Remaining: the full Assistant/Demian/desktop cross-app task and second-device
organization. The actual Assistant/Projects/Track metadata path is connected. Refer to
`assistant-native-reader-verification.json` and `goal-status.md`. AT-14 remains
partial; this client does not change the overall 14/21 acceptance count.

## Live Track API and UI

Optional Assistant source fields are `assistantCredentialFile`, `assistantUser`,
`assistantOwnerId`, `assistantPrincipalId` and `assistantProjectsSourceId`. The
first four are an all-or-none identity binding; a Projects peer must be fully
configured for the same actor. Existing unconfigured sources remain unsupported.
Durable source pins include actor/owner/principal/peer identity, while request
checks additionally detect credential-path or policy changes.

The Entra-authenticated BFF exposes GET-only routes:

- `/api/assistant/:sourceId/executions?cursor=...`
- `/api/assistant/:sourceId/executions/:executionId`
- `/api/assistant/:sourceId/executions/:executionId/events?after=...`

Every response checks native capabilities and current Projects authorization
before and after reading metadata. Linked Task UUID and Project UUID must match
the current native Task response. A denied Task is omitted from list windows;
detail/events fail closed. Transport failure returns unavailable, without stale
execution metadata. Executions/events are not persisted in the Run journal.
One active read plus one waiting read is allowed per actor/source, with an
overall ten-second budget including queue time. Lists read up to eight distinct
Tasks concurrently within this budget; late responses cannot reopen a grant.

The browser polls every fifteen seconds, reads at most four 50-execution pages per
source, and clears the source window on denial or failed refresh. Trail and Trace
keep at most 500 state events with the cursor of the retained event. Native Task
revision/state at execution time and current Projects state remain separate.

Map joins current Task keys to explicit native WorkExecution/role references.
Project/Task/execution/work-package groups reuse the existing Pydemia FlowCanvas;
shared thread/turn/runtime references remain outside exclusive execution groups.
Collapsing a group preserves typed boundary edges and individual evidence. No
chronological edge, Demian Run conversion or runtime status is inferred.
