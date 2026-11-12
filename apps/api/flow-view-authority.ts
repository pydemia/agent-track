import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { Snapshot } from "../../packages/contracts/index.ts";
import { flowViewAnchorsSchema } from "../../packages/contracts/flow-views.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { Sources } from "./runner.ts";
import type { FlowViewAuthorization } from "./flow-views.ts";
import { AssistantAuthorityError } from "./assistant-authority.ts";
import { projectTaskMetadata } from "./project-task-metadata.ts";
import { sourceCredentialStamp } from "./source-credential.ts";

const unavailable = () => new CommandError(404, "flow_view_scope_unavailable", "현재 저장 보기의 구성 범위에 접근할 수 없습니다.");
const disconnected = () => new CommandError(503, "flow_view_source_unavailable", "저장 보기의 원본 접근을 확인하지 못했습니다.");
type NativeReader = Pick<DemianClient, "observe">;

/** Re-check explicit anchors; neither graph labels nor a saved ID grant access. */
export function flowViewAuthorization(config: () => Config, sources: Sources, snapshot: (actor: string) => Snapshot,
  native: (source: SourceConfig, signal: AbortSignal) => NativeReader = (source, signal) => new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl!, signal,
    ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}), ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
    ...(source.organizationId ? { organizationId: source.organizationId } : {}) })): FlowViewAuthorization {
  return async (actor, input, deadline = performance.now() + 10_000) => {
    const anchors = flowViewAnchorsSchema.parse(input);
    const ids = [...new Set([...anchors.tasks, ...anchors.runs, ...anchors.assistants].map(ref => ref.sourceId))].sort();
    const check = () => {
      if (performance.now() >= deadline) throw disconnected();
      const current = config(), root = current.auth.mode === "proxy" ? current.auth.users.includes(actor) : current.auth.user === actor;
      if (!root) throw unavailable();
      const views = sources.views(actor), state = snapshot(actor);
      const selected = ids.map(id => {
        const candidates = current.sources.filter(source => source.id === id && source.users.includes(actor));
        if (candidates.length !== 1) throw unavailable();
        const source = candidates[0]!, view = views.find(item => item.id === id);
        if (!view || view.state === "forbidden" || view.state === "unsupported") throw unavailable();
        if (view.state !== "connected" && source.kind !== "codex") throw disconnected();
        return source;
      });
      for (const ref of anchors.tasks) if (!views.some(view => view.id === ref.sourceId && view.kind === "projects" && view.state === "connected" && view.authorizedProjectIds?.includes(ref.projectId))) throw unavailable();
      for (const ref of anchors.runs) {
        const matches = state.runs.filter(run => run.key === ref.key && run.sourceId === ref.sourceId && run.runId === ref.runId);
        if (matches.length !== 1) throw unavailable();
        const run = matches[0]!;
        if (run.sourceState === "forbidden" || run.sourceState === "unsupported") throw unavailable();
      }
      const stamps = selected.map(source => [source, [source.tokenFile, source.projectsCredentialFile, source.assistantCredentialFile]
        .filter((file): file is string => Boolean(file)).map(tokenFile => sourceCredentialStamp({ ...source, tokenFile }))]);
      return { selected, state, stamp: JSON.stringify([current.auth, stamps]) };
    };
    try {
      await sources.refreshProjectGrants(actor);
      const initial = check();
      const confirm = () => { if (check().stamp !== initial.stamp) throw unavailable(); };
      for (const ref of anchors.tasks) { await projectTaskMetadata(sources, actor, ref.sourceId, ref.projectId, ref.taskId); confirm(); }
      for (const ref of anchors.runs) {
        const source = initial.selected.find(item => item.id === ref.sourceId)!;
        if (source.kind === "demian") {
          if (!source.baseUrl) throw unavailable();
          const run = await native(source, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())))).observe(ref.runId);
          const original = initial.state.runs.find(item => item.key === ref.key)!;
          if (run.runId !== ref.runId || run.sessionId !== original.sessionId) throw unavailable();
        } else if (source.kind !== "codex") throw unavailable();
        confirm();
      }
      for (const ref of anchors.assistants) { await sources.assistant.detail(actor, ref.sourceId, ref.executionId); confirm(); }
      await sources.refreshProjectGrants(actor); confirm();
      return confirm;
    } catch (error) {
      if (error instanceof CommandError) throw error;
      if ((error instanceof SourceError || error instanceof ProjectsSourceError || error instanceof AssistantAuthorityError) && [401, 403, 404].includes(error.status)) throw unavailable();
      throw disconnected();
    }
  };
}
