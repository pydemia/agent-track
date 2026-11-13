import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { FileChangeEvidence, Snapshot } from "../../packages/contracts/index.ts";
import type { Config } from "./config.ts";

export async function fileEvidence(config: () => Config, snapshot: (user: string) => Snapshot, user: string, key: string,
  refreshGrants: () => Promise<void>): Promise<FileChangeEvidence> {
  const authorized = () => {
    const configNow = config();
    const root = configNow.auth.mode === "proxy" ? configNow.auth.users.includes(user) : configNow.auth.user === user;
    const run = root ? snapshot(user).runs.find((item) => item.key === key) : undefined;
    const source = configNow.sources.find((item) => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    return { run, source };
  };
  await refreshGrants();
  const { run, source } = authorized();
  const empty = (state: FileChangeEvidence["state"], detail: string): FileChangeEvidence => ({ state, runKey: key,
    changes: [], scanned: 0, limit: 2000, targetSequence: run.highWater, throughSequence: "0", omittedChanges: 0, complete: false,
    observedAt: new Date().toISOString(), detail });
  if (source.kind !== "demian" || !source.baseUrl || source.assistantNativeSourceId) return empty("unsupported", "이 출처의 변경 파일 근거 조회는 지원하지 않습니다.");
  if (run.sourceState !== "connected") return empty("disconnected", "현재 원본 연결을 확인한 뒤 파일 근거를 조회합니다.");
  const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
  try {
    const observed = await client.observe(run.runId);
    if (observed.sessionId !== run.sessionId) throw new SourceError(403);
    const page = await client.fileChanges(run.runId, run.highWater);
    // A native stream may close quietly when its reader loses access. Re-read
    // the source authority before publishing any paths retained from the replay.
    const confirmed = await client.observe(run.runId);
    if (confirmed.sessionId !== run.sessionId) throw new SourceError(403);
    await refreshGrants();
    const current = authorized();
    if (current.source.baseUrl !== source.baseUrl || current.source.organizationId !== source.organizationId || current.run.sessionId !== run.sessionId || current.run.sourceState !== "connected") {
      throw new CommandError(403, "source_forbidden", "파일 근거 조회 중 원본 접근이 달라졌습니다.");
    }
    return { ...page, state: "connected", runKey: key, observedAt: new Date().toISOString(),
      detail: "원본 diff 이벤트 또는 native 파일 편집 요청·완료를 연결한 metadata입니다. 도구가 보고한 변경이며 현재 파일 내용·최종 상태와 전체 diff를 보증하지 않습니다." };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    await refreshGrants(); authorized();
    if (error instanceof SourceError && [401, 403, 404].includes(error.status)) return empty("forbidden", "현재 원본 파일 근거에 접근할 수 없습니다.");
    return empty("disconnected", "원본 파일 근거를 확인하지 못했습니다. 빈 결과를 변경 없음으로 해석하지 마세요.");
  }
}
