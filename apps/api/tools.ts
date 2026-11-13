import { DemianClient, SourceError, type ToolEvidencePage } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";

export interface ToolEvidence extends ToolEvidencePage {
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  runKey: string;
  observedAt: string;
  detail: string;
}

export async function toolEvidence(
  config: () => Config,
  snapshot: (user: string) => Snapshot,
  user: string,
  key: string,
  refreshGrants: () => Promise<void>,
  includeModels = false,
): Promise<ToolEvidence> {
  const authorized = () => {
    const current = config();
    const root = current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user;
    if (!root) throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    const view = snapshot(user);
    const run = view.runs.find((item) => item.key === key);
    const source = current.sources.find((item) => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    const projectSource = run.binding && view.sources.find((item) =>
      item.id === run.binding!.projectSourceId && item.kind === "projects");
    if (run.binding && (projectSource?.state !== "connected" ||
        !projectSource.authorizedProjectIds?.includes(run.binding.projectId))) {
      throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    }
    return { run, source, sourceStamp: sourceIdentity(source) };
  };

  await refreshGrants();
  const { run, source, sourceStamp } = authorized();
  const empty = (state: ToolEvidence["state"], detail: string): ToolEvidence => ({
    state, runKey: key, calls: [], scanned: 0, limit: 2000, targetSequence: run.highWater, throughSequence: "0",
    targetReached: false, gaps: false, truncated: false, omittedCalls: 0, unidentifiedEvents: 0, complete: false,
    observedAt: new Date().toISOString(), detail,
    ...(includeModels ? { modelRequestCoverage: "native-model-lifecycle" as const, modelRequests: [], unidentifiedModelEvents: 0, omittedModelRequests: 0 } : {}),
  });
  if (source.kind !== "demian" || !source.baseUrl || source.assistantNativeSourceId) {
    return empty("unsupported", "이 출처의 도구 실행 근거 조회는 지원하지 않습니다.");
  }
  if (run.sourceState !== "connected") {
    return empty("disconnected", "원본 연결을 확인한 뒤 도구 실행 근거를 조회합니다.");
  }

  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  try {
    const before = await client.observe(run.runId);
    if (before.runId !== run.runId || before.sessionId !== run.sessionId) throw new SourceError(403);
    const page = await client.toolEvidence(run.runId, run.highWater, includeModels);
    const confirmed = await client.observe(run.runId);
    if (confirmed.runId !== run.runId || confirmed.sessionId !== run.sessionId) throw new SourceError(403);

    await refreshGrants();
    const current = authorized();
    if (current.sourceStamp !== sourceStamp || current.source.baseUrl !== source.baseUrl ||
        current.source.organizationId !== source.organizationId || current.run.sessionId !== run.sessionId ||
        current.run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "원본 접근이 도구 실행 근거 조회 중 변경됐습니다.");
    }
    return { ...page, state: "connected", runKey: key, observedAt: new Date().toISOString(),
      detail: "원본 요청·실행 시작·종료와 결과 metadata입니다. 요청을 시작으로, 완료 보고를 성공으로 간주하지 않습니다. 인수·출력은 포함하지 않습니다." };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    await refreshGrants();
    authorized();
    if (error instanceof SourceError && [401, 403, 404].includes(error.status)) {
      return empty("forbidden", "현재 원본 도구 실행 근거에 접근할 수 없습니다. 저장된 근거는 표시하지 않습니다.");
    }
    return empty("disconnected", "원본 도구 실행 근거를 확인하지 못했습니다. 빈 결과를 도구 실행 근거 없음으로 해석하지 마세요.");
  }
}
