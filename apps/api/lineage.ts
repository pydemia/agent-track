import { DemianClient, SourceError, type NativeLineageObservation } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { canonicalLineageCursor } from "../../packages/adapters/demian/lineage.ts";
import { sourceIdentity } from "./source-identity.ts";

export interface LineageEvidence {
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  runKey: string;
  observations: NativeLineageObservation[];
  nextCursor: string;
  hasMore: boolean;
  observedAt: string;
  detail: string;
}

export async function lineageEvidence(
  config: () => Config,
  snapshot: (user: string) => Snapshot,
  user: string,
  key: string,
  refreshGrants: () => Promise<void>,
  after = "0",
): Promise<LineageEvidence> {
  canonicalLineageCursor(after);
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
  const empty = (state: LineageEvidence["state"], detail: string): LineageEvidence => ({
    state, runKey: key, observations: [], nextCursor: after, hasMore: false,
    observedAt: new Date().toISOString(), detail,
  });
  if (source.kind !== "demian" || !source.baseUrl) {
    return empty("unsupported", "이 출처의 native lineage 조회는 지원하지 않습니다.");
  }
  if (run.sourceState !== "connected") {
    return empty("disconnected", "원본 연결을 확인한 뒤 lineage를 조회합니다.");
  }

  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  try {
    const before = await client.observe(run.runId);
    if (before.runId !== run.runId || before.sessionId !== run.sessionId) throw new SourceError(403);
    const page = await client.lineage(run.runId, after, 250);
    if (page.sessionId !== run.sessionId) throw new SourceError(403);
    const confirmed = await client.observe(run.runId);
    if (confirmed.runId !== run.runId || confirmed.sessionId !== run.sessionId) throw new SourceError(403);

    await refreshGrants();
    const current = authorized();
    if (current.sourceStamp !== sourceStamp || current.source.baseUrl !== source.baseUrl ||
        current.source.organizationId !== source.organizationId || current.run.sessionId !== run.sessionId ||
        current.run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "원본 접근이 lineage 조회 중 변경됐습니다.");
    }
    return { state: "connected", runKey: key, observations: page.observations,
      nextCursor: page.nextCursor, hasMore: page.hasMore, observedAt: new Date().toISOString(),
      detail: "현재 접근이 확인된 Demian 실행의 native lineage metadata입니다. 메시지 본문과 도구 인수는 포함하지 않습니다." };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    await refreshGrants();
    authorized();
    if (error instanceof SourceError && [401, 403, 404].includes(error.status)) {
      return empty("forbidden", "현재 원본 lineage에 접근할 수 없습니다. 저장된 근거는 표시하지 않습니다.");
    }
    return empty("disconnected", "원본 lineage를 확인하지 못했습니다. 빈 결과를 lineage 없음으로 해석하지 마세요.");
  }
}
