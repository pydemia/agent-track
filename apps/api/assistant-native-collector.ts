import { AssistantAuthority, AssistantAuthorityError } from "./assistant-authority.ts";
import type { Config, SourceConfig } from "./config.ts";
import { assistantReady, sourceIdentity } from "./source-identity.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { SourceView } from "../../packages/contracts/index.ts";
import { normalizeEvent } from "../../packages/adapters/demian/index.ts";

interface Grant { stamp: string; observedAt: string; runIds: string[]; partial: boolean; attemptCoverage: "coordinator-history" | "current-role-only" }

/** Protected native observations use only the owner-bound Assistant reader, never executor keys. */
export class AssistantNativeCollector {
  private grants = new Map<string, Grant>();
  private jobs = new Map<string, Promise<void>>();
  private failures = new Map<string, SourceView["state"]>();
  constructor(private store: Store, private config: () => Config, private assistant: AssistantAuthority) {}

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
      if (candidate?.stamp === stamp && Date.now() - Date.parse(candidate.observedAt) < 15_000 &&
          this.assistant.view(this.config().sources.find(item => item.id === source.assistantNativeSourceId)!, user).state === "connected") grant = candidate;
    } catch { /* No previous actor, source or policy can authorize a cached Run. */ }
    return { id: source.id, kind: "demian", label: source.label, device: source.device,
      state: grant ? "connected" : this.failures.get(source.id) === "disconnected" ? "disconnected" : "forbidden",
      authorizedRunIds: grant?.runIds ?? [], lastObservedAt: grant?.observedAt ?? null,
      capabilities: grant ? ["run.read", "events.read", "run.evidence"] : [],
      detail: grant ? `Assistant에서 현재 인가한 실행 metadata. ${grant.attemptCoverage === "coordinator-history" ? "역할별 보존 시도 포함" : "과거 시도 조회 미지원: 현재 역할의 Run만"}. 최근 업무 50개·실행 64개·실행별 이벤트 250개 조회 창${grant.partial ? "(일부 업무 제외)" : ""}. 전체 이력·도구 입출력·실행 제어와 별개입니다.`
        : "보호된 실행의 현재 Assistant/Projects 인가를 확인하지 못했습니다. 저장된 실행도 숨깁니다." };
  }

  async refresh(user: string, sourceId?: string): Promise<void> {
    for (const source of this.config().sources.filter(item => item.assistantNativeSourceId && (!sourceId || item.id === sourceId) && item.users.includes(user))) {
      let job = this.jobs.get(source.id);
      if (!job) {
        job = this.collect(source, user); this.jobs.set(source.id, job);
        void job.finally(() => { if (this.jobs.get(source.id) === job) this.jobs.delete(source.id); });
      }
      await job;
    }
  }

  /** Capture a fresh view after pending collection, never a revoked or in-flight grant. */
  async afterRefresh<T>(user: string, read: () => T, deadline = performance.now() + 10_000): Promise<T> {
    for (;;) {
      const pending = [...new Set(this.config().sources.filter(source => source.assistantNativeSourceId && source.users.includes(user))
        .flatMap(source => { const job = this.jobs.get(source.id); return job ? [job] : []; }))];
      if (!pending.length) return read();
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new AssistantAuthorityError(503);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(pending),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AssistantAuthorityError(503)), remaining); }),
        ]);
      } finally { clearTimeout(timer); }
      // A second refresh may have started while the previous one settled.
      // Read synchronously only once no currently relevant check is pending.
    }
  }

  private async collect(source: SourceConfig, user: string): Promise<void> {
    // Refresh cannot expose a previous grant while a current check is in flight.
    this.grants.delete(source.id);
    try {
      const stamp = this.stamp(source, user);
      const window = await this.assistant.nativeWindow(user, source.assistantNativeSourceId!, source.id,
        runId => this.store.cursor(source.id, runId));
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
    } catch (error) {
      this.grants.delete(source.id);
      this.failures.set(source.id, error instanceof AssistantAuthorityError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected");
    }
  }
}
