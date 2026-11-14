import { createHash } from "node:crypto";
import { z } from "zod";
import { bindingSchema, externalKey, idSchema } from "../contracts/index.ts";
import { assistantCommandInputSchema, assistantCommandReceiptSchema,
  type AssistantCommandReceipt } from "../contracts/assistant-commands.ts";
import { coordinatorReviewInputSchema, coordinatorReceiptSchema, coordinatorReceiptPageSchema,
  type CoordinatorReviewInput, type CoordinatorReceipt, type CoordinatorReceiptPage } from "../contracts/coordinator-commands.ts";
import { Store } from "../storage/store.ts";
import { CommandError } from "./index.ts";

const targetUuid = z.uuid().transform(value => value.toLowerCase());
export const coordinatorTargetSchema = z.strictObject({
  runKey: idSchema, runId: targetUuid, nativeSourceId: idSchema, nativeSourceIdentity: z.string().min(1),
  assistantSourceId: idSchema, assistantSourceIdentity: z.string().min(1),
  executionId: targetUuid, roleId: targetUuid, attemptId: targetUuid,
  attemptOrdinal: z.int().min(1).max(32), expectedRevision: z.int().positive().safe(),
  sourceStatus: z.enum(["failed", "cancelled", "expired", "interrupted"]),
  sessionId: targetUuid, binding: bindingSchema.nullable(),
});
export const preparedCoordinatorSchema = z.strictObject({
  target: coordinatorTargetSchema, scopeIdentity: z.string().min(1), command: assistantCommandInputSchema,
}).refine(({ target: t, command: c }) =>
  t.runKey === externalKey(t.nativeSourceId, t.runId) && c.expectedRevision === t.expectedRevision &&
  Number.isFinite(Date.parse(c.expiresAt)) && c.expiresAt === new Date(c.expiresAt).toISOString() &&
  (t.binding === null || t.binding.sourceId === t.nativeSourceId && t.binding.runId === t.runId),
"Coordinator target identity differs");
export type PreparedCoordinator = z.infer<typeof preparedCoordinatorSchema>;
export interface CoordinatorPorts {
  prepare(input: CoordinatorReviewInput): Promise<PreparedCoordinator>;
  authorize(prepared: PreparedCoordinator | null, writing: boolean): Promise<void>;
  dispatch(prepared: PreparedCoordinator): Promise<AssistantCommandReceipt>;
  lookup(prepared: PreparedCoordinator): Promise<AssistantCommandReceipt | null>;
  now?: () => number;
}
/** Only a final adapter fence that proves zero POST may throw this error. */
export class CoordinatorDispatchWithheld extends Error {
  constructor(readonly detail: "review_changed" | "authority_changed" | "deadline_passed") {
    super("Coordinator dispatch withheld before transmission");
  }
}
interface Row {
  actor: string; id: string; run_key: string; digest: string; assistant_source: string;
  execution_id: string; role_id: string; private_json: string; receipt_json: string | null;
  state: CoordinatorReceipt["state"]; detail: CoordinatorReceipt["detail"];
  created_at: string; updated_at: string;
}
const fail = (status: number, code: string) => new CommandError(status, code, "Coordinator command could not be completed.");
const digest = (actor: string, input: CoordinatorReviewInput) => createHash("sha256")
  .update(JSON.stringify([actor, input.id, input.runKey, input.kind, input.expiresAt])).digest("hex");
const now = (ports: CoordinatorPorts) => (ports.now ?? Date.now)();
const stamp = (ports: CoordinatorPorts) => new Date(now(ports)).toISOString();

export class CoordinatorCommands {
  constructor(private readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS coordinator_command_intents (
      actor TEXT NOT NULL, id TEXT NOT NULL, run_key TEXT NOT NULL, digest TEXT NOT NULL,
      assistant_source TEXT NOT NULL, execution_id TEXT NOT NULL, role_id TEXT NOT NULL,
      private_json TEXT NOT NULL, receipt_json TEXT, state TEXT NOT NULL, detail TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(actor,id));
      CREATE UNIQUE INDEX IF NOT EXISTS coordinator_command_unresolved
      ON coordinator_command_intents(actor,assistant_source,execution_id,role_id)
      WHERE state IN ('prepared','dispatching','unknown');`);
  }

  async review(actor: string, raw: unknown, ports: CoordinatorPorts): Promise<CoordinatorReceipt> {
    this.actor(actor);
    const parsed = coordinatorReviewInputSchema.safeParse(raw);
    if (!parsed.success) throw fail(400, "invalid_command");
    const input = parsed.data, requestDigest = digest(actor, input);
    await this.auth(ports, null, true);
    const old = this.find(actor, input.id);
    if (old) {
      if (old.digest !== requestDigest) throw fail(409, "idempotency_conflict");
      await this.auth(ports, this.prepared(old), false);
      return this.dto(this.expire(this.require(actor, input.id), ports));
    }
    this.deadline(input, ports);
    let prepared: PreparedCoordinator;
    try { prepared = preparedCoordinatorSchema.parse(await ports.prepare(structuredClone(input))); }
    catch { await this.auth(ports, null, true); throw fail(502, "invalid_preparation"); }
    await this.auth(ports, prepared, true);
    if (prepared.target.runKey !== input.runKey || prepared.command.operationId !== input.id ||
        prepared.command.kind !== input.kind || prepared.command.expiresAt !== input.expiresAt) {
      throw fail(502, "invalid_preparation");
    }
    this.deadline(input, ports);
    const t = prepared.target, time = stamp(ports);
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const raced = this.find(actor, input.id);
      if (raced) {
        this.dto(raced);
        if (raced.digest !== requestDigest) throw fail(409, "idempotency_conflict");
      } else {
        const pending = this.store.db.prepare(`SELECT * FROM coordinator_command_intents
          WHERE actor=? AND assistant_source=? AND execution_id=? AND role_id=?
          AND state IN ('prepared','dispatching','unknown')`).all(actor, t.assistantSourceId, t.executionId, t.roleId) as unknown as Row[];
        for (const row of pending) {
          const current = this.expire(row, ports);
          if (["prepared", "dispatching", "unknown"].includes(current.state)) throw fail(409, "coordinator_pending");
        }
        this.store.db.prepare(`INSERT INTO coordinator_command_intents
          (actor,id,run_key,digest,assistant_source,execution_id,role_id,private_json,state,detail,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,'prepared','review_ready',?,?)`).run(actor, input.id, input.runKey,
          requestDigest, t.assistantSourceId, t.executionId, t.roleId, JSON.stringify(prepared), time, time);
      }
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error instanceof CommandError ? error : fail(500, "receipt_write_failed");
    }
    const row = this.require(actor, input.id);
    await this.auth(ports, this.prepared(row), true);
    return this.dto(this.expire(this.require(actor, input.id), ports));
  }

  async dispatch(actor: string, id: string, ports: CoordinatorPorts): Promise<CoordinatorReceipt> {
    let row = this.require(actor, id);
    const prepared = this.prepared(row);
    if (row.state !== "prepared") return this.get(actor, id, ports);
    try { await this.auth(ports, prepared, true); }
    catch (error) { this.reject(row, error, ports, "prepared"); throw error; }
    row = this.expire(this.require(actor, id), ports);
    if (row.state !== "prepared") return this.dto(row);
    const claim = this.store.db.prepare(`UPDATE coordinator_command_intents
      SET state='dispatching',detail='outcome_unknown',updated_at=? WHERE actor=? AND id=? AND state='prepared'`)
      .run(stamp(ports), actor, id);
    if (!claim.changes) return this.get(actor, id, ports);
    try { await this.auth(ports, prepared, true); }
    catch (error) { this.reject(row, error, ports, "dispatching"); throw error; }
    if (Date.parse(prepared.command.expiresAt) <= now(ports)) {
      this.withhold(row, "expired", "deadline_passed", ports);
      return this.dto(this.require(actor, id));
    }
    try { this.record(row, prepared, await ports.dispatch(structuredClone(prepared)), ports); }
    catch (error) {
      if (error instanceof CoordinatorDispatchWithheld) {
        this.withhold(row, error.detail === "deadline_passed" ? "expired" : "rejected", error.detail, ports);
      } else this.change(row, "unknown", "outcome_unknown", ports, "dispatching");
    }
    // Persist evidence before checking access: revoked callers receive nothing,
    // but revocation must never erase an ACK or permit retransmission.
    await this.auth(ports, prepared, false);
    return this.dto(this.require(actor, id));
  }

  async get(actor: string, id: string, ports: CoordinatorPorts): Promise<CoordinatorReceipt> {
    let row = this.require(actor, id);
    const prepared = this.prepared(row);
    await this.auth(ports, prepared, false);
    row = this.expire(this.require(actor, id), ports);
    if (row.state === "dispatching" || row.state === "unknown") {
      let receipt: AssistantCommandReceipt | null = null;
      try { receipt = await ports.lookup(structuredClone(prepared)); }
      catch { /* A missing receipt or transport failure cannot prove zero POST. */ }
      // Evidence is durable even when the post-await authorization fails.
      try {
        if (receipt !== null) this.record(row, prepared, receipt, ports);
        else this.change(row, "unknown", "outcome_unknown", ports, "dispatching");
      } catch { this.change(row, "unknown", "outcome_unknown", ports, "dispatching"); }
    }
    await this.auth(ports, prepared, false);
    return this.dto(this.require(actor, id));
  }

  async list(actor: string, runKey: string, ports: CoordinatorPorts): Promise<CoordinatorReceiptPage> {
    this.actor(actor);
    if (!idSchema.safeParse(runKey).success) throw fail(400, "invalid_run_key");
    await this.auth(ports, null, false);
    const rows = this.store.db.prepare(`SELECT * FROM coordinator_command_intents
      WHERE actor=? AND run_key=? ORDER BY created_at DESC,rowid DESC LIMIT 101`).all(actor, runKey) as unknown as Row[];
    const receipts: CoordinatorReceipt[] = [];
    for (const row of rows.slice(0, 100)) receipts.push(await this.get(actor, row.id, ports));
    for (const row of rows.slice(0, 100)) await this.auth(ports, this.prepared(this.require(actor, row.id)), false);
    await this.auth(ports, null, false);
    return coordinatorReceiptPageSchema.parse({ receipts, hasMore: rows.length > 100 });
  }

  async discard(actor: string, id: string, ports: CoordinatorPorts): Promise<CoordinatorReceipt> {
    const row = this.require(actor, id);
    // This cancels a local, unsent review. Current owner/read scope suffices;
    // advancing the role or withdrawing dispatch must not prevent declining it.
    await this.auth(ports, this.prepared(row), false);
    this.expire(this.require(actor, id), ports);
    this.change(row, "discarded", "review_discarded", ports, "prepared");
    return this.dto(this.require(actor, id));
  }

  private actor(actor: string): void {
    if (typeof actor !== "string" || !actor.trim()) throw fail(400, "invalid_actor");
  }
  private deadline(input: CoordinatorReviewInput, ports: CoordinatorPorts): void {
    const time = now(ports), expiry = Date.parse(input.expiresAt);
    if (expiry <= time || expiry > time + 120_000) throw fail(400, "invalid_deadline");
  }
  private find(actor: string, id: string): Row | undefined {
    return this.store.db.prepare("SELECT * FROM coordinator_command_intents WHERE actor=? AND id=?").get(actor, id) as Row | undefined;
  }
  private require(actor: string, id: string): Row {
    this.actor(actor);
    if (!z.uuid().safeParse(id).success || id !== id.toLowerCase()) throw fail(400, "invalid_receipt_id");
    const row = this.find(actor, id);
    if (!row) throw fail(404, "receipt_not_found");
    this.dto(row);
    return row;
  }
  private prepared(row: Row): PreparedCoordinator {
    try {
      const p = preparedCoordinatorSchema.parse(JSON.parse(row.private_json));
      const input = coordinatorReviewInputSchema.parse({ id: row.id, runKey: row.run_key,
        kind: p.command.kind, expiresAt: p.command.expiresAt });
      if (p.command.operationId !== row.id || p.target.runKey !== row.run_key ||
          p.target.assistantSourceId !== row.assistant_source || p.target.executionId !== row.execution_id ||
          p.target.roleId !== row.role_id || digest(row.actor, input) !== row.digest ||
          Date.parse(p.command.expiresAt) > Date.parse(row.created_at) + 120_000 ||
          Date.parse(p.command.expiresAt) <= Date.parse(row.created_at)) throw new Error("Identity mismatch");
      return p;
    } catch { throw fail(500, "invalid_stored_intent"); }
  }
  private async auth(ports: CoordinatorPorts, prepared: PreparedCoordinator | null, writing: boolean): Promise<void> {
    try { await ports.authorize(structuredClone(prepared), writing); }
    catch (error) {
      const changed = error instanceof CommandError && (error.status === 409 || error.code === "review_changed");
      throw fail(changed ? 409 : 403, changed ? "review_changed" : "authority_changed");
    }
  }
  private reject(row: Row, error: unknown, ports: CoordinatorPorts, from: Row["state"]): void {
    const detail = error instanceof CommandError && error.code === "review_changed" ? "review_changed" : "authority_changed";
    if (from === "dispatching") this.withhold(row, "rejected", detail, ports);
    else this.change(row, "rejected", detail, ports, from);
  }
  private withhold(row: Row, state: "rejected" | "expired", detail: Row["detail"], ports: CoordinatorPorts): void {
    // A concurrent GET may have moved the same claim to unknown. Proven zero
    // transmission still closes that claim; saved upstream evidence always wins.
    this.store.db.prepare(`UPDATE coordinator_command_intents SET state=?,detail=?,updated_at=?
      WHERE actor=? AND id=? AND state IN ('dispatching','unknown') AND receipt_json IS NULL`)
      .run(state, detail, stamp(ports), row.actor, row.id);
  }
  private change(row: Row, state: Row["state"], detail: Row["detail"], ports: CoordinatorPorts, from: Row["state"]): void {
    this.store.db.prepare(`UPDATE coordinator_command_intents SET state=?,detail=?,updated_at=?
      WHERE actor=? AND id=? AND state=?`).run(state, detail, stamp(ports), row.actor, row.id, from);
  }
  private expire(row: Row, ports: CoordinatorPorts): Row {
    this.dto(row);
    if (row.state === "prepared" && Date.parse(this.prepared(row).command.expiresAt) <= now(ports)) {
      this.change(row, "expired", "deadline_passed", ports, "prepared");
    }
    return this.require(row.actor, row.id);
  }
  private checkedReceipt(p: PreparedCoordinator, raw: unknown): AssistantCommandReceipt {
    const receipt = assistantCommandReceiptSchema.parse(raw), c = receipt.command;
    if (c.operationId !== p.command.operationId || c.kind !== p.command.kind ||
        c.executionId !== p.target.executionId || c.roleId !== p.target.roleId ||
        c.attempt !== p.target.attemptOrdinal + 1) throw fail(502, "invalid_coordinator_receipt");
    return receipt;
  }
  private record(row: Row, p: PreparedCoordinator, raw: unknown, ports: CoordinatorPorts): void {
    const receipt = this.checkedReceipt(p, raw);
    this.store.db.prepare(`UPDATE coordinator_command_intents SET state='intent_saved',detail='intent_saved',receipt_json=?,updated_at=?
      WHERE actor=? AND id=? AND state IN ('dispatching','unknown')`)
      .run(JSON.stringify(receipt), stamp(ports), row.actor, row.id);
  }
  private dto(row: Row): CoordinatorReceipt {
    try {
      const p = this.prepared(row);
      return coordinatorReceiptSchema.parse({ id: row.id, runKey: row.run_key, kind: p.command.kind,
        expiresAt: p.command.expiresAt, state: row.state, detail: row.detail,
        coordinatorReceipt: row.receipt_json === null ? null : this.checkedReceipt(p, JSON.parse(row.receipt_json)),
        createdAt: row.created_at, updatedAt: row.updated_at });
    } catch { throw fail(500, "invalid_stored_intent"); }
  }
}
