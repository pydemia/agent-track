import { createHash } from "node:crypto";
import { z } from "zod";
import { timestampSchema, type ProjectTaskMetadata } from "../contracts/index.ts";
import type { Store } from "../storage/store.ts";
import { CommandError } from "./index.ts";

export const createTaskInputSchema = z.object({
  id: z.uuid(), sourceId: z.string().regex(/^[a-z0-9_-]{1,80}$/), projectId: z.uuid(),
  title: z.string().min(1).max(300).refine((value) => value.trim().length > 0),
  body: z.string().max(5000), acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20),
  requiresTest: z.boolean(), expiresAt: timestampSchema,
}).strict().refine((input) => Buffer.byteLength(JSON.stringify(input), "utf8") <= 8192, "Task draft exceeds the request limit");
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type TaskCreationState = "requested" | "dispatching" | "created" | "failed" | "expired" | "unknown";
export interface TaskCreationReceipt {
  id: string; actor: string; sourceId: string; projectId: string; state: TaskCreationState;
  taskId: string | null; taskRevision: string | null; createdAt: string; updatedAt: string;
}
export interface NativeTaskCreation {
  operationId: string; requestBodySha256: string; task: ProjectTaskMetadata;
}
export interface CreateTaskPorts {
  /** Fresh native writer policy + reader Project grant; identity pins the writer/account/origin. */
  authorize(): Promise<{ identity: string; sourceId: string; projectId: string }>;
  prepare(input: CreateTaskInput): { requestBodySha256: string };
  create(input: CreateTaskInput): Promise<NativeTaskCreation>;
  lookup(id: string, projectId: string, requestBodySha256: string): Promise<NativeTaskCreation | null>;
  now?: () => number;
}
/** Only an authoritative native rejection. Transport or invalid success responses remain unknown. */
export class TaskCreationRejected extends Error {}
/** Adapter proved that the local deadline passed before any mutation was sent. */
export class TaskCreationExpired extends Error {}
interface Row {
  actor: string; id: string; source_id: string; project_id: string; request_digest: string;
  source_identity: string; body_sha256: string; state: TaskCreationState;
  task_id: string | null; task_revision: string | null; created_at: string; updated_at: string;
}
const terminal = new Set<TaskCreationState>(["created", "failed", "expired"]);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Receipt journal stores identifiers/hashes only. Draft text stays in the submitting client. */
export class TaskCreationService {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_creation_receipts (
      actor TEXT NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL, project_id TEXT NOT NULL,
      request_digest TEXT NOT NULL, source_identity TEXT NOT NULL, body_sha256 TEXT NOT NULL,
      state TEXT NOT NULL, task_id TEXT, task_revision TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(actor,id)
    )`);
  }

  async execute(actor: string, raw: unknown, ports: CreateTaskPorts): Promise<TaskCreationReceipt> {
    const parsed = createTaskInputSchema.safeParse(raw);
    if (!parsed.success || !actor.trim()) throw new CommandError(400, "invalid_task_draft", "업무 초안·요청 ID·기한을 확인해 주세요.");
    const input = parsed.data;
    const binding = await this.authorize(ports, input.sourceId, input.projectId);
    const digest = hash(input);
    const prepared = ports.prepare(input);
    if (!/^[a-f0-9]{64}$/.test(prepared.requestBodySha256)) throw new CommandError(502, "invalid_task_request", "원본 업무 요청을 구성하지 못했습니다.");
    const old = this.find(actor, input.id);
    if (old) return this.replay(old, digest, binding.identity, prepared.requestBodySha256);
    const now = (ports.now ?? Date.now)();
    const expires = Date.parse(input.expiresAt);
    if (expires > now + 120_000) throw new CommandError(400, "invalid_deadline", "요청 기한은 120초 이내여야 합니다.");
    const timestamp = new Date(now).toISOString();
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const concurrent = this.find(actor, input.id);
      if (concurrent) {
        const receipt = this.replay(concurrent, digest, binding.identity, prepared.requestBodySha256);
        this.store.db.exec("COMMIT"); return receipt;
      }
      if (expires > now && this.store.db.prepare(`SELECT id FROM task_creation_receipts WHERE actor=? AND source_id=? AND project_id=?
          AND state IN ('requested','dispatching','unknown') LIMIT 1`).get(actor, input.sourceId, input.projectId)) {
        throw new CommandError(409, "task_creation_pending", "이 프로젝트의 생성 결과를 먼저 확인해 주세요. 초안은 유지됩니다.");
      }
      this.store.db.prepare(`INSERT INTO task_creation_receipts
        (actor,id,source_id,project_id,request_digest,source_identity,body_sha256,state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(actor, input.id, input.sourceId, input.projectId, digest, binding.identity,
          prepared.requestBodySha256, expires <= now ? "expired" : "requested", timestamp, timestamp);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    let row = this.find(actor, input.id)!;
    if (row.state === "expired") return this.view(row);
    try {
      const current = await this.authorize(ports, input.sourceId, input.projectId);
      if (current.identity !== row.source_identity) throw new Error();
    } catch {
      this.set(row, "failed");
      throw new CommandError(403, "source_forbidden", "업무 전송 전 원본 접근이 달라졌습니다. 초안은 유지됩니다.");
    }
    if (expires <= (ports.now ?? Date.now)()) return this.set(row, "expired");
    this.set(row, "dispatching"); row = this.find(actor, input.id)!;
    try {
      const result = await ports.create(input);
      if (!this.matches(row, result)) return this.set(row, "unknown");
      return this.set(row, "created", result);
    } catch (error) { return this.set(row, error instanceof TaskCreationExpired ? "expired" : error instanceof TaskCreationRejected ? "failed" : "unknown"); }
  }

  list(actor: string, sourceId: string, projectId: string, limit = 100): TaskCreationReceipt[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new CommandError(400, "invalid_limit", "조회 한도를 확인해 주세요.");
    return (this.store.db.prepare("SELECT * FROM task_creation_receipts WHERE actor=? AND source_id=? AND project_id=? ORDER BY created_at DESC,id DESC LIMIT ?")
      .all(actor, sourceId, projectId, limit) as unknown as Row[]).reverse().map((row) => this.view(row));
  }

  async reconcile(actor: string, id: string, ports: CreateTaskPorts): Promise<TaskCreationReceipt> {
    if (!z.uuid().safeParse(id).success || !actor.trim()) throw new CommandError(400, "invalid_receipt", "생성 요청 ID를 확인해 주세요.");
    const row = this.find(actor, id);
    if (!row) throw new CommandError(404, "receipt_not_found", "생성 처리 기록을 찾지 못했습니다.");
    const binding = await this.authorize(ports, row.source_id, row.project_id);
    if (row.source_identity !== binding.identity) throw new CommandError(403, "source_identity_changed", "원본 쓰기 연결이 달라졌습니다.");
    if (terminal.has(row.state)) return this.view(row);
    let result: NativeTaskCreation | null;
    try { result = await ports.lookup(row.id, row.project_id, row.body_sha256); }
    catch { throw new CommandError(502, "source_receipt_unavailable", "원본 처리 결과를 확인하지 못했습니다. 다시 전송하지 않습니다."); }
    const current = await this.authorize(ports, row.source_id, row.project_id);
    if (current.identity !== row.source_identity) throw new CommandError(403, "source_identity_changed", "원본 쓰기 연결이 달라졌습니다.");
    return result && this.matches(row, result) ? this.set(row, "created", result) : this.set(row, "unknown");
  }

  recoverInterrupted(): number {
    return Number(this.store.db.prepare("UPDATE task_creation_receipts SET state='unknown',updated_at=? WHERE state IN ('requested','dispatching')")
      .run(new Date().toISOString()).changes);
  }

  private async authorize(ports: CreateTaskPorts, sourceId: string, projectId: string) {
    try {
      const value = await ports.authorize();
      if (!/^[a-f0-9]{64}$/.test(value.identity) || value.sourceId !== sourceId || value.projectId !== projectId) throw new Error();
      return value;
    } catch { throw new CommandError(403, "source_forbidden", "현재 원본 업무 생성 권한을 확인할 수 없습니다."); }
  }
  private find(actor: string, id: string): Row | undefined {
    return this.store.db.prepare("SELECT * FROM task_creation_receipts WHERE actor=? AND id=?").get(actor, id) as Row | undefined;
  }
  private replay(row: Row, digest: string, identity: string, bodyHash: string) {
    if (row.request_digest !== digest || row.body_sha256 !== bodyHash) throw new CommandError(409, "idempotency_conflict", "같은 요청 ID에 다른 초안을 전송할 수 없습니다.");
    if (row.source_identity !== identity) throw new CommandError(403, "source_identity_changed", "원본 쓰기 연결이 달라졌습니다.");
    return this.view(row);
  }
  private matches(row: Row, result: NativeTaskCreation): boolean {
    return result.operationId === row.id && result.requestBodySha256 === row.body_sha256 &&
      z.uuid().safeParse(result.task.id).success && result.task.projectId === row.project_id && /^[1-9][0-9]*$/.test(result.task.revision);
  }
  private set(row: Row, state: TaskCreationState, result?: NativeTaskCreation): TaskCreationReceipt {
    // Terminal receipts absorb late reads and late dispatch outcomes.
    this.store.db.prepare(`UPDATE task_creation_receipts SET state=?,task_id=?,task_revision=?,updated_at=?
      WHERE actor=? AND id=? AND state IN ('requested','dispatching','unknown')`).run(state,
        result?.task.id ?? null, result?.task.revision ?? null, new Date().toISOString(), row.actor, row.id);
    return this.view(this.find(row.actor, row.id)!);
  }
  private view(row: Row): TaskCreationReceipt {
    return { id: row.id, actor: row.actor, sourceId: row.source_id, projectId: row.project_id, state: row.state,
      taskId: row.task_id, taskRevision: row.task_revision, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
