import type { Config } from "./config.ts";
import type { Sources } from "./runner.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import { runConversationViewSchema, type RunConversationView, type ConversationPage } from "../../packages/contracts/conversation.ts";
import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { sourceCredentialStamp } from "./source-credential.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { AssistantAuthorityError } from "./assistant-authority.ts";

type ContentSources = Pick<Sources, "projects" | "assistant">;
export async function runConversation(config: () => Config, snapshot: (user: string) => Snapshot,
  sources: ContentSources, user: string, key: string, after: string, limit: number, signal?: AbortSignal): Promise<RunConversationView> {
  const authorize = () => {
    const settings = config(), view = snapshot(user);
    if (!(settings.auth.mode === "proxy" ? settings.auth.users.includes(user) : settings.auth.user === user))
      throw new CommandError(401, "authentication_required", "로그인을 다시 확인해 주세요.");
    const run = view.runs.find(item => item.key === key), source = settings.sources.find(item => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
    const binding = run.binding;
    if (binding && !view.sources.some(item => item.id === binding.projectSourceId && item.kind === "projects" &&
        item.state === "connected" && item.authorizedProjectIds?.includes(binding.projectId)))
      throw new CommandError(404, "run_not_found", "현재 접근 가능한 업무가 아닙니다.");
    const connected = run.sourceState === "connected" && !run.stale && view.sources.some(item => item.id === source.id && item.state === "connected");
    return { run, source: structuredClone(source), connected,
      stamp: JSON.stringify([settings.auth, source, run.runId, run.sessionId, run.workspaceId, run.assistantAttempt, binding]) };
  };
  const initial = authorize(), { run, source } = initial;
  const empty = (state: RunConversationView["state"], detail: string): RunConversationView => ({ version: 1, runKey: key, sourceId: source.id,
    runId: run.runId, sessionId: run.sessionId, state, page: null, attempt: null, detail });
  if (!["demian", "codex"].includes(source.kind)) return empty("unsupported", "이 출처는 아직 본문 읽기 경로를 제공하지 않습니다.");
  if (!initial.connected) return empty("disconnected", "현재 원본 접근을 확인하지 못해 본문을 표시하지 않습니다.");
  const timeout = AbortSignal.timeout(10_000), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let page: ConversationPage, attempt: RunConversationView["attempt"] = null;
  const check = () => { if (combined.aborted) throw new SourceError(503); const current = authorize();
    if (current.stamp !== initial.stamp || !current.connected) throw new CommandError(404, "source_changed", "본문 조회 중 접근 범위가 변경됐습니다."); return current; };
  const bounded = async <T>(read: () => Promise<T>): Promise<T> => {
    let abort!: () => void;
    const stopped = new Promise<never>((_, reject) => { abort = () => reject(new SourceError(503)); combined.addEventListener("abort", abort, { once: true }); });
    try { check(); const value = await Promise.race([read(), stopped]); check(); return value; }
    finally { combined.removeEventListener("abort", abort); }
  };
  try {
    await bounded(() => sources.projects.refresh(user)); check();
    if (source.assistantNativeSourceId) {
      const ref = run.assistantAttempt;
      if (!ref || ref.assistantSourceId !== source.assistantNativeSourceId)
        return empty("unsupported", "이 실행은 정확한 역할·시도 연결을 아직 제공하지 않습니다.");
      const value = await bounded(() => sources.assistant.attemptConversation(user, ref.assistantSourceId, ref.executionId, ref.roleId, ref.attemptId, after, limit,
        { sourceId: source.id, runId: run.runId, sessionId: run.sessionId, workspaceId: run.workspaceId }));
      page = value.page;
      attempt = { sourceId: ref.assistantSourceId, executionId: ref.executionId, roleId: ref.roleId, attemptId: ref.attemptId,
        ordinal: value.ordinal, current: value.current };
    } else if (source.kind === "demian" && source.baseUrl) {
      const credential = sourceCredentialStamp(source);
      const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl, signal: combined,
        ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}), ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
        ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
      await bounded(() => client.verifySessionAccess(run.sessionId));
      page = await bounded(() => client.conversation(run.runId, run.sessionId, after, limit));
      await bounded(() => sources.projects.refresh(user));
      await bounded(() => client.verifySessionAccess(run.sessionId));
      const observed = await bounded(() => client.observe(run.runId));
      if (observed.runId !== run.runId || observed.sessionId !== run.sessionId || sourceCredentialStamp(check().source) !== credential)
        throw new SourceError(403);
    } else return empty("unsupported", "이 출처는 페이지별 대화 읽기 경로가 구성되지 않았습니다. 위의 원본 내용에서 확인해 주세요.");
    if (page.run.id !== run.runId || page.run.sessionId !== run.sessionId || run.workspaceId !== null && page.run.workspaceId !== run.workspaceId)
      throw new SourceError(503);
    await bounded(() => sources.projects.refresh(user)); check();
    return runConversationViewSchema.parse({ version: 1, runKey: key, sourceId: source.id, runId: run.runId, sessionId: run.sessionId,
      state: "connected", attempt, page, detail: "선택한 실행 시도에 귀속된 대화·도구 기록입니다. 본문은 Track 원장에 저장하지 않습니다." });
  } catch (error) {
    if (error instanceof CommandError) throw error;
    authorize();
    if (error instanceof AssistantAuthorityError && error.status === 404) return empty("unsupported", "원본의 시도별 본문 읽기가 아직 지원되지 않거나 현재 시도를 읽을 수 없습니다.");
    const denied = (error instanceof SourceError || error instanceof AssistantAuthorityError) && [401, 403, 404].includes(error.status);
    return empty(denied ? "forbidden" : "disconnected", denied ? "현재 원본 본문 읽기가 허용되지 않았습니다." : "선택한 시도의 내용을 읽지 못했습니다. 이전 본문은 표시하지 않습니다.");
  }
}
