import { DemianClient } from "../../packages/adapters/demian/index.ts";
import { DemianRunWriter } from "../../packages/adapters/demian/assignment.ts";
import { CommandError } from "../../packages/commands/index.ts";
import { contextSummarySchema, contextTargetSchema, type ContextSummary, type ContextTarget } from "../../packages/context/contracts.ts";
import { statusSchema, type ProjectTaskMetadata, type RunView, type Snapshot } from "../../packages/contracts/index.ts";
import type { Config, ContextReader, SourceConfig } from "./config.ts";
import { contextReaderStamp } from "./context-auth.ts";
import type { Sources } from "./runner.ts";
import { sourceIdentity } from "./source-identity.ts";

export function parseContextPath(path: string): ContextTarget | null {
  const project = /^\/api\/integrations\/context\/v1\/projects\/([a-z0-9_-]{1,80})\/([0-9a-f-]{36})(?:\/tasks\/([0-9a-f-]{36}))?$/.exec(path);
  const native = /^\/api\/integrations\/context\/v1\/(runs|sessions)\/([a-z0-9_-]{1,80})\/([0-9a-f-]{36})$/.exec(path);
  const value = project ? project[3] ? { kind: "task", sourceId: project[1], projectId: project[2], taskId: project[3] }
    : { kind: "project", sourceId: project[1], projectId: project[2] }
    : native ? native[1] === "runs" ? { kind: "run", sourceId: native[2], runId: native[3] } : { kind: "session", sourceId: native[2], sessionId: native[3] } : null;
  const parsed = contextTargetSchema.safeParse(value); return parsed.success ? parsed.data : null;
}

const projectScope = (reader: ContextReader, source: string, project: string) => reader.projectScopes.some((scope) => scope.sourceId === source && scope.projectIds.includes(project));
const sessionScope = (reader: ContextReader, source: string, session: string) => reader.nativeSourceIds.includes(source) && reader.sessionScopes.some((scope) => scope.sourceId === source && scope.sessionIds.includes(session));
const bindingStamp = (run: RunView) => JSON.stringify(run.binding ?? null);
function options(source: SourceConfig) {
  return { sourceId: source.id, baseUrl: source.baseUrl!, ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
    ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}), ...(source.organizationId ? { organizationId: source.organizationId } : {}) };
}

/** The reader is an explicit service principal, not a caller-supplied user identity. */
export async function contextSummary(config: () => Config, snapshot: (user: string) => Snapshot, initial: ContextReader,
  raw: ContextTarget, sources: Pick<Sources, "refreshProjectGrants" | "projects">): Promise<ContextSummary> {
  const target = contextTargetSchema.parse(raw); const initialStamp = contextReaderStamp(initial);
  const authorize = () => {
    const current = config(); const reader = current.contextReaders?.find((item) => item.id === initial.id);
    if (!reader || contextReaderStamp(reader) !== initialStamp || current.auth.mode !== "proxy" || !current.auth.users.includes(reader.user)) {
      throw new CommandError(403, "context_forbidden", "현재 문맥 요약에 접근할 수 없습니다.");
    }
    const view = snapshot(reader.user);
    const projectAllowed = (source: string, project: string) => projectScope(reader, source, project) && view.sources.some((item) => item.id === source && item.kind === "projects" && item.state === "connected" && item.authorizedProjectIds?.includes(project));
    const allowedRun = (run: RunView) => reader.nativeSourceIds.includes(run.sourceId) && run.sourceState === "connected" &&
      (!run.binding || projectAllowed(run.binding.projectSourceId, run.binding.projectId));
    const source = current.sources.find((item) => item.id === target.sourceId && item.users.includes(reader.user));
    if (!source) throw new CommandError(404, "context_not_found", "현재 문맥 요약에 접근할 수 없습니다.");
    if (target.kind === "project" || target.kind === "task") {
      if (source.kind !== "projects" || !projectAllowed(source.id, target.projectId)) throw new CommandError(404, "context_not_found", "현재 문맥 요약에 접근할 수 없습니다.");
    } else {
      const sessionId = target.kind === "session" ? target.sessionId : view.runs.find((run) => run.sourceId === target.sourceId && run.runId === target.runId)?.sessionId;
      if (source.kind !== "demian" || !source.baseUrl || !sessionId || !sessionScope(reader, source.id, sessionId)) throw new CommandError(404, "context_not_found", "현재 문맥 요약에 접근할 수 없습니다.");
      if (!view.sources.some((item) => item.id === source.id && item.state === "connected")) throw new CommandError(503, "context_unavailable", "현재 실행 출처를 확인하지 못했습니다.");
    }
    return { current, reader, view, source, allowedRun };
  };
  await sources.refreshProjectGrants(initial.user); let access = authorize();
  const targetStamp = sourceIdentity(access.source);
  let task: ProjectTaskMetadata | null = null;
  if (target.kind === "task") task = await sources.projects.client(target.sourceId, initial.user).task(target.taskId, target.projectId);
  if (target.kind === "session") {
    const session = await new DemianRunWriter(options(access.source)).session(target.sessionId);
    if (session.sessionId !== target.sessionId) throw new CommandError(404, "context_not_found", "현재 문맥 요약에 접근할 수 없습니다.");
  }
  access = authorize();
  const matches = (run: RunView) => target.kind === "run" ? run.sourceId === target.sourceId && run.runId === target.runId
    : target.kind === "session" ? run.sourceId === target.sourceId && run.sessionId === target.sessionId
    : run.binding?.projectSourceId === target.sourceId && run.binding.projectId === target.projectId && (target.kind === "project" || run.binding.taskId === target.taskId);
  const candidates = access.view.runs.filter((run) => matches(run) && access.reader.nativeSourceIds.includes(run.sourceId))
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.key.localeCompare(b.key));
  let unavailable = access.reader.nativeSourceIds.some((id) => !access.view.sources.some((source) => source.id === id && source.state === "connected"));
  const validated: Array<{ run: RunView; stamp: string; native: Awaited<ReturnType<DemianClient["observe"]>>; binding: string }> = [];
  for (const run of candidates.slice(0, 50)) {
    access = authorize();
    const source = access.current.sources.find((item) => item.id === run.sourceId && item.kind === "demian" && item.baseUrl && item.users.includes(initial.user));
    if (!source || !access.allowedRun(run)) { unavailable = true; continue; }
    const stamp = sourceIdentity(source);
    try {
      const native = await new DemianClient(options(source)).observe(run.runId);
      const current = authorize();
      if (native.sessionId !== run.sessionId || native.workspaceId !== run.workspaceId ||
        !current.view.runs.some((item) => item.key === run.key && current.allowedRun(item) && bindingStamp(item) === bindingStamp(run)) ||
        !current.current.sources.some((item) => item.id === source.id && sourceIdentity(item) === stamp)) { unavailable = true; continue; }
      validated.push({ run, native, stamp, binding: bindingStamp(run) });
    } catch (error) { if (error instanceof CommandError) throw error; unavailable = true; }
  }
  await sources.refreshProjectGrants(initial.user); access = authorize();
  if (target.kind === "task") { task = await sources.projects.client(target.sourceId, initial.user).task(target.taskId, target.projectId); access = authorize(); }
  if (sourceIdentity(access.source) !== targetStamp) throw new CommandError(403, "context_forbidden", "문맥 요약의 원본 구성이 변경됐습니다.");
  const link = (run: RunView, view = "map") => { const url = new URL("/", access.current.publicOrigin); url.searchParams.set("view", view); url.searchParams.set("run", run.key); return url.href; };
  const runs: ContextSummary["runs"] = [];
  for (const row of validated) {
    const run = access.view.runs.find((item) => item.key === row.run.key);
    const source = access.current.sources.find((item) => item.id === row.run.sourceId);
    if (!run || !source || sourceIdentity(source) !== row.stamp || !access.allowedRun(run) || !matches(run) || bindingStamp(run) !== row.binding) { unavailable = true; continue; }
    runs.push({ sourceId: run.sourceId, runId: run.runId, sessionId: run.sessionId, status: row.native.status,
      binding: run.binding ? { projectSourceId: run.binding.projectSourceId, projectId: run.binding.projectId, taskId: run.binding.taskId, revision: run.binding.taskRevision } : null,
      observedAt: row.native.observedAt, cursor: run.cursor, highWater: run.highWater, stale: run.stale,
      incomplete: run.incomplete || run.cursor !== run.highWater || run.status !== row.native.status, url: link(run) });
  }
  const byStatus = Object.fromEntries(statusSchema.options.map((status) => [status, runs.filter((run) => run.status === status).length]));
  const first = runs[0]; const firstView = first && access.view.runs.find((run) => run.sourceId === first.sourceId && run.runId === first.runId);
  let trackUrl = firstView ? link(firstView, target.kind === "project" ? "track" : target.kind === "session" ? "trace" : "map") : null;
  if (target.kind === "project" && firstView?.projectKey && trackUrl) { const url = new URL(trackUrl); url.searchParams.set("project", firstView.projectKey); trackUrl = url.href; }
  return contextSummarySchema.parse({ version: 1, context: target, observedAt: new Date().toISOString(),
    task: task ? { id: task.id, revision: task.revision, state: task.state, requiresTest: task.requiresTest } : null, runs,
    counts: { runs: runs.length, sessions: new Set(runs.map((run) => JSON.stringify([run.sourceId, run.sessionId]))).size, byStatus },
    coverage: { kind: "observed-window", limit: 50, capped: candidates.length > 50, unavailable }, trackUrl });
}
