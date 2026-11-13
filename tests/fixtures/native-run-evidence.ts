import type { NativeRunEvidencePage } from "../../packages/contracts/native-run-evidence.ts";

export const evidenceRunId = "11111111-1111-4111-8111-111111111111";
export const evidenceOtherId = "22222222-2222-4222-8222-222222222222";
export const evidenceStart = "2026-11-14T00:00:01.000Z";
export function nativeEvidenceFixture(after = "0", limit = 100): NativeRunEvidencePage {
  const usage = [
    { scope: "latest-model-request" as const, coverage: "partial" as const, source: "codex-app-server.tokenUsage.last", invocationId: evidenceRunId,
      usage: { inputTokens: 3014, outputTokens: 186, totalTokens: 3200, cachedInputTokens: 0, reasoningOutputTokens: 0 } },
    { scope: "native-session" as const, coverage: "unknown" as const, source: "codex-app-server.tokenUsage.total", invocationId: evidenceRunId,
      usage: { inputTokens: 3014, outputTokens: 186, totalTokens: 3200 } },
  ];
  const types = ["response.created", "run.started", "run.prepared.selected", "external.lineage.observed",
    "external.lineage.observed", "response.usage", "response.usage", "response.completed"];
  const records: NativeRunEvidencePage["events"]["data"] = types.map((type, index) => ({
    runId: evidenceRunId, sequence: String(index + 1), type, occurredAt: evidenceStart,
    selectedModel: index === 2 ? "gpt-6.1-sol" : null,
    usageObservations: type === "response.usage" ? structuredClone(usage) : [],
    lineage: type === "external.lineage.observed" ? { attempt: 1, executor: "codex-app-server", provider: "codex-native",
      phase: index === 3 ? "turn_started" : "message_completed", nativeThreadKey: "1".repeat(64), nativeTurnKey: "2".repeat(64),
      nativeItemKey: index === 3 ? null : "3".repeat(64), invocationId: evidenceRunId } : null,
    issues: [],
  }));
  const selected = records.filter(record => BigInt(record.sequence) > BigInt(after)).slice(0, limit);
  return {
    version: 1, object: "demian.work_runtime.evidence_page", api_version: "2026-09-01", observedAt: "2026-11-14T00:00:03.000Z",
    run: { id: evidenceRunId, organization_id: evidenceOtherId, workspace_id: evidenceOtherId, session_id: evidenceOtherId,
      acting_user_id: evidenceOtherId, service_principal_id: evidenceOtherId, status: "succeeded", created_at: "2026-11-14T00:00:00.000Z",
      started_at: evidenceStart, completed_at: "2026-11-14T00:00:02.000Z", correlation_id: "operation-evidence",
      binding_sha256: "b".repeat(64), context_sha256: "c".repeat(64), request_sha256: "d".repeat(64) },
    events: { after, through_sequence: "8", next_after: selected.at(-1)?.sequence ?? after, limit,
      has_more: BigInt(selected.at(-1)?.sequence ?? after) < 8n, data: selected },
    timings: [{ kind: "queue", source: "runs.created_at-to-started_at", startedAt: "2026-11-14T00:00:00.000Z", endedAt: evidenceStart },
      { kind: "wall", source: "runs.started_at-to-completed_at", startedAt: evidenceStart, endedAt: "2026-11-14T00:00:02.000Z" }],
    artifactState: "available", artifacts: [{ id: evidenceOtherId, sourceRunId: evidenceRunId, sha256: "4".repeat(64),
      filename: "answer.txt", mediaType: "text/plain", sizeBytes: 746, createdAt: "2026-11-14T00:00:02.000Z", bytesVerified: true }],
  };
}
