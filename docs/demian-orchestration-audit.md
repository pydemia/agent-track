# Demian orchestration evidence audit

**Date:** 2026-11-12
**Scope:** Read-only review of the configured Demian producer, its installed API, and Agent Track's local SQLite journal. No run/session messages, prompts, tool arguments, or output text were retained here.

## Findings from the observed run

The configured `demian-local` source points to the local Demian API. The known run `d8131c91-8d67-457e-8b95-99bc6c8bfef3` returned `succeeded` in session `1712e0a3-8f52-48e6-9fa3-73d7075f2149`. A bounded replay of `GET /api/v1/runs/{runId}/events?after=0` ended at the terminal event after **212 events / 65,976 bytes**. The local Track database has the same run at cursor/high-water **212/212**, with 212 normalized events.

`GET /api/v1/runs/{runId}/lineage?after=0&limit=250` returned **9 observations**, `has_more=false`, through sequence `208`. All records were attempt 1, executor `codex-app-server`, provider `codex-native`, native thread `01a1c82c-e2c4-7981-ab56-2fda94e3576d`, native turn `01a1c82c-f156-7ed3-bd3a-053e34ee5bb2`, invocation `inv_mwbfgpl0_8yxkh1ac`. Phases: one `turn_started`, three `tool_started`, three `tool_completed`, and two `message_completed`.

The producer provides concrete tool-to-native-item joins in this run. Each `native_item_id` below exactly equals the `callId` on the corresponding Track-normalized tool events:

| Native lineage item | Lineage sequence(s) | Run event sequence(s) | Observed relation |
|---|---:|---:|---|
| `exec-5e94dfe8-d2f7-461a-9785-ac8d6d7a97c0` | 7 started, 11 completed | 8 requested, 12 completed | Same `inv_mwbfgpl0_8yxkh1ac` invocation |
| `exec-c8dd8fbe-fa66-4e40-8e78-69b6bfa50433` | 14 started, 16 completed | 15 requested, 17 completed | Same invocation |
| `exec-273901f5-5f83-489b-b6ac-fde184faf209` | 67 started, 70 completed | 68 requested, 71 completed | Same invocation |

The events replay contained no `goal.*`, `agent.invocation.*`, `cowork.*`, managed-child, or peer event types. It did contain three `tool.requested`, three `tool.completed`, one `permission.requested`, and one `permission.resolved`. Therefore the observed evidence supports a run → invocation ID → three tool calls → native thread/turn/item chain. It does **not** establish a goal/task dependency graph, child-agent hierarchy, or cross-session peer edge.

For the observed types, the native event `data` key sets and Track's stored normalized key sets differ as follows (keys only; values are intentionally excluded):

| Event type | Native keys | Track keys |
|---|---|---|
| `tool.requested` | `agent, agentPath, callId, executor, input, invocationId, name, qualifiedName, rootSessionId, sessionId` | `callId, invocationId, redacted, tool` |
| `tool.completed` | `agent, agentPath, callId, executor, invocationId, name, ok, preview, qualifiedName, rootSessionId, sessionId` | `callId, invocationId, redacted, tool` |
| `external.lineage.observed` | *(empty; intentionally redacted by the API)* | `redacted` |
| `permission.requested` | `actor, call_id, expires_at, input, permission_id, reason, tool` | `callId, expiresAt, permissionId, redacted, tool` |
| `permission.resolved` | `decision, permission_id` | `permissionId, redacted` |

The native stream also had response/session/usage and text-delta event types; Track preserved those types with redaction and selected status metadata. There were no native goal/cowork/invocation event rows to compare key-for-key in this run.

## Why the previous Trace lost the relationship (6216430 baseline)

- Demian's SSE deliberately sends `external.lineage.observed` with an empty `data` object. The separately authorized lineage route has the actual IDs, phases, attempt, and sequence. Track's Demian adapter does not call that route; it normalizes the SSE lineage event to `{ redacted: true }`. In the local journal, all nine lineage rows contain only that redaction marker.
- For tool events, the adapter retains `callId`, `invocationId`, and a safe tool name. This is enough to group the three completions under an invocation **identifier**, but not to create an invocation step: this run contains no `agent.invocation.started/completed/failed` rows. The Trace projection creates invocation steps only from those lifecycle event types. It recognizes `tool.started` as a start; this producer emitted `tool.requested`, so the current projection has no tool start timestamp. The three completed tools are consequently unassigned, partial trace rows rather than a native invocation timeline.
- The adapter's alias allowlist covers invocation, cowork, tool, permission, and workspace-diff events. It does not retain goal/task identifiers, `rootSessionId`, or native lineage fields. Its extraction condition also excludes `managed_child.*` and `peer.*`, so those event payloads cannot currently carry IDs into Track. Unknown event types may remain as redacted type-only events.
- Track's relation projection can materialize invocation/cowork, managed-child, peer, and artifact relations only when the normalized event has the corresponding IDs. For this Demian adapter, managed-child/peer IDs are not extracted, and native lineage/tool ordering is not used to create edges. No dependency edge is inferred from chronology.

The baseline above is the state inspected before this patch. Track now reads the separately authorized lineage and bounded tool metadata routes through its BFF; `native-flow-verification.json` records 9 lineage rows, 3 exact item joins, 2 successful tool reports and 1 failure, with the 212-row immutable journal unchanged. Goal/cowork/managed-child/peer and task dependency integration remain pending.

## Implemented read contracts and observed availability

| Evidence | Read route / contract | Audit result and limit |
|---|---|---|
| Run events | `GET /api/v1/runs/{runId}/events?after={sequence}` | SSE replay; terminal run drained at 212 events. The route intentionally blanks `external.lineage.observed` payloads. This audit stopped at terminal and below 2,000 events / 8 MiB. |
| Native lineage | `GET /api/v1/runs/{runId}/lineage?after={sequence}&limit={1..250}` | Read-only, reauthorizes around paging, returns `observations`, message IDs/sequences, `next_cursor`, and `has_more`. This is specific to authorized Codex App Server lineage; message bodies are not returned. One page was sufficient for this run. |
| Managed-child receipt | `GET /api/v1/sessions/{sessionId}/managed-children/{operationId}` | Returns a scoped receipt with session/run, agent, operation ID, parent/child invocation IDs, and run status. Requires an already-known operation ID; no receipt was fetched. `GET .../managed-child-targets` was not called because its implementation refreshes deployment state before listing. |
| Goal / cowork / invocation | Run event types emitted by the worker mapper | The worker maps `goal.*`, `agent.invocation.*`, and `cowork.*` events when emitted. There is no separate goal-history read route in the inspected API. None appeared in the observed run. |
| Linked peer | `GET /api/v1/peer-connections`; `GET /api/v1/peer-connections/{connectionId}/conversations`; known conversation detail at `/conversations/{conversationId}` | Code supports configured connection descriptors and saved linked conversations. No peer list/detail was queried. Do not use `/directory` as a passive read: its implementation requires update authorization and comments that first discovery registers a daemon sender. |
| Peer-processing receipt | `GET /api/v1/peer-connections/{connectionId}/conversations/{conversationId}/processing/{operationId}` | Receipt is keyed by an existing operation and rechecks target-session/run authorization. No operation ID was discovered or queried. A receipt is delivery/processing evidence, not proof of accepted work or successful completion. |
| Device/platform metadata | `GET /api/v1/device-connections?workspaceId={workspaceId}&cursor={connectionId}` | Scoped read route exists, but the installed API returned `configured=false` and an empty list. No device platform was available. `codex-native` and `codex-app-server` identify provider/executor; they do not prove Windows/macOS/Linux. |

## Implementation direction for the mission graph

1. Join the authorized lineage page to normalized run events by exact `native_item_id == callId`, preserving both source sequences and attempt. Render the observed invocation ID and native thread/turn/item identities as evidence-backed nodes; expose lineage paging state. Do not infer host OS or a parent invocation where none is present.
2. Keep goal, cowork, managed-child, peer, and native-run evidence as separate typed relationships. Create edges only from explicit IDs/receipts and show their source and status. For managed-child and peer receipts, request them only after the UI has a concrete authorized operation ID; do not enumerate target directories as a substitute.
3. If task dependencies are needed, add an explicit producer contract carrying stable task/goal IDs and dependency IDs. Current goal event names and prose/status payloads alone do not establish dependency edges.

## Source references

- Track adapter, event normalization and bounded SSE client: `packages/adapters/demian/index.ts`.
- Track trace lifecycle matching: `packages/projection/trace.ts`.
- Track event-derived relations and local cursor/high-water: `packages/storage/store.ts`.
- Demian event stream and lineage route: `apps/api/src/server.ts`, `apps/api/src/native-lineage.ts`, `packages/db/src/native-lineage.ts`.
- Managed-child receipts: `apps/api/src/managed-children.ts`, `packages/db/src/managed-children.ts`.
- Peer links and processing receipts: `apps/api/src/peer-conversations.ts`, `apps/api/src/peer-processing.ts`.
- Device metadata: `apps/api/src/device-connections.ts`; event producer mapping: `apps/worker/src/events.ts`.
