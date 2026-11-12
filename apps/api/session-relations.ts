import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { DemianClient, SourceError, type DemianOptions } from "../../packages/adapters/demian/index.ts";
import { CommandError } from "../../packages/commands/index.ts";
import type { RunView, Snapshot } from "../../packages/contracts/index.ts";
import { relationUuidSchema, sessionRelationKindSchema, sessionRelationsEvidenceSchema,
  type SessionRelationKind, type SessionRelationsEvidence } from "../../packages/contracts/session-relations.ts";
import type { Config } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";
import { sourceCredentialStamp as credentialStamp } from "./source-credential.ts";

type Reader = Pick<DemianClient, "observe" | "sessionRelations">;
const missing = () => new CommandError(404, "run_not_found", "현재 접근 가능한 실행이 아닙니다.");
const invalid = () => new CommandError(400, "invalid_relation_cursor", "관계 조회 창을 처음부터 다시 확인하세요.");

/** Opaque per-process continuations: native hidden Run IDs never enter a browser cursor. */
export class SessionRelationCursors {
  private key = randomBytes(32);
  constructor(private now: () => number = Date.now) {}
  encode(after: string, scope: string): string {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(scope));
    const payload = JSON.stringify({ after: relationUuidSchema.parse(after), expiresAt: this.now() + 15 * 60_000 });
    const body = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
  }
  decode(value: string | null, scope: string): string | null {
    if (value === null) return null;
    try {
      if (!/^[A-Za-z0-9_-]{40,1024}$/.test(value)) throw invalid();
      const bytes = Buffer.from(value, "base64url");
      if (bytes.toString("base64url") !== value) throw invalid();
      const decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(bytes.subarray(12, 28));
      const plain = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
      const payload = z.object({ after: relationUuidSchema, expiresAt: z.number().int().safe() }).strict().parse(JSON.parse(plain.toString("utf8")));
      if (payload.expiresAt <= this.now() || payload.expiresAt > this.now() + 15 * 60_000) throw invalid();
      return payload.after;
    } catch { throw invalid(); }
  }
}

/** Live session receipt metadata, intersected with both initial and final Track Run/Project visibility. */
export class SessionRelations {
  private cursors = new SessionRelationCursors();
  constructor(private config: () => Config, private snapshot: (user: string) => Snapshot,
    private refreshGrants: (user: string) => Promise<void>,
    private factory: (options: DemianOptions) => Reader = options => new DemianClient(options),
    private timeoutMs = 10_000) {
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new Error("Invalid relation read deadline");
  }

  private authorized(user: string, key: string) {
    const config = this.config(), view = this.snapshot(user);
    if (!(config.auth.mode === "proxy" ? config.auth.users.includes(user) : config.auth.user === user)) throw missing();
    const run = view.runs.find(item => item.key === key);
    const source = config.sources.find(item => item.id === run?.sourceId && item.users.includes(user));
    if (!run || !source) throw missing();
    const connected = view.sources.some(item => item.id === source.id && item.kind === source.kind && item.state === "connected");
    const canRead = (item: RunView) => {
      const binding = item.binding;
      return connected && item.sourceId === source.id && item.sessionId === run.sessionId && item.sourceState === "connected" &&
        !item.stale && (!binding || binding.sourceId === item.sourceId && binding.runId === item.runId && view.sources.some(project =>
          project.id === binding.projectSourceId && project.kind === "projects" && project.state === "connected" && project.authorizedProjectIds?.includes(binding.projectId)));
    };
    if (run.binding && !canRead(run)) throw missing();
    const allowed = new Set(view.runs.filter(canRead).map(item => item.runId));
    const stamp = JSON.stringify([sourceIdentity(source), source.tokenFile, source.credentialFormat, source.users, config.auth]);
    const projects = view.sources.filter(item => item.kind === "projects").map(item => [item.id, item.state, [...(item.authorizedProjectIds ?? [])].sort()]).sort();
    return { run, source: structuredClone(source), allowed, stamp, projects };
  }

  async read(user: string, key: string, kind: SessionRelationKind, cursor: string | null = null, external?: AbortSignal): Promise<SessionRelationsEvidence> {
    const deadline = performance.now() + this.timeoutMs;
    sessionRelationKindSchema.parse(kind);
    const initial = this.authorized(user, key), { run, source } = initial;
    const empty = (state: SessionRelationsEvidence["state"], detail: string): SessionRelationsEvidence => ({
      runKey: key, sourceId: source.id, sessionId: run.sessionId, kind, state, relations: [], nextCursor: null,
      hasMore: false, omitted: 0, coverage: kind === "managed-children" ? "managed-child-receipts" : "peer-processing-receipts",
      observedAt: new Date().toISOString(), detail,
    });
    if (source.kind !== "demian" || !source.baseUrl) return empty("unsupported", "이 출처의 세션 관계 조회는 지원하지 않습니다.");
    if (run.sourceState !== "connected" || run.stale) return empty("disconnected", "원본의 현재 접근을 확인한 뒤 세션 관계를 조회합니다.");
    const controller = new AbortController();
    const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - performance.now()));
    const abort = () => { throw new SourceError(503); };
    let stop!: () => void;
    const ended = new Promise<never>((_, reject) => { stop = () => reject(new SourceError(503)); signal.addEventListener("abort", stop, { once: true }); });
    const guarded = async <T>(read: () => Promise<T>): Promise<T> => {
      if (signal.aborted || performance.now() >= deadline) return abort();
      const value = await Promise.race([read(), ended]);
      if (signal.aborted || performance.now() >= deadline) return abort();
      return value;
    };
    try {
      await guarded(() => this.refreshGrants(user));
      const before = this.authorized(user, key);
      if (before.stamp !== initial.stamp || before.run.sessionId !== run.sessionId || !before.allowed.has(run.runId)) throw missing();
      const credential = credentialStamp(source);
      const scope = JSON.stringify([user, key, run.sessionId, kind, initial.stamp, credential, before.projects]);
      const after = this.cursors.decode(cursor, scope);
      const client = this.factory({ sourceId: source.id, baseUrl: source.baseUrl,
        ...(source.tokenFile ? { tokenFile: source.tokenFile } : {}),
        ...(source.credentialFormat ? { credentialFormat: source.credentialFormat } : {}),
        ...(source.organizationId ? { organizationId: source.organizationId } : {}), signal });
      const check = (value: Awaited<ReturnType<Reader["observe"]>>) => {
        if (value.runId !== run.runId || value.sessionId !== run.sessionId) throw new SourceError(403);
      };
      check(await guarded(() => client.observe(run.runId)));
      const page = await guarded(() => client.sessionRelations(run.sessionId, kind, after, 250));
      if (page.sessionId !== run.sessionId || page.kind !== kind) throw new SourceError(403);
      check(await guarded(() => client.observe(run.runId)));
      await guarded(() => this.refreshGrants(user));
      const final = this.authorized(user, key);
      if (final.stamp !== initial.stamp || final.run.sessionId !== run.sessionId || final.run.sourceState !== "connected" ||
          final.run.stale || credentialStamp(final.source) !== credential) throw missing();
      if (page.availability !== "available") return empty(page.availability, page.availability === "unconfigured"
        ? "원본 peer 처리 registry가 구성되지 않았습니다. 처리 관계가 없다는 뜻은 아닙니다."
        : "원본의 선택적 관계 저장 스키마가 지원되지 않습니다.");
      const rows = page.relations.filter(row => before.allowed.has(row.runId) && final.allowed.has(row.runId));
      const result = sessionRelationsEvidenceSchema.parse({ ...empty("connected", "현재 인가된 세션의 처리 영수증 범위입니다. 전체 원격 peer 목록이나 실행 의존 관계를 뜻하지 않습니다."),
        relations: rows, omitted: page.relations.length - rows.length, hasMore: page.hasMore,
        nextCursor: page.hasMore && page.nextCursor ? this.cursors.encode(page.nextCursor, scope) : null });
      if (signal.aborted || performance.now() >= deadline) return abort();
      return result;
    } catch (error) {
      if (error instanceof CommandError) throw error;
      this.authorized(user, key);
      return empty(error instanceof SourceError && [401, 403, 404].includes(error.status) ? "forbidden" : "disconnected",
        "현재 원본 관계와 조회 범위를 확인하지 못해 이전 관계 근거도 숨깁니다.");
    } finally { clearTimeout(timer); signal.removeEventListener("abort", stop); }
  }
}
