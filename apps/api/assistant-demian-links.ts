import { z } from "zod";
import { DemianClient, SourceError, type DemianOptions } from "../../packages/adapters/demian/index.ts";
import { assistantExecutionMetadataV2Schema, type AssistantExecutionMetadataV2 } from "../../packages/contracts/assistant.ts";
import type { AssistantExecutionView, AssistantDemianLink, AssistantDemianLinksView } from "../../packages/contracts/assistant-view.ts";
import { externalKey, runSchema, type Snapshot } from "../../packages/contracts/index.ts";
import type { Config, SourceConfig } from "./config.ts";
import { assistantReady, projectsReady, sourceIdentity } from "./source-identity.ts";
import { sourceCredentialStamp } from "./source-credential.ts";

type Reference = NonNullable<AssistantExecutionMetadataV2["roles"][number]["runtime"]["demian"]>;
type Reader = Pick<DemianClient, "identity" | "observeRuntime">;
type State = AssistantDemianLinksView["state"];
const identitySchema = z.object({ userId: z.guid(), organizationId: z.guid() }).strict();
class LinkUnavailable extends Error {
  constructor(readonly state: State) { super("assistant_native_link_unavailable"); }
}
const detail = (state: State) => state === "connected"
  ? "현재 업무·Assistant·명시된 Demian 출처의 접근과 원본 실행 영수증을 대조했습니다. 실행 성공은 업무 수용과 별개입니다."
  : state === "not_observed" ? "원본이 제공한 실제 Demian 실행 참조가 아직 없습니다."
  : state === "unconfigured" ? "현재 허용된 업무와 producer에 대응하는 명시적 Demian 출처 연결이 필요합니다."
  : "현재 원본 실행의 접근·식별자·범위를 확인하지 못해 이전 관계와 실행 상세도 숨깁니다.";

/** Join only already known Runs. Remote DTO origins are never fetch destinations. */
export class AssistantDemianLinks {
  constructor(private config: () => Config, private snapshot: (user: string) => Snapshot,
    private refreshGrants: (user: string) => Promise<void>,
    private factory: (options: DemianOptions) => Reader = options => new DemianClient(options)) {}

  private policy(source: SourceConfig): string {
    return JSON.stringify([sourceIdentity(source), source.assistantCredentialFile, source.assistantProtocol ?? 1,
      source.assistantDemianMappings ?? [], source.users]);
  }

  private authorized(user: string, assistant: SourceConfig, execution: AssistantExecutionView, reference: Reference) {
    const config = this.config(), snapshot = this.snapshot(user);
    const current = config.sources.find(source => source.id === assistant.id);
    if (!(config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user) ||
        !current || !assistantReady(current) || current.assistantUser !== user || !current.users.includes(user) ||
        this.policy(current) !== this.policy(assistant)) throw new LinkUnavailable("forbidden");
    const task = execution.currentTask;
    const peer = config.sources.find(source => source.id === current.assistantProjectsSourceId);
    if (!task || !execution.native.task || !peer || !projectsReady(peer) || !peer.users.includes(user) || peer.projectsUser !== user ||
        task.projectsSourceId !== peer.id || task.project.id !== execution.native.task.projectId ||
        task.task.id !== execution.native.task.taskId || task.task.projectId !== task.project.id ||
        !snapshot.sources.some(source => source.id === assistant.id && source.kind === "assistant" && source.state === "connected") ||
        !snapshot.sources.some(source => source.id === peer.id && source.kind === "projects" && source.state === "connected" &&
          source.authorizedProjectIds?.includes(task.project.id))) throw new LinkUnavailable("forbidden");
    const mappings = (current.assistantDemianMappings ?? []).filter(mapping => mapping.origin === reference.origin &&
      mapping.organizationId === reference.organizationId && mapping.workspaceId === reference.workspaceId);
    if (mappings.length !== 1) throw new LinkUnavailable("unconfigured");
    const source = config.sources.find(source => source.id === mappings[0]!.sourceId);
    if (!source || source.kind !== "demian" || !source.baseUrl || source.organizationId !== reference.organizationId ||
        !source.users.includes(user)) throw new LinkUnavailable("forbidden");
    const sourceView = snapshot.sources.find(item => item.id === source.id && item.kind === "demian");
    if (sourceView?.state !== "connected") throw new LinkUnavailable(sourceView?.state === "disconnected" ? "disconnected" : "forbidden");
    const key = externalKey(source.id, reference.runId);
    const run = snapshot.runs.find(run => run.key === key && run.sourceId === source.id && run.runId === reference.runId);
    if (!run || run.sourceState !== "connected" || run.stale || run.sessionId !== reference.sessionId || run.workspaceId !== reference.workspaceId)
      throw new LinkUnavailable("forbidden");
    const binding = run.binding;
    if (binding && (binding.sourceId !== source.id || binding.runId !== run.runId ||
        !snapshot.sources.some(project => project.id === binding.projectSourceId && project.kind === "projects" && project.state === "connected" &&
          project.authorizedProjectIds?.includes(binding.projectId)))) throw new LinkUnavailable("forbidden");
    return { source: structuredClone(source), run,
      stamp: JSON.stringify([this.policy(current), sourceIdentity(source), source.tokenFile, source.credentialFormat,
        source.users, config.auth, run.runId, run.sessionId, run.workspaceId, binding, sourceCredentialStamp(source)]) };
  }

  async project(user: string, assistant: SourceConfig, execution: AssistantExecutionView, deadline: number): Promise<{
    view: AssistantExecutionView; confirm: () => void;
  }> {
    if ((assistant.assistantProtocol ?? 1) === 1) return { view: execution, confirm: () => {} };
    const native = assistantExecutionMetadataV2Schema.parse(execution.native);
    const references = native.roles.flatMap(role => role.runtime.demian ? [{ roleId: role.id, reference: role.runtime.demian }] : []);
    // Producer tuples are server-only authority inputs. Native thread/turn IDs
    // are inspected in native Trace after authorization, not cached here.
    const safeNative = assistantExecutionMetadataV2Schema.parse({ ...native, roles: native.roles.map(role => ({ ...role,
      runtime: { ...role.runtime, demian: null,
        ...(role.runtime.demian || role.observation.basis === "external_run_wall_timestamps_unverified" ? { threadId: null, turnId: null } : {}) } })) });
    const view: AssistantExecutionView = { ...execution, native: safeNative };
    const publish = (links: AssistantDemianLink[], state: State) => {
      view.demianLinks = { state, links, omitted: references.length - links.length, complete: false, detail: detail(state) };
    };
    if (!references.length) { publish([], "not_observed"); return { view, confirm: () => {} }; }
    if (!execution.currentTask || !(assistant.assistantDemianMappings?.length)) {
      publish([], "unconfigured"); return { view, confirm: () => {} };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
    let stop!: () => void;
    const ended = new Promise<never>((_, reject) => { stop = () => reject(new LinkUnavailable("disconnected")); controller.signal.addEventListener("abort", stop, { once: true }); });
    const guard = async <T>(read: () => Promise<T>): Promise<T> => {
      if (controller.signal.aborted || performance.now() >= deadline) throw new LinkUnavailable("disconnected");
      const value = await Promise.race([read(), ended]);
      if (controller.signal.aborted || performance.now() >= deadline) throw new LinkUnavailable("disconnected");
      return value;
    };
    const results: Array<{ link: AssistantDemianLink; confirm: () => void }> = [];
    let unavailable: State = "unconfigured";
    const remember = (error: unknown) => {
      const state: State = error instanceof LinkUnavailable ? error.state
        : error instanceof SourceError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected";
      if (state === "disconnected" || unavailable !== "disconnected" && state === "forbidden") unavailable = state;
    };
    try {
      await guard(() => this.refreshGrants(user));
      for (let offset = 0; offset < references.length; offset += 4) {
        await Promise.all(references.slice(offset, offset + 4).map(async ({ roleId, reference }) => {
          try {
            const initial = this.authorized(user, assistant, execution, reference), source = initial.source;
            if (source.assistantNativeSourceId) {
              if (source.assistantNativeSourceId !== assistant.id || source.baseUrl !== reference.origin)
                throw new LinkUnavailable("forbidden");
              const confirm = () => {
                if (this.authorized(user, assistant, execution, reference).stamp !== initial.stamp) throw new LinkUnavailable("forbidden");
              };
              confirm();
              results.push({ link: { roleId, sourceId: source.id, runKey: initial.run.key, runId: reference.runId,
                sessionId: reference.sessionId, workspaceId: reference.workspaceId, operationId: reference.operationId,
                status: initial.run.status, observedAt: initial.run.observedAt }, confirm });
              return;
            }
            const client = this.factory({ sourceId: source.id, baseUrl: source.baseUrl!,
              ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
              ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
              organizationId: reference.organizationId, signal: controller.signal });
            const check = (observed: Awaited<ReturnType<Reader["observeRuntime"]>>) => {
              const run = runSchema.parse(observed.run);
              if (run.sourceId !== source.id || run.runId !== reference.runId || run.sessionId !== reference.sessionId ||
                  run.workspaceId !== reference.workspaceId || observed.operationId !== reference.operationId) throw new LinkUnavailable("forbidden");
              return run;
            };
            const before = identitySchema.parse(await guard(() => client.identity()));
            if (before.organizationId !== reference.organizationId) throw new LinkUnavailable("forbidden");
            check(await guard(() => client.observeRuntime(reference.runId)));
            const run = check(await guard(() => client.observeRuntime(reference.runId)));
            const after = identitySchema.parse(await guard(() => client.identity()));
            if (after.organizationId !== before.organizationId || after.userId !== before.userId) throw new LinkUnavailable("forbidden");
            const confirm = () => {
              if (this.authorized(user, assistant, execution, reference).stamp !== initial.stamp) throw new LinkUnavailable("forbidden");
            };
            confirm();
            results.push({ link: { roleId, sourceId: source.id, runKey: initial.run.key, runId: reference.runId,
              sessionId: reference.sessionId, workspaceId: reference.workspaceId, operationId: reference.operationId,
              status: run.status, observedAt: run.observedAt }, confirm });
          } catch (error) { remember(error); }
        }));
      }
      await guard(() => this.refreshGrants(user));
    } catch (error) { remember(error); results.splice(0); }
    finally { clearTimeout(timer); controller.signal.removeEventListener("abort", stop); controller.abort(); }
    const confirm = () => {
      const links: AssistantDemianLink[] = [];
      for (const result of results) {
        try { result.confirm(); links.push(result.link); }
        catch (error) { remember(error); }
      }
      publish(links.sort((a, b) => a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0), links.length ? "connected" : unavailable);
    };
    confirm();
    return { view, confirm };
  }
}
