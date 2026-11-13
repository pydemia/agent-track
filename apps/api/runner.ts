import { setTimeout as delay } from "node:timers/promises";
import { DemianClient, SourceError } from "../../packages/adapters/demian/index.ts";
import { CodexCollector } from "../../packages/adapters/codex/index.ts";
import { terminalStatuses, type SourceView } from "../../packages/contracts/index.ts";
import { externalKey } from "../../packages/contracts/index.ts";
import type { Store } from "../../packages/storage/store.ts";
import type { Config, SourceConfig } from "./config.ts";
import { ProjectsAuthority } from "./projects-authority.ts";
import { projectsReady, sourceIdentity } from "./source-identity.ts";
import { AssistantAuthority } from "./assistant-authority.ts";
import { AssistantDemianLinks } from "./assistant-demian-links.ts";
import { AssistantNativeCollector } from "./assistant-native-collector.ts";
import { filterAssignmentSnapshot } from "./task-assignment.ts";

export class Sources {
  private states = new Map<string, SourceView>();
  private pending = new Map<string, AbortController>();
  private authorizations = new Map<string, Promise<void>>();
  private deniedRevisions = new Map<string, number>();
  private failedRevisions = new Map<string, number>();
  private authorizedIdentities = new Map<string, string>();
  private stopped = false;
  private codex: CodexCollector;
  private shutdown = new AbortController();
  private identities = new Map<string, string>();
  readonly projects: ProjectsAuthority;
  readonly assistant: AssistantAuthority;
  readonly assistantNative: AssistantNativeCollector;

  constructor(private store: Store, private config: () => Config) {
    this.codex = new CodexCollector(store);
    this.projects = new ProjectsAuthority(store, config);
    this.assistant = new AssistantAuthority(store, config, this.projects, undefined, 10_000,
      new AssistantDemianLinks(config, user => filterAssignmentSnapshot(store, store.snapshot(user, this.views(user))),
        user => this.projects.refresh(user)));
    this.assistantNative = new AssistantNativeCollector(store, config, this.assistant);
  }

  async refreshProjectGrants(user: string): Promise<void> {
    await this.projects.refresh(user);
    await this.assistantNative.refresh(user);
  }

  views(user: string): Array<SourceView & { uiBaseUrl?: string }> {
    const config = this.config();
    const singleOwner = config.auth.mode === "proxy" && config.auth.users.length === 1 && config.auth.users[0] === user;
    const canBind = singleOwner && config.sources.some((source) => projectsReady(source) &&
      source.users.includes(user) && this.projects.view(source, user).state === "connected");
    return config.sources.filter((source) => source.users.includes(user)).map((source) => {
      const view = source.assistantNativeSourceId ? this.assistantNative.view(source, user)
        : source.kind === "assistant" ? this.assistant.view(source, user)
        : projectsReady(source) ? this.projects.view(source, user) : this.state(source);
      return { ...view, ...(source.uiBaseUrl ? { uiBaseUrl: source.uiBaseUrl } : {}),
        capabilities: [...view.capabilities,
          ...(canBind && source.kind === "demian" && !source.assistantNativeSourceId && view.state === "connected" ? ["binding.write"] : []),
          ...(singleOwner && source.kind === "demian" && !source.assistantNativeSourceId && view.state === "connected" && source.approvalUsers?.includes(user) ? ["permission.decide"] : []),
          ...(singleOwner && source.kind === "demian" && !source.assistantNativeSourceId && view.state === "connected" && source.cancelUsers?.includes(user) ? ["run.cancel"] : [])] };
    });
  }

  private state(source: SourceConfig): SourceView {
    const identity = this.identity(source);
    const pinned = this.store.pinSourceIdentity(source.id, identity);
    const current = pinned && this.identities.get(source.id) === identity ? this.states.get(source.id) : undefined;
    const localMetadata = source.kind === "codex" && !!source.logRoot && !!source.repositoryRoots.length;
    const native = source.kind === "demian" && !!source.baseUrl;
    return {
      id: source.id, kind: source.kind, label: source.label, device: source.device,
      state: native ? "forbidden" : localMetadata ? "disconnected" : "unsupported",
      lastObservedAt: null,
      detail: !pinned ? "원본 식별/수집 범위가 변경됐습니다. 새 source ID로 등록해야 합니다." : native ? "원본 인가 확인 전입니다. 캐시된 실행도 숨깁니다." : localMetadata ? "로컬 metadata 재수집 대기. 마지막 원장을 표시합니다." : "Track 전용 읽기 계약 또는 수집 경로가 아직 연결되지 않았습니다.",
      capabilities: [], ...current,
      ...(!pinned ? { state: native || localMetadata ? "forbidden" as const : "unsupported" as const, capabilities: [] } : {}),
    };
  }

  private identity(source: SourceConfig): string {
    return sourceIdentity(source);
  }

  private unavailable(source: SourceConfig): void {
    // A transport failure is not a fresh grant and cannot undo a known denial.
    // Keep stale data only after this process validated the entire native scope.
    const authorized = this.authorizedIdentities.get(source.id) === this.identity(source);
    this.states.set(source.id, { ...this.state(source), state: authorized ? "disconnected" : "forbidden",
      ...(!authorized ? { capabilities: [] } : {}),
      detail: authorized ? "원본 연결 실패. 마지막 관측을 보존하고 재시도합니다."
        : "원본 연결 실패로 인가를 확인하지 못했습니다. 캐시된 실행은 숨기고 재시도합니다." });
  }

  private deny(source: SourceConfig, detail: string): void {
    this.deniedRevisions.set(source.id, (this.deniedRevisions.get(source.id) ?? 0) + 1);
    this.authorizedIdentities.delete(source.id);
    // Previously opened streams cannot serve as post-denial authorization.
    for (const [key, controller] of this.pending) if (key.startsWith(`${source.id}/`)) controller.abort();
    this.states.set(source.id, { ...this.state(source), state: "forbidden", capabilities: [], detail });
  }

  async start(): Promise<void> {
    while (!this.stopped) {
      try {
        const config = this.config();
        for (const source of config.sources) {
          const identity = this.identity(source);
          if (!this.store.pinSourceIdentity(source.id, identity)) {
            this.authorizedIdentities.delete(source.id);
            for (const [key, controller] of this.pending) if (key.startsWith(`${source.id}/`)) controller.abort();
            continue;
          }
          this.identities.set(source.id, identity);
          if (source.kind === "codex" && source.logRoot && source.repositoryRoots.length) {
            try {
              const report = await this.codex.collect({ sourceId: source.id, logRoot: source.logRoot,
                repositoryRoots: source.repositoryRoots, maxFiles: source.maxFiles, sinceDays: source.sinceDays });
              this.states.set(source.id, { ...this.state(source), state: "connected", lastObservedAt: new Date().toISOString(),
                capabilities: ["run.read", "events.read"],
                detail: `로컬 metadata ${report.files}개 파일, 최근 ${source.sinceDays}일. 제한/크기로 제외 ${report.skipped}개. 대화·도구 입출력 제외. desktop/Demian native 연동과 별개입니다.` });
            } catch { this.states.set(source.id, { ...this.state(source), state: "disconnected", detail: "로컬 metadata 수집 실패. 원본을 변경하지 않고 다시 확인합니다." }); }
            continue;
          }
          if (source.assistantNativeSourceId) {
            for (const user of source.users) await this.assistantNative.refresh(user, source.id);
            continue;
          }
          if (source.kind !== "demian" || !source.baseUrl) continue;
          const client = new DemianClient({ sourceId: source.id, baseUrl: source.baseUrl,
            ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
            ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
            ...(source.organizationId ? { organizationId: source.organizationId } : {}) });
          try {
            const deniedRevision = this.deniedRevisions.get(source.id) ?? 0;
            const failedRevision = this.failedRevisions.get(source.id) ?? 0;
            const known = this.store.db.prepare("SELECT run_id FROM runs WHERE source_id=?").all(source.id).map((r) => String(r.run_id));
            const discovery = source.discoverActive || source.discoverHistory ? await client.discoverRuns({
              history: source.discoverHistory ?? false, maxPages: source.historyPageLimit ?? 4,
              cursor: (sessionId) => String(this.store.db.prepare("SELECT value FROM metadata WHERE key=?")
                .get(`message_cursor:${externalKey(source.id, sessionId)}`)?.value ?? "0"),
            }) : { runIds: [], cursors: new Map<string, string>(), sessions: 0, incompleteSessions: 0 };
            const runIds = new Set([...source.runIds, ...known, ...discovery.runIds]);
            if (!runIds.size && !source.discoverActive && !source.discoverHistory) {
              if (!source.assignmentSessionIds?.length) {
                this.authorizedIdentities.delete(source.id);
                this.states.set(source.id, { ...this.state(source), state: "forbidden", capabilities: [],
                  detail: "조회할 Run 또는 Session 범위가 지정되지 않았습니다. 원본 인가를 확인하기 전입니다." });
                continue;
              }
              // An explicitly scoped existing Session can accept its first Run.
              // Do not fabricate a connected state merely because the Run set is empty.
              for (const sessionId of source.assignmentSessionIds) await client.verifySessionAccess(sessionId);
            }
            for (const runId of runIds) {
              const observation = await client.observe(runId);
              const key = `${source.id}/${runId}`;
              if (this.pending.get(key)?.signal.aborted) {
                this.pending.delete(key); this.authorizations.delete(key);
              }
              const reuseStream = this.pending.has(key);
              if (!this.pending.has(key)) {
                const controller = new AbortController();
                this.pending.set(key, controller);
                let authorize!: () => void;
                let rejectAuthorization!: (error: unknown) => void;
                const authorization = new Promise<void>((resolve, reject) => { authorize = resolve; rejectAuthorization = reject; });
                this.authorizations.set(key, authorization);
                // A bounded stream refreshes authorization and snapshots each cycle.
                const timeout = setTimeout(() => controller.abort(), terminalStatuses.has(observation.status) ? 5000 : 30_000);
                void client.stream(runId, this.store.cursor(source.id, runId), (event) => this.store.ingest(event), controller.signal, () => {
                  if (controller.signal.aborted || this.pending.get(key) !== controller ||
                      (this.deniedRevisions.get(source.id) ?? 0) !== deniedRevision) throw new Error("Source authorization superseded");
                  // Stage newly discovered metadata until the event read is authorized.
                  // This also creates the Run before the first synchronous SSE event ingest.
                  this.store.observeRun(observation); authorize();
                })
                  .catch((error: unknown) => {
                    rejectAuthorization(error);
                    if (this.pending.get(key) !== controller) return;
                    if (error instanceof SourceError && [401, 403, 404].includes(error.status)) {
                      this.deny(source, "원본 접근이 거부되거나 철회됐습니다.");
                    } else if (!controller.signal.aborted) {
                      this.failedRevisions.set(source.id, (this.failedRevisions.get(source.id) ?? 0) + 1);
                      this.unavailable(source);
                    }
                  }).finally(() => {
                    clearTimeout(timeout);
                    if (this.pending.get(key) === controller) { this.pending.delete(key); this.authorizations.delete(key); }
                  });
              }
              // A late allowed stream must never reopen another Run's denied cache.
              // Publish connected only after the entire source scope passes both reads.
              await this.authorizations.get(key);
              if (reuseStream) this.store.observeRun(observation);
            }
            if ((this.deniedRevisions.get(source.id) ?? 0) !== deniedRevision) throw new SourceError(403);
            if ((this.failedRevisions.get(source.id) ?? 0) !== failedRevision) throw new Error("Source stream failed during observation");
            // Commit discovery cursors only after every discovered Run was authorized and observed.
            for (const [sessionId, cursor] of discovery.cursors) this.store.db.prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
              .run(`message_cursor:${externalKey(source.id, sessionId)}`, cursor);
            this.authorizedIdentities.set(source.id, identity);
            this.states.set(source.id, { ...this.state(source), state: "connected", lastObservedAt: new Date().toISOString(),
              detail: !runIds.size ? "원본 조회 성공. 현재 발견된 Run이 없습니다." : source.discoverHistory
                ? `허용된 ${discovery.sessions}개 세션의 현재 Run·메시지 메타데이터에서 찾은 실행. 부분 이력 ${discovery.incompleteSessions}개 세션. 전역 과거 Run feed와 별개입니다.`
                : "명시된 Run 및 허용한 세션의 현재 Run 조회. 전체 과거 실행 feed는 제공되지 않습니다.", capabilities: ["run.read", "events.read", "session.link"] });
          } catch (error) {
            const forbidden = error instanceof SourceError && [401, 403, 404].includes(error.status);
            if (forbidden) {
              this.deny(source, "원본 인증/조회 권한이 필요합니다. 캐시된 실행도 숨깁니다.");
            } else this.unavailable(source);
          }
        }
      } catch { /* Invalid/revoked config is fail-closed by every API authorization. */ }
      await delay(10_000, undefined, { signal: this.shutdown.signal }).catch(() => {});
    }
  }

  stop(): void { this.stopped = true; this.shutdown.abort(); for (const controller of this.pending.values()) controller.abort(); }
}
