import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { DemianRunWriter } from "../../packages/adapters/demian/assignment.ts";
import { DemianOrchestrationReader, type OrchestrationSupport } from "../../packages/adapters/demian/orchestration.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";

export interface OrchestrationEvidence {
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  runKey: string;
  support: OrchestrationSupport | null;
  sessionMode: "single-agent" | "multi-agent" | null;
  observedAt: string;
  detail: string;
}

/** Global worker flags are declarations, never proof of callable child targets. */
export async function orchestrationEvidence(config: () => Config, snapshot: (user: string) => Snapshot,
  user: string, key: string, refreshGrants: () => Promise<void>): Promise<OrchestrationEvidence> {
  const authorized = () => {
    const current = config();
    const root = current.auth.mode === "proxy" ? current.auth.users.includes(user) : current.auth.user === user;
    const view = snapshot(user); const run = view.runs.find((item) => item.key === key);
    const source = current.sources.find((item) => item.id === run?.sourceId && item.users.includes(user));
    const project = run?.binding && view.sources.find((item) => item.id === run.binding!.projectSourceId && item.kind === "projects");
    if (!root || !run || !source || (run.binding && (project?.state !== "connected" || !project.authorizedProjectIds?.includes(run.binding.projectId)))) {
      throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    }
    return { run, source, stamp: sourceIdentity(source) };
  };
  await refreshGrants(); const { run, source, stamp } = authorized();
  const empty = (state: OrchestrationEvidence["state"], detail: string): OrchestrationEvidence => ({
    state, runKey: key, support: null, sessionMode: null, observedAt: new Date().toISOString(), detail,
  });
  if (source.kind !== "demian" || !source.baseUrl) return empty("unsupported", "이 출처의 실행 조직화 계약 조회는 지원하지 않습니다.");
  if (run.sourceState !== "connected") return empty("disconnected", "현재 원본 연결을 확인한 뒤 실행 조직화 지원을 조회합니다.");
  const options = { sourceId: source.id, baseUrl: source.baseUrl,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) };
  const client = new DemianClient(options); const sessionReader = new DemianRunWriter(options);
  try {
    const before = await client.observe(run.runId);
    if (before.sessionId !== run.sessionId || before.workspaceId !== run.workspaceId) throw new SourceError(403);
    const session = await sessionReader.session(run.sessionId);
    const support = await new DemianOrchestrationReader(options).read(session.provider);
    const confirmed = await client.observe(run.runId); const currentSession = await sessionReader.session(run.sessionId);
    if (confirmed.sessionId !== run.sessionId || confirmed.workspaceId !== run.workspaceId || currentSession.provider !== session.provider ||
      currentSession.workspaceId !== run.workspaceId || currentSession.mode !== session.mode || currentSession.permissionPolicy !== session.permissionPolicy) throw new SourceError(403);
    await refreshGrants(); const current = authorized();
    if (current.stamp !== stamp || current.run.sessionId !== run.sessionId || current.run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "조직화 지원 조회 중 원본 접근이 변경됐습니다.");
    }
    return { state: "connected", runKey: key, support, sessionMode: session.mode, observedAt: new Date().toISOString(),
      detail: "전역 기능 선언과 선택한 provider의 실행 방식입니다. 실제 하위 실행 대상·위임·협업 관계의 존재나 준비 상태를 보장하지 않습니다." };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    await refreshGrants(); authorized();
    return error instanceof SourceError && [401, 403, 404].includes(error.status)
      ? empty("forbidden", "현재 원본 조직화 지원에 접근할 수 없습니다.")
      : empty("disconnected", "실행 조직화 지원을 확인하지 못했습니다. 관계 없음으로 해석하지 마세요.");
  }
}
