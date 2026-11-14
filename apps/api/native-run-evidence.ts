import type { Config } from "./config.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { sourceIdentity } from "./source-identity.ts";
import { AssistantAuthorityError, type AssistantAuthority } from "./assistant-authority.ts";
import { nativeRunEvidenceViewSchema, publicNativeRunEvidence, type NativeRunEvidenceView } from "../../packages/contracts/native-run-evidence.ts";

/** Current cross-app authority, no executor credentials and no durable event writes. */
export async function nativeRunEvidence(
  config: () => Config, snapshot: (user: string) => Snapshot | Promise<Snapshot>, authority: AssistantAuthority,
  user: string, key: string, after: string, limit: number,
): Promise<NativeRunEvidenceView> {
  const current = async () => {
    const view = await snapshot(user);
    const settings = config(), { auth } = settings;
    if (!(auth.mode === "proxy" ? auth.users.includes(user) : auth.user === user))
      throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    const run = view.runs.find(item => item.key === key);
    const source = settings.sources.find(item => item.id === run?.sourceId && item.users.includes(user));
    const project = run?.binding && view.sources.find(item => item.id === run.binding!.projectSourceId && item.kind === "projects");
    if (!run || !source || run.binding && (project?.state !== "connected" || !project.authorizedProjectIds?.includes(run.binding.projectId)))
      throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    return { run, source, stamp: sourceIdentity(source) };
  };
  const before = await current();
  const empty = (state: NativeRunEvidenceView["state"], detail: string): NativeRunEvidenceView => ({
    state, runKey: key, sourceId: before.source.id, page: null, executionRef: null,
    observedAt: new Date().toISOString(), detail,
  });
  if (before.source.kind !== "demian" || !before.source.assistantNativeSourceId)
    return empty("unsupported", "이 출처는 기존 원본 Trace 조회를 사용합니다.");
  if (before.run.sourceState !== "connected" || before.run.stale)
    return empty("disconnected", "현재 원본 연결을 확인한 뒤 상세 근거를 조회합니다.");
  try {
    const result = await authority.nativeEvidence(user, before.source.assistantNativeSourceId, before.source.id, before.run.runId, after, limit);
    const confirmed = await current();
    result.confirmAuthority();
    if (confirmed.stamp !== before.stamp || confirmed.run.sessionId !== before.run.sessionId ||
        confirmed.run.workspaceId !== before.run.workspaceId || confirmed.run.sourceState !== "connected" || confirmed.run.stale ||
        result.page.run.id !== before.run.runId || result.page.run.session_id !== before.run.sessionId ||
        result.page.run.workspace_id !== before.run.workspaceId)
      throw new CommandError(403, "source_forbidden", "상세 조회 중 원본 접근이 변경됐습니다.");
    return nativeRunEvidenceViewSchema.parse({ state: "connected", runKey: key, sourceId: before.source.id,
      executionRef: { sourceId: before.source.assistantNativeSourceId, executionId: result.executionId, roleId: result.roleId },
      page: publicNativeRunEvidence(result.page), observedAt: result.observedAt,
      detail: "현재 업무·역할·원본 권한을 대조한 상세 관측입니다. 기록 순서·Run 시간·usage 범위와 업무 수용은 구별합니다." });
  } catch (error) {
    if (error instanceof CommandError) throw error;
    const confirmed = await current();
    if (confirmed.stamp !== before.stamp) throw new CommandError(403, "source_forbidden", "상세 조회 중 출처 설정이 변경됐습니다.");
    if (error instanceof AssistantAuthorityError && [401, 403, 404].includes(error.status))
      return empty("forbidden", "현재 원본 상세 조회가 허용되지 않았습니다. 저장된 상세 근거는 표시하지 않습니다.");
    return empty("disconnected", "상세 관측을 확인하지 못했습니다. 빈 결과를 실행 근거 없음으로 해석하지 마세요.");
  }
}
