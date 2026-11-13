import { z } from "zod";
import { createHash } from "node:crypto";
import { AssistantClient, AssistantSourceError, type AssistantClientOptions } from "../../packages/adapters/assistant/index.ts";
import { ProjectsSourceError } from "../../packages/adapters/projects/index.ts";
import { assistantCapabilitiesSchema, assistantExecutionMetadataSchema, assistantExecutionPageSchema,
  assistantExecutionEventsPageSchema, assistantCapabilitiesV2Schema, assistantExecutionMetadataV2Schema,
  assistantExecutionPageV2Schema, assistantExecutionEventsPageV2Schema, type AssistantObservedExecution } from "../../packages/contracts/assistant.ts";
import type { AssistantExecutionView, AssistantExecutionListView, AssistantExecutionEventsView } from "../../packages/contracts/assistant-view.ts";
import { externalKey, type SourceView } from "../../packages/contracts/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import type { ProjectsAuthority } from "./projects-authority.ts";
import { assistantReady, projectsReady, sourceIdentity } from "./source-identity.ts";
import { AssistantDemianLinks } from "./assistant-demian-links.ts";
import { assistantNativeMetadataPageSchema, nativeMetadataSequenceSchema, type NativeMetadataPage } from "../../packages/contracts/native-metadata.ts";
import type { RunBinding } from "../../packages/contracts/index.ts";

export type AssistantReader = Pick<AssistantClient, "capabilities" | "executions" | "execution" | "events"> & Partial<Pick<AssistantClient, "nativeMetadata">>;
export interface AssistantNativeObservation { page: NativeMetadataPage; throughSequence: string; observedAt: string; title: string; binding: RunBinding }
export interface AssistantNativeWindow { observations: AssistantNativeObservation[]; partial: boolean }
export type AssistantClientFactory = (options: AssistantClientOptions) => AssistantReader;
type CurrentTask = AssistantExecutionView["currentTask"];
interface Grant { stamp: string; state: SourceView["state"]; observedAt: string }
interface RequestScope { source: SourceConfig; user: string; stamp: string; deadline: number; nativeChecks: Array<() => void> }

export class AssistantAuthorityError extends Error {
  constructor(readonly status: number) { super("assistant_authority_unavailable"); }
}

function safeError(error: unknown): AssistantAuthorityError {
  if (error instanceof AssistantAuthorityError) return new AssistantAuthorityError(error.status);
  if (error instanceof AssistantSourceError || error instanceof ProjectsSourceError) {
    if ([401, 403].includes(error.status)) return new AssistantAuthorityError(403);
    if ([400, 404].includes(error.status)) return new AssistantAuthorityError(error.status);
  }
  return new AssistantAuthorityError(503);
}

/** Live owner metadata only. Grants contain no executions, tasks or events. */
export class AssistantAuthority {
  private grants = new Map<string, Grant>();
  private pending = new Map<string, Promise<unknown>>();
  private pendingCount = new Map<string, number>();

  constructor(private store: Store, private config: () => Config,
    private projects: ProjectsAuthority,
    private clientFactory: AssistantClientFactory = options => new AssistantClient(options),
    private requestTimeoutMs = 10_000,
    private demianLinks = new AssistantDemianLinks(config, user => store.snapshot(user, []), async () => {})) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1 || requestTimeoutMs > 10_000) throw new Error("Invalid Assistant read deadline");
  }

  private allowed(source: SourceConfig, user: string): boolean {
    const { auth } = this.config();
    return (auth.mode === "proxy" ? auth.users.includes(user) : auth.user === user) &&
      assistantReady(source) && source.users.includes(user) && source.assistantUser === user;
  }

  private stamp(source: SourceConfig): string {
    const config = this.config();
    const peer = config.sources.find(item => item.id === source.assistantProjectsSourceId);
    // Credential paths and peer policy are deliberately broader than the durable pin.
    return JSON.stringify([sourceIdentity(source), source.assistantCredentialFile,
      source.assistantProtocol ?? 1, source.assistantDemianMappings ?? [],
      (source.assistantDemianMappings ?? []).map(mapping => {
        const target = config.sources.find(item => item.id === mapping.sourceId);
        return target ? [sourceIdentity(target), target.tokenFile, target.credentialFormat, target.users] : null;
      }),
      source.users, config.auth, peer ? [sourceIdentity(peer), peer.projectsCredentialFile,
        peer.users, peer.id] : null]);
  }

  private scope(sourceId: string, user: string): RequestScope {
    const source = this.config().sources.find(item => item.id === sourceId);
    if (!source) throw new AssistantAuthorityError(404);
    if (!this.allowed(source, user) || !this.store.pinSourceIdentity(source.id, sourceIdentity(source))) {
      throw new AssistantAuthorityError(403);
    }
    return { source: structuredClone(source), user, stamp: this.stamp(source), deadline: performance.now() + this.requestTimeoutMs, nativeChecks: [] };
  }

  private confirm(scope: RequestScope): void {
    if (this.scope(scope.source.id, scope.user).stamp !== scope.stamp) throw new AssistantAuthorityError(403);
    if (performance.now() >= scope.deadline) throw new AssistantAuthorityError(503);
  }

  private async guarded<T>(scope: RequestScope, read: () => Promise<T>): Promise<T> {
    this.confirm(scope);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AssistantAuthorityError(503)), Math.max(1, scope.deadline - performance.now()));
    });
    try { return await Promise.race([read(), deadline]); }
    finally { clearTimeout(timer); this.confirm(scope); }
  }

  private async serial<T>(sourceId: string, user: string, read: () => Promise<T>): Promise<T> {
    const key = externalKey(sourceId, user);
    const count = this.pendingCount.get(key) ?? 0;
    // One active and one waiting read per actor/source. Browser retries must
    // never create an unbounded queue behind a slow remote Task lookup.
    if (count >= 2) throw new AssistantAuthorityError(503);
    this.pendingCount.set(key, count + 1);
    const previous = this.pending.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(read);
    this.pending.set(key, operation);
    try { return await operation; }
    finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
      const remaining = (this.pendingCount.get(key) ?? 1) - 1;
      if (remaining) this.pendingCount.set(key, remaining); else this.pendingCount.delete(key);
    }
  }

  view(source: SourceConfig, user: string): SourceView {
    let grant: Grant | undefined;
    const configured = assistantReady(source);
    try {
      const scope = this.scope(source.id, user);
      if (this.stamp(source) === scope.stamp) {
        const candidate = this.grants.get(externalKey(source.id, user));
        if (candidate?.stamp === scope.stamp) grant = candidate;
      }
    } catch { /* A stale source or actor never borrows a previous grant. */ }
    const state = grant?.state ?? (configured ? "forbidden" : "unsupported");
    return { id: source.id, kind: "assistant", label: source.label, device: source.device,
      state, lastObservedAt: grant?.observedAt ?? null,
      detail: state === "connected" ? "고정 소유자의 Assistant 읽기 권한을 확인했습니다. 업무 연결은 현재 Projects 권한과 별도로 대조합니다."
        : state === "unsupported" ? "Assistant 전용 metadata 읽기 계약이 아직 연결되지 않았습니다."
        : "현재 Assistant 읽기 권한을 확인하지 못해 실행 metadata를 숨깁니다.",
      capabilities: state === "connected" ? ["executions.read", "events.read"] : [] };
  }

  private client(scope: RequestScope): AssistantReader {
    const source = scope.source;
    return this.clientFactory({ sourceId: source.id, baseUrl: source.baseUrl!,
      credentialFile: source.assistantCredentialFile!, user: scope.user,
      ownerId: source.assistantOwnerId!, principalId: source.assistantPrincipalId!, protocol: source.assistantProtocol ?? 1 });
  }

  private async capabilities(scope: RequestScope, client: AssistantReader): Promise<void> {
    const key = externalKey(scope.source.id, scope.user);
    try {
      const schema = scope.source.assistantProtocol === 2 ? assistantCapabilitiesV2Schema : assistantCapabilitiesSchema;
      const caps = schema.parse(await this.guarded(scope, () => client.capabilities()));
      if (caps.ownerId !== scope.source.assistantOwnerId || caps.principalId !== scope.source.assistantPrincipalId) {
        throw new AssistantAuthorityError(403);
      }
      this.grants.set(key, { stamp: scope.stamp, state: "connected", observedAt: new Date().toISOString() });
    } catch (error) {
      this.grants.delete(key);
      throw error;
    }
  }

  private async request<T>(user: string, sourceId: string,
    read: (scope: RequestScope, client: AssistantReader) => Promise<T>): Promise<T> {
    // Capture before queueing as well: a queued request cannot adopt a rotated reader.
    let scope: RequestScope;
    try { scope = this.scope(sourceId, user); }
    catch (error) { throw safeError(error); }
    return this.serial(sourceId, user, async () => {
      try {
        this.confirm(scope);
        const client = this.client(scope);
        await this.capabilities(scope, client);
        const result = await read(scope, client);
        this.confirm(scope);
        return result;
      } catch (error) {
        const safe = safeError(error);
        const key = externalKey(sourceId, user);
        const current = this.grants.get(key);
        // A missing/denied Task or malformed cursor is not a source-wide native
        // revocation. Keep the capability grant, never the entity metadata.
        if (!([400, 404].includes(safe.status) && current?.stamp === scope.stamp && current.state === "connected")) {
          this.grants.set(key, { stamp: scope.stamp, state: safe.status === 403 ? "forbidden" : "disconnected",
            observedAt: new Date().toISOString() });
        }
        throw safe;
      }
    });
  }

  async refresh(user: string): Promise<void> {
    for (const source of this.config().sources.filter(item => assistantReady(item))) {
      try { await this.request(user, source.id, async () => {}); }
      catch { /* Status only; request() records safe failures. */ }
    }
  }

  private async refreshProjects(scope: RequestScope): Promise<void> {
    await this.guarded(scope, () => this.projects.refresh(scope.user));
  }

  private project(scope: RequestScope, projectId: string) {
    this.confirm(scope);
    const peer = this.config().sources.find(item => item.id === scope.source.assistantProjectsSourceId);
    if (!peer || !projectsReady(peer) || peer.projectsUser !== scope.user || !peer.users.includes(scope.user) ||
        !this.store.pinSourceIdentity(peer.id, sourceIdentity(peer))) throw new AssistantAuthorityError(404);
    const state = this.projects.view(peer, scope.user).state;
    if (state === "disconnected") throw new AssistantAuthorityError(503);
    if (state !== "connected") throw new AssistantAuthorityError(404);
    const project = this.projects.catalog(peer.id, scope.user).find(item => item.id === projectId);
    if (!project) throw new AssistantAuthorityError(404);
    return { peer, project };
  }

  private async currentTask(scope: RequestScope, native: AssistantObservedExecution,
    tasks: Map<string, Promise<CurrentTask>>): Promise<CurrentTask> {
    let currentTask: CurrentTask = null;
    if (native.task) {
      const ref = native.task;
      const key = JSON.stringify([ref.projectId, ref.taskId]);
      let pending = tasks.get(key);
      if (!pending) {
        pending = (async () => {
          const { peer, project } = this.project(scope, ref.projectId);
          try {
            const task = await this.guarded(scope, () => this.projects.client(peer.id, scope.user).task(ref.taskId, ref.projectId));
            if (task.id !== ref.taskId || task.projectId !== ref.projectId) throw new AssistantAuthorityError(503);
            return { projectsSourceId: peer.id,
              projectKey: `project:${createHash("sha256").update(JSON.stringify([peer.id, project.id])).digest("base64url")}`,
              project, task, observedAt: new Date().toISOString() };
          } catch (error) {
            if (error instanceof ProjectsSourceError && [401, 403, 404].includes(error.status)) throw new AssistantAuthorityError(404);
            throw error;
          }
        })();
        tasks.set(key, pending);
      }
      currentTask = await pending;
      this.confirm(scope);
    }
    return currentTask;
  }

  private async projectExecution(scope: RequestScope, native: AssistantObservedExecution,
    tasks: Map<string, Promise<CurrentTask>>): Promise<AssistantExecutionView> {
    const currentTask = await this.currentTask(scope, native, tasks);
    const projected = await this.guarded(scope, () => this.demianLinks.project(scope.user, scope.source,
      { sourceId: scope.source.id, sourceLabel: scope.source.label, device: scope.source.device, native, currentTask }, scope.deadline));
    if (currentTask && projected.view.demianLinks?.state === "connected") {
      const { peer } = this.project(scope, currentTask.project.id);
      try {
        const task = await this.guarded(scope, () => this.projects.client(peer.id, scope.user).task(currentTask!.task.id, currentTask!.project.id));
        if (task.id !== currentTask.task.id || task.projectId !== currentTask.project.id) throw new AssistantAuthorityError(503);
        currentTask.task = task;
        currentTask.observedAt = new Date().toISOString();
      } catch (error) {
        if (error instanceof ProjectsSourceError && [401, 403, 404].includes(error.status)) throw new AssistantAuthorityError(404);
        throw error;
      }
    }
    scope.nativeChecks.push(projected.confirm);
    return projected.view;
  }

  /** Internal collection port. Never publishes producer receipts or native authority keys. */
  async nativeWindow(user: string, sourceId: string, targetSourceId: string,
    cursor: (runId: string) => string): Promise<AssistantNativeWindow> {
    return this.request(user, sourceId, async (scope, client) => {
      const target = this.config().sources.find(item => item.id === targetSourceId);
      const mappings = scope.source.assistantDemianMappings?.filter(item => item.sourceId === targetSourceId) ?? [];
      if (scope.source.assistantProtocol !== 2 || !client.nativeMetadata || !target || target.kind !== "demian" ||
          target.assistantNativeSourceId !== sourceId || !target.users.includes(user) || mappings.length !== 1 ||
          target.baseUrl !== mappings[0]!.origin || target.organizationId !== mappings[0]!.organizationId ||
          !this.store.pinSourceIdentity(target.id, sourceIdentity(target))) throw new AssistantAuthorityError(403);
      const targetStamp = JSON.stringify(target), mapping = mappings[0]!;
      const confirmTarget = () => {
        this.confirm(scope);
        if (JSON.stringify(this.config().sources.find(item => item.id === targetSourceId)) !== targetStamp)
          throw new AssistantAuthorityError(403);
      };
      await this.refreshProjects(scope);
      const window = assistantExecutionPageV2Schema.parse(await this.guarded(scope, () => client.executions(null)));
      const observations: AssistantNativeObservation[] = [], seen = new Set<string>();
      let partial = window.hasMore;
      for (const execution of window.executions) {
        if (!execution.task) continue;
        let task: CurrentTask;
        try { task = await this.currentTask(scope, execution, new Map()); }
        catch (error) { if (error instanceof AssistantAuthorityError && error.status === 404) continue; throw error; }
        if (!task) continue;
        for (const role of execution.roles) {
          const ref = role.runtime.demian;
          if (!ref || ref.origin !== mapping.origin || ref.organizationId !== mapping.organizationId || ref.workspaceId !== mapping.workspaceId) continue;
          if (observations.length >= 64) { partial = true; break; }
          if (seen.has(ref.runId)) throw new AssistantAuthorityError(503);
          seen.add(ref.runId);
          const after = nativeMetadataSequenceSchema.parse(cursor(ref.runId));
          const read = async (position: string, limit: number) => {
            const result = assistantNativeMetadataPageSchema.parse(await this.guarded(scope,
              () => client.nativeMetadata!(execution.id, role.id, position, limit)));
            const run = result.page.run;
            if (result.executionId !== execution.id || result.roleId !== role.id || result.page.events.after !== position || result.page.events.limit !== limit ||
                run.id !== ref.runId || run.session_id !== ref.sessionId || run.workspace_id !== ref.workspaceId ||
                run.organization_id !== ref.organizationId || run.correlation_id !== ref.operationId) throw new AssistantAuthorityError(503);
            confirmTarget(); return result;
          };
          let first: Awaited<ReturnType<typeof read>>;
          try { first = await read(after, 250); }
          catch (error) { if (error instanceof AssistantSourceError && [401, 403, 404].includes(error.status)) continue; throw error; }
          const latest = assistantExecutionMetadataV2Schema.parse(await this.guarded(scope, () => client.execution(execution.id)));
          if (latest.id !== execution.id || latest.task?.projectId !== execution.task.projectId || latest.task.taskId !== execution.task.taskId ||
              JSON.stringify(latest.roles.find(item => item.id === role.id)?.runtime.demian) !== JSON.stringify(ref)) continue;
          const current = await this.currentTask(scope, latest, new Map());
          if (!current) continue;
          // Final signed native read rechecks current binding/key/role authority, not a cached execution row.
          let final: Awaited<ReturnType<typeof read>>;
          try { final = await read(first.page.events.next_after, 1); }
          catch (error) { if (error instanceof AssistantSourceError && [401, 403, 404].includes(error.status)) continue; throw error; }
          for (const pin of ["binding_sha256", "context_sha256", "request_sha256", "acting_user_id", "service_principal_id"] as const)
            if (first.page.run[pin] !== final.page.run[pin]) throw new AssistantAuthorityError(503);
          first.page.run = final.page.run;
          observations.push({ page: first.page, throughSequence: BigInt(final.page.events.through_sequence) > BigInt(first.page.events.through_sequence)
            ? final.page.events.through_sequence : first.page.events.through_sequence, observedAt: final.observedAt,
            title: `Assistant · ${role.label}`.slice(0, 240),
            binding: { sourceId: target.id, runId: ref.runId, projectSourceId: current.projectsSourceId,
              projectId: current.project.id, taskId: current.task.id, taskRevision: execution.task.revision,
              projectTitle: current.project.title, taskTitle: current.task.title, provenance: "source" } });
        }
      }
      await this.finish(scope, client);
      confirmTarget();
      return { observations: observations.filter(item => {
        try { this.project(scope, item.binding.projectId); return true; }
        catch (error) { if (error instanceof AssistantAuthorityError && error.status === 404) return false; throw error; }
      }), partial };
    });
  }

  private async finish(scope: RequestScope, client: AssistantReader): Promise<void> {
    await this.capabilities(scope, client);
    await this.refreshProjects(scope);
    this.confirm(scope);
    for (const confirm of scope.nativeChecks) confirm();
  }

  private confirmProject(scope: RequestScope, execution: AssistantExecutionView): void {
    if (execution.currentTask) {
      execution.currentTask.project = this.project(scope, execution.currentTask.project.id).project;
    }
  }

  async list(user: string, sourceId: string, cursor: string | null = null): Promise<AssistantExecutionListView> {
    return this.request(user, sourceId, async (scope, client) => {
      if (cursor !== null && !z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/).safeParse(cursor).success) {
        throw new AssistantAuthorityError(400);
      }
      await this.refreshProjects(scope);
      const pageSchema = scope.source.assistantProtocol === 2 ? assistantExecutionPageV2Schema : assistantExecutionPageSchema;
      const page = pageSchema.parse(await this.guarded(scope, () => client.executions(cursor)));
      if (new Set(page.executions.map(item => item.id)).size !== page.executions.length ||
          (page.hasMore && page.cursor === cursor)) throw new AssistantAuthorityError(503);
      const tasks = new Map<string, Promise<CurrentTask>>();
      const candidates: AssistantExecutionView[] = [];
      let omitted = page.omitted;
      for (let offset = 0; offset < page.executions.length; offset += 8) {
        const batch = await Promise.all(page.executions.slice(offset, offset + 8).map(async native => {
          try { return await this.projectExecution(scope, native, tasks); }
          catch (error) {
            if (error instanceof AssistantAuthorityError && error.status === 404) return null;
            throw error;
          }
        }));
        for (const candidate of batch) { if (candidate) candidates.push(candidate); else omitted++; }
      }
      await this.finish(scope, client);
      // Recheck even omitted links: a failed final policy read is not evidence
      // of denial, and must not be reported as a successfully filtered window.
      for (const native of page.executions) {
        if (!native.task) continue;
        try { this.project(scope, native.task.projectId); }
        catch (error) {
          if (!(error instanceof AssistantAuthorityError && error.status === 404)) throw error;
        }
      }
      const executions = candidates.filter(execution => {
        try { this.confirmProject(scope, execution); return true; }
        catch (error) {
          if (error instanceof AssistantAuthorityError && error.status === 404) { omitted++; return false; }
          throw error;
        }
      });
      if (!Number.isSafeInteger(omitted)) throw new AssistantAuthorityError(503);
      return { version: 1, sourceId, observedAt: page.observedAt, executions,
        cursor: page.cursor, hasMore: page.hasMore, omitted, complete: false };
    });
  }

  private async latest(scope: RequestScope, client: AssistantReader, id: string): Promise<AssistantExecutionView> {
    if (!z.uuid().safeParse(id).success) throw new AssistantAuthorityError(400);
    const schema = scope.source.assistantProtocol === 2 ? assistantExecutionMetadataV2Schema : assistantExecutionMetadataSchema;
    const native = schema.parse(await this.guarded(scope, () => client.execution(id)));
    if (native.id !== id) throw new AssistantAuthorityError(503);
    return this.projectExecution(scope, native, new Map());
  }

  async detail(user: string, sourceId: string, executionId: string): Promise<AssistantExecutionView> {
    return this.request(user, sourceId, async (scope, client) => {
      await this.refreshProjects(scope);
      const execution = await this.latest(scope, client, executionId);
      await this.finish(scope, client);
      this.confirmProject(scope, execution);
      return execution;
    });
  }

  async events(user: string, sourceId: string, executionId: string, after = "0"): Promise<AssistantExecutionEventsView> {
    return this.request(user, sourceId, async (scope, client) => {
      if (!/^(0|[1-9][0-9]{0,15})$/.test(after) || BigInt(after) > BigInt(Number.MAX_SAFE_INTEGER)) throw new AssistantAuthorityError(400);
      await this.refreshProjects(scope);
      // Authorize against latest native linkage, never a prior list/detail response.
      const execution = await this.latest(scope, client, executionId);
      const schema = scope.source.assistantProtocol === 2 ? assistantExecutionEventsPageV2Schema : assistantExecutionEventsPageSchema;
      const page = schema.parse(await this.guarded(scope, () => client.events(executionId, after)));
      if (page.executionId !== executionId || (page.events.length === 0 ? page.cursor !== after :
        page.events.some(event => BigInt(event.sequence) <= BigInt(after)))) throw new AssistantAuthorityError(503);
      await this.finish(scope, client);
      this.confirmProject(scope, execution);
      return { execution, page };
    });
  }
}
