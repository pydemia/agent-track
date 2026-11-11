import { createHash } from "node:crypto";
import { z } from "zod";
import { sequenceSchema, timestampSchema } from "../contracts/index.ts";
import type { Store } from "../storage/store.ts";
import { CommandError } from "./index.ts";

const sourceId = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const assignmentInputSchema = z.object({
  id: z.uuid(), projectSourceId: sourceId, projectId: z.uuid(), taskId: z.uuid(),
  taskRevision: sequenceSchema.refine((value) => value !== "0"), reviewSha256: digest,
  demianSourceId: sourceId, sessionId: z.uuid(), sessionSha256: digest, instructions: z.string().max(2000), expiresAt: timestampSchema,
}).strict().refine((value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 12_000);
export type AssignmentInput = z.infer<typeof assignmentInputSchema>;
export type AssignmentTarget = Omit<AssignmentInput, "id" | "instructions" | "expiresAt">;
export type AssignmentState = "requested" | "dispatching" | "accepted" | "unknown" | "failed" | "expired";
export interface AssignmentReceipt extends AssignmentTarget {
  id: string; actor: string; state: AssignmentState; runId: string | null;
  bindingState: "pending" | "bound" | "conflict" | null; createdAt: string; updatedAt: string;
}
export interface AssignmentAcceptance { runId: string; sessionId: string; inputSha256: string }
export interface AssignmentPorts {
  authorize(target: AssignmentTarget): Promise<{ identity: string }>;
  prepare(input: AssignmentInput): Promise<{ inputSha256: string }>;
  start(input: AssignmentInput): Promise<AssignmentAcceptance>;
  lookup(target: AssignmentTarget, id: string, inputSha256: string): Promise<AssignmentAcceptance | null>;
  bind(target: AssignmentTarget, id: string, runId: string): Promise<"bound" | "conflict">;
  now?: () => number;
}
export class AssignmentRejected extends Error {}
export class AssignmentExpired extends Error {}
interface Row {
  actor: string; id: string; project_source_id: string; project_id: string; task_id: string; task_revision: string;
  review_sha256: string; demian_source_id: string; session_id: string; session_sha256: string; request_digest: string; source_identity: string; input_sha256: string;
  state: AssignmentState; run_id: string | null; binding_state: AssignmentReceipt["bindingState"]; created_at: string; updated_at: string;
}
const pending = new Set<AssignmentState>(["requested", "dispatching", "unknown"]);

/** Persists identifiers and hashes; submitted instructions and original Task text stay transient. */
export class TaskAssignmentService {
  constructor(private store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS task_assignment_receipts (
      actor TEXT NOT NULL, id TEXT NOT NULL, project_source_id TEXT NOT NULL, project_id TEXT NOT NULL,
      task_id TEXT NOT NULL, task_revision TEXT NOT NULL, review_sha256 TEXT NOT NULL,
      demian_source_id TEXT NOT NULL, session_id TEXT NOT NULL, session_sha256 TEXT NOT NULL, request_digest TEXT NOT NULL,
      source_identity TEXT NOT NULL, input_sha256 TEXT NOT NULL, state TEXT NOT NULL, run_id TEXT,
      binding_state TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(actor,id)
    )`);
  }
  async execute(actor: string, raw: unknown, ports: AssignmentPorts): Promise<AssignmentReceipt> {
    const parsed = assignmentInputSchema.safeParse(raw);
    if (!parsed.success || !actor.trim()) throw new CommandError(400, "invalid_assignment", "업무 검토·실행 대상·요청 ID·기한을 확인해 주세요.");
    const input = parsed.data; const target = this.target(input);
    const grant = await this.authorize(ports, target);
    const requestDigest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = this.find(actor, input.id);
    if (previous) return this.replay(previous, requestDigest, grant.identity);
    const now = (ports.now ?? Date.now)(); const expires = Date.parse(input.expiresAt);
    if (expires > now + 120_000) throw new CommandError(400, "invalid_deadline", "배정 기한은 120초 이내여야 합니다.");
    const prepared = await ports.prepare(input);
    if (!digest.safeParse(prepared.inputSha256).success) throw new CommandError(502, "invalid_assignment_input", "실행 입력을 확인하지 못했습니다.");
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const concurrent = this.find(actor, input.id);
      if (concurrent) { const receipt = this.replay(concurrent, requestDigest, grant.identity); this.store.db.exec("COMMIT"); return receipt; }
      if (expires > (ports.now ?? Date.now)() && this.store.db.prepare(`SELECT id FROM task_assignment_receipts WHERE actor=? AND demian_source_id=? AND session_id=?
          AND state IN ('requested','dispatching','unknown') LIMIT 1`).get(actor, input.demianSourceId, input.sessionId)) {
        throw new CommandError(409, "assignment_pending", "이 Session의 이전 실행 접수를 먼저 확인해 주세요. 새 Run은 전송하지 않습니다.");
      }
      const stamp = new Date((ports.now ?? Date.now)()).toISOString();
      this.store.db.prepare(`INSERT INTO task_assignment_receipts (actor,id,project_source_id,project_id,task_id,task_revision,review_sha256,
        demian_source_id,session_id,session_sha256,request_digest,source_identity,input_sha256,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(actor, input.id, input.projectSourceId, input.projectId, input.taskId, input.taskRevision, input.reviewSha256,
          input.demianSourceId, input.sessionId, input.sessionSha256, requestDigest, grant.identity, prepared.inputSha256, expires <= (ports.now ?? Date.now)() ? "expired" : "requested", stamp, stamp);
      this.store.db.exec("COMMIT");
    } catch (error) { this.store.db.exec("ROLLBACK"); throw error; }
    let row = this.find(actor, input.id)!; if (row.state === "expired") return this.view(row);
    try { await this.checkIdentity(ports, row); }
    catch (error) { this.updateNative(row, "failed"); throw error; }
    if (expires <= (ports.now ?? Date.now)()) return this.updateNative(row, "expired");
    this.updateNative(row, "dispatching"); row = this.find(actor, input.id)!;
    let result: AssignmentAcceptance;
    try { result = await ports.start(input); }
    catch (error) { return this.updateNative(row, error instanceof AssignmentExpired ? "expired" : error instanceof AssignmentRejected ? "failed" : "unknown"); }
    if (!this.matches(row, result)) return this.updateNative(row, "unknown");
    // Durable acceptance precedes binding. A failed local association can never
    // turn this into another native POST or discard the known original Run ID.
    this.updateNative(row, "accepted", result.runId);
    return this.bind(this.find(actor, input.id)!, ports);
  }
  async reconcile(actor: string, id: string, ports: AssignmentPorts): Promise<AssignmentReceipt> {
    if (!z.uuid().safeParse(id).success || !actor.trim()) throw new CommandError(400, "invalid_receipt", "실행 요청 ID를 확인해 주세요.");
    let row = this.find(actor, id); if (!row) throw new CommandError(404, "receipt_not_found", "실행 처리 기록이 없습니다.");
    await this.checkIdentity(ports, row);
    if (row.state === "accepted") return this.bind(row, ports);
    if (!pending.has(row.state)) return this.view(row);
    let result: AssignmentAcceptance | null;
    try { result = await ports.lookup(this.rowTarget(row), row.id, row.input_sha256); }
    catch { throw new CommandError(502, "assignment_status_unavailable", "원본 접수 결과를 확인하지 못했습니다. 실행을 다시 전송하지 않습니다."); }
    await this.checkIdentity(ports, row);
    if (!result || !this.matches(row, result)) return this.updateNative(row, "unknown");
    this.updateNative(row, "accepted", result.runId); row = this.find(actor, id)!;
    return this.bind(row, ports);
  }
  list(actor: string, projectSourceId: string, projectId: string, taskId: string, limit = 100): AssignmentReceipt[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 101) throw new CommandError(400, "invalid_limit", "조회 한도를 확인해 주세요.");
    return (this.store.db.prepare(`SELECT * FROM task_assignment_receipts WHERE actor=? AND project_source_id=? AND project_id=? AND task_id=?
      ORDER BY created_at DESC,id DESC LIMIT ?`).all(actor, projectSourceId, projectId, taskId, limit) as unknown as Row[]).reverse().map((row) => this.view(row));
  }
  recoverInterrupted(): number {
    return Number(this.store.db.prepare("UPDATE task_assignment_receipts SET state='unknown',updated_at=? WHERE state IN ('requested','dispatching')").run(new Date().toISOString()).changes);
  }
  sourceMatches(actor: string, id: string, identity: string): boolean {
    return this.find(actor, id)?.source_identity === identity;
  }
  private async bind(row: Row, ports: AssignmentPorts): Promise<AssignmentReceipt> {
    if (row.state !== "accepted" || !row.run_id || row.binding_state === "bound") return this.view(this.find(row.actor, row.id)!);
    await this.checkIdentity(ports, row); let bindingState: "bound" | "conflict" | "pending";
    try { bindingState = await ports.bind(this.rowTarget(row), row.id, row.run_id); }
    catch { bindingState = "pending"; }
    await this.checkIdentity(ports, row);
    this.store.db.prepare(`UPDATE task_assignment_receipts SET binding_state=?,updated_at=? WHERE actor=? AND id=?
      AND state='accepted' AND binding_state IN ('pending','conflict')`).run(bindingState, new Date().toISOString(), row.actor, row.id);
    return this.view(this.find(row.actor, row.id)!);
  }
  private matches(row: Row, result: AssignmentAcceptance): boolean {
    return z.uuid().safeParse(result.runId).success && result.sessionId === row.session_id && result.inputSha256 === row.input_sha256;
  }
  private async authorize(ports: AssignmentPorts, target: AssignmentTarget) {
    try { const result = await ports.authorize(target); if (!digest.safeParse(result.identity).success) throw new Error(); return result; }
    catch { throw new CommandError(403, "assignment_forbidden", "현재 업무와 실행 Session의 접근을 확인할 수 없습니다."); }
  }
  private async checkIdentity(ports: AssignmentPorts, row: Row) {
    const grant = await this.authorize(ports, this.rowTarget(row));
    if (grant.identity !== row.source_identity) throw new CommandError(403, "source_identity_changed", "실행 연결 구성이 달라졌습니다.");
  }
  private target(input: AssignmentInput): AssignmentTarget {
    const { id: _id, instructions: _instructions, expiresAt: _expires, ...target } = input; return target;
  }
  private rowTarget(row: Row): AssignmentTarget {
    return { projectSourceId: row.project_source_id, projectId: row.project_id, taskId: row.task_id, taskRevision: row.task_revision,
      reviewSha256: row.review_sha256, demianSourceId: row.demian_source_id, sessionId: row.session_id, sessionSha256: row.session_sha256 };
  }
  private find(actor: string, id: string): Row | undefined { return this.store.db.prepare("SELECT * FROM task_assignment_receipts WHERE actor=? AND id=?").get(actor, id) as Row | undefined; }
  private replay(row: Row, requestDigest: string, identity: string): AssignmentReceipt {
    if (row.request_digest !== requestDigest) throw new CommandError(409, "idempotency_conflict", "같은 요청 ID에 다른 배정 내용을 전송할 수 없습니다.");
    if (row.source_identity !== identity) throw new CommandError(403, "source_identity_changed", "실행 연결 구성이 달라졌습니다.");
    return this.view(row);
  }
  private updateNative(row: Row, state: AssignmentState, runId?: string): AssignmentReceipt {
    this.store.db.prepare(`UPDATE task_assignment_receipts SET state=?,run_id=?,binding_state=?,updated_at=?
      WHERE actor=? AND id=? AND state IN ('requested','dispatching','unknown')`).run(state, runId ?? null,
        state === "accepted" ? "pending" : null, new Date().toISOString(), row.actor, row.id);
    return this.view(this.find(row.actor, row.id)!);
  }
  private view(row: Row): AssignmentReceipt {
    return { ...this.rowTarget(row), id: row.id, actor: row.actor, state: row.state, runId: row.run_id, bindingState: row.binding_state,
      createdAt: row.created_at, updatedAt: row.updated_at };
  }
}
