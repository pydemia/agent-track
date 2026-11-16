import { ReadDiagnostics, readFailureStatus, type ReadTrace } from "./read-diagnostics.ts";
import { AssistantAuthority, AssistantAuthorityError } from "./assistant-authority.ts";
import type { Config, SourceConfig } from "./config.ts";
import { assistantReady, sourceIdentity } from "./source-identity.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { SourceView } from "../../packages/contracts/index.ts";
import { normalizeEvent } from "../../packages/adapters/demian/index.ts";

interface Grant { stamp: string; observedAt: string; runIds: string[]; partial: boolean; attemptCoverage: "coordinator-history" | "current-role-only" }
interface Admission { ready: Promise<void>; release: () => void }
const grantLifetimeMs = 15_000, readBudgetMs = 10_000, admissionReserveMs = 1_000;

/** Protected native observations use only the owner-bound Assistant reader, never executor keys. */
export class AssistantNativeCollector {
  private grants = new Map<string, Grant>();
  private jobs = new Map<string, Promise<void>>();
  private jobTraces = new Map<string, ReadTrace>();
  private failures = new Map<string, SourceView["state"]>();
  private admissions = new Map<string, Promise<void>>();
  constructor(private store: Store, private config: () => Config, private assistant: AssistantAuthority, private diagnostics?: ReadDiagnostics) {}

  private stamp(source: SourceConfig, user: string): string {
    const config = this.config(), current = config.sources.find(item => item.id === source.id);
    const producer = config.sources.find(item => item.id === source.assistantNativeSourceId);
    if (JSON.stringify(current) !== JSON.stringify(source) || source.kind !== "demian" || !source.assistantNativeSourceId ||
        !source.users.includes(user) || !producer || !assistantReady(producer) || producer.assistantUser !== user ||
        !producer.users.includes(user) || producer.assistantProtocol !== 2 ||
        !(config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user) ||
        !this.store.pinSourceIdentity(source.id, sourceIdentity(source))) throw new AssistantAuthorityError(403);
    return JSON.stringify([source, producer, config.auth,
      config.sources.find(item => item.id === producer.assistantProjectsSourceId)]);
  }

  view(source: SourceConfig, user: string): SourceView {
    let grant: Grant | undefined;
    try {
      const stamp = this.stamp(source, user), candidate = this.grants.get(source.id);
      if (candidate?.stamp === stamp && Date.now() - Date.parse(candidate.observedAt) < grantLifetimeMs &&
          this.assistant.view(this.config().sources.find(item => item.id === source.assistantNativeSourceId)!, user).state === "connected") grant = candidate;
    } catch { /* No previous actor, source or policy can authorize a cached Run. */ }
    return { id: source.id, kind: "demian", label: source.label, device: source.device,
      state: grant ? "connected" : this.failures.get(source.id) === "disconnected" ? "disconnected" : "forbidden",
      authorizedRunIds: grant?.runIds ?? [], lastObservedAt: grant?.observedAt ?? null,
      capabilities: grant ? ["run.read", "events.read", "run.evidence"] : [],
      detail: grant ? `Assistant에서 현재 인가한 실행 metadata. ${grant.attemptCoverage === "coordinator-history" ? "역할별 보존 시도 포함" : "과거 시도 조회 미지원: 현재 역할의 Run만"}. 최근 업무 50개·실행 64개·실행별 이벤트 250개 조회 창${grant.partial ? "(일부 업무 제외)" : ""}. 전체 이력·도구 입출력·실행 제어와 별개입니다.`
        : "보호된 실행의 현재 Assistant/Projects 인가를 확인하지 못했습니다. 저장된 실행도 숨깁니다." };
  }

  /** Leave the existing read budget inside the metadata lease; never extend it. */
  hasFreshReadView(source: SourceConfig, user: string): boolean {
    const view = this.view(source, user), age = view.lastObservedAt ? Date.now() - Date.parse(view.lastObservedAt) : Number.NaN;
    return view.state === "connected" && age >= 0 && age < grantLifetimeMs - readBudgetMs - admissionReserveMs;
  }

  async refresh(user: string, sourceId?: string): Promise<void> {
    for (const source of this.config().sources.filter(item => item.assistantNativeSourceId && (!sourceId || item.id === sourceId) && item.users.includes(user))) {
      const id = source.id;
      const refreshTrace = this.diagnostics?.begin(source, user, "native.refresh");
      let job = this.jobs.get(id);
      if (!job) {
        const admission = this.admit([id]);
        const trace = this.diagnostics?.begin(source, user, "native.collect", refreshTrace?.id);
        if (trace) this.jobTraces.set(id, trace);
        job = (trace ? trace.measure("native.admission", () => admission.ready) : admission.ready)
          .then(() => this.collect(source, user, trace)).finally(admission.release);
        this.jobs.set(id, job);
        void job.finally(() => { if (this.jobs.get(id) === job) { this.jobs.delete(id); this.jobTraces.delete(id); } });
      }
      const joinedTrace = this.jobTraces.get(id);
      refreshTrace?.related(joinedTrace?.id);
      try { await (refreshTrace ? refreshTrace.measure("native.window", () => job!) : job); refreshTrace?.finish(joinedTrace?.observation.status ?? 200, false, joinedTrace?.observation.grantState ?? undefined); }
      catch (error) { refreshTrace?.finish(readFailureStatus(error)); throw error; }
    }
  }

  /** Excludes collection mutations until the bounded, read-only evidence callback settles. */
  async withStableView<T>(user: string, sourceId: string, read: () => Promise<T>, deadline = performance.now() + 10_000): Promise<T> {
    return this.stableViews(user, [sourceId], read, deadline, true);
  }

  /** Acquire all selected windows together, before entering the shared Assistant reader queue. */
  async withStableViews<T>(user: string, sourceIds: readonly string[], read: () => Promise<T>, deadline = performance.now() + 10_000): Promise<T> {
    return this.stableViews(user, sourceIds, read, deadline, false);
  }

  private async stableViews<T>(user: string, sourceIds: readonly string[], read: () => Promise<T>, deadline: number, strict: boolean): Promise<T> {
    const selected = new Set(sourceIds);
    const admission = this.admit(this.selectedSources(user, sourceIds));
    try {
      await this.waitForAdmission(admission, deadline);
      const config = this.config();
      if (!(config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user))
        throw new AssistantAuthorityError(403);
      for (const source of config.sources.filter(source => selected.has(source.id) && source.assistantNativeSourceId && source.users.includes(user))) {
        try { this.stamp(source, user); }
        catch (error) { if (strict) throw error; }
      }
      return await read();
    } finally { admission.release(); }
  }

  private selectedSources(user: string, sourceId?: string | readonly string[]): string[] {
    const selected = sourceId === undefined ? null : new Set(typeof sourceId === "string" ? [sourceId] : sourceId);
    return this.config().sources.filter(source => source.assistantNativeSourceId && (!selected || selected.has(source.id)) && source.users.includes(user)).map(source => source.id);
  }

  /** Reserve the handoff synchronously so a later collection cannot overtake a waiting reader. */
  private admit(sourceIds: readonly string[]): Admission {
    const ids = [...new Set(sourceIds)].sort();
    const ready = Promise.all(ids.map(id => this.admissions.get(id) ?? Promise.resolve())).then(() => {});
    let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; });
    // An admission cancelled before its turn still waits for its predecessors.
    const tail = ready.then(() => done);
    for (const id of ids) this.admissions.set(id, tail);
    void tail.then(() => { for (const id of ids) if (this.admissions.get(id) === tail) this.admissions.delete(id); });
    return { ready, release };
  }

  private async waitForAdmission(admission: Admission, deadline: number): Promise<void> {
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new AssistantAuthorityError(503);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([admission.ready, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AssistantAuthorityError(503)), remaining);
      })]);
    } finally { clearTimeout(timer); }
    if (performance.now() >= deadline) throw new AssistantAuthorityError(503);
  }

  /** Capture after preceding collection; later collection waits for this synchronous read. */
  async afterRefresh<T>(user: string, read: () => T, deadline = performance.now() + 10_000, sourceId?: string | readonly string[]): Promise<T> {
    const admission = this.admit(this.selectedSources(user, sourceId));
    try { await this.waitForAdmission(admission, deadline); return read(); }
    finally { admission.release(); }
  }

  private async collect(source: SourceConfig, user: string, trace?: ReadTrace): Promise<void> {
    // Refresh cannot expose a previous grant while a current check is in flight.
    this.grants.delete(source.id);
    let finishPersist: ((status?: number) => void) | undefined;
    try {
      const stamp = this.stamp(source, user);
      const read = () => this.assistant.nativeWindow(user, source.assistantNativeSourceId!, source.id,
        runId => this.store.cursor(source.id, runId), trace?.id);
      const window = await (trace ? trace.measure("native.window", read) : read());
      trace?.observations(window.observations.length);
      finishPersist = trace?.step("native.persist");
      if (this.stamp(source, user) !== stamp) throw new AssistantAuthorityError(403);
      for (const observation of window.observations) {
        const { page, binding } = observation, run = page.run;
        const key = this.store.observeRun({ sourceId: source.id, runId: run.id, sessionId: run.session_id,
          workspaceId: run.workspace_id, title: observation.title, status: run.status,
          createdAt: run.created_at, startedAt: run.started_at, completedAt: run.completed_at, observedAt: observation.observedAt,
          ...(observation.assistantAttempt ? { assistantAttempt: observation.assistantAttempt } : {}) });
        const previous = this.store.run(key)?.binding;
        if (previous) {
          const old = JSON.parse(previous);
          if (old.projectSourceId !== binding.projectSourceId || old.projectId !== binding.projectId || old.taskId !== binding.taskId)
            throw new AssistantAuthorityError(403);
        } else this.store.bind(binding, user);
        for (const event of page.events.data) {
          // Unknown producer event names stay observable without admitting arbitrary type grammar.
          const type = /^[a-z][a-z0-9_.-]{0,119}$/.test(event.type) ? event.type : "unknown";
          this.store.ingest(normalizeEvent(source.id, { ...event, type }));
        }
        this.store.observeEventBoundary(source.id, run.id, observation.throughSequence);
      }
      if (this.stamp(source, user) !== stamp) throw new AssistantAuthorityError(403);
      this.grants.set(source.id, { stamp, observedAt: new Date().toISOString(),
        runIds: window.observations.map(item => item.page.run.id), partial: window.partial,
        attemptCoverage: window.attemptCoverage ?? "current-role-only" });
      this.failures.delete(source.id);
      finishPersist?.();
      trace?.finish(200, false, "connected");
    } catch (error) {
      finishPersist?.(readFailureStatus(error));
      trace?.finish(readFailureStatus(error), false, error instanceof AssistantAuthorityError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected");
      this.grants.delete(source.id);
      this.failures.set(source.id, error instanceof AssistantAuthorityError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected");
    }
  }
}
