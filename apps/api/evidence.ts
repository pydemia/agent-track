import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { ArtifactEvidence, Snapshot } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";

export async function artifactEvidence(config: () => Config, snapshot: (user: string) => Snapshot, user: string, runKey: string,
  refreshGrants: () => Promise<void> = async () => {}): Promise<ArtifactEvidence> {
  const authorized = () => {
    const current = config();
    if (current.auth.mode === "proxy" ? !current.auth.users.includes(user) : current.auth.user !== user) {
      throw new CommandError(403, "source_forbidden", "Current access is unavailable.");
    }
    const run = snapshot(user).runs.find((item) => item.key === runKey);
    const source = current.sources.find((item) => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw new CommandError(404, "run_not_found", "Run not found.");
    return { run, source };
  };
  const { run, source } = authorized();
  const empty = (state: ArtifactEvidence["state"], detail: string): ArtifactEvidence => ({
    state, runKey, observedAt: new Date().toISOString(), detail, artifacts: [], scanned: 0, limit: 100, complete: false,
  });
  if (source.kind !== "demian" || !source.baseUrl) return empty("unsupported", "이 출처의 산출물 metadata 조회는 지원하지 않습니다.");
  if (run.sourceState !== "connected") return empty("disconnected", "원본 연결을 확인한 후 산출물을 다시 조회합니다.");
  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  try {
    const observed = await client.observe(run.runId);
    if (observed.sessionId !== run.sessionId) throw new SourceError(403);
    const page = await client.artifacts(run.runId, run.sessionId);
    await refreshGrants();
    const current = authorized();
    if (current.source.baseUrl !== source.baseUrl || current.source.organizationId !== source.organizationId || current.run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "Source changed during evidence lookup.");
    }
    return { ...page, state: "connected", runKey, observedAt: new Date().toISOString(),
      detail: "원본 세션의 최근100개 목록에서 이 Run의 미철회 산출물만 조회했습니다. 전체 과거 이력을 보장하지 않습니다." };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    await refreshGrants();
    authorized();
    if (error instanceof SourceError && [401, 403, 404].includes(error.status)) {
      return empty("forbidden", "원본 산출물 접근이 거부됐거나 대상을 확인할 수 없습니다. 저장된 산출물을 표시하지 않습니다.");
    }
    return empty("disconnected", "산출물 metadata를 확인하지 못했습니다. 빈 결과를 산출물 없음으로 해석하지 마세요.");
  }
}
