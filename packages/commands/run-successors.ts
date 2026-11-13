import { createHash } from "node:crypto";
import { z } from "zod";
import { bindingSchema, externalKey, idSchema, sequenceSchema } from "../contracts/index.ts";
import { nativeCommandDescriptorSchema, nativeCommandReceiptSchema, nativeCommandStatusSchema,
  nativeCommandTerminalSchema, nativeCommandWriteSchema, type NativeCommandWrite,
  type NativeCommandReceipt, type NativeCommandStatus } from "../contracts/native-run-commands.ts";
import { successorReviewInputSchema, successorReceiptSchema, type SuccessorReviewInput,
  type SuccessorReceipt, type SuccessorReceiptPage } from "../contracts/run-successors.ts";
import { Store } from "../storage/store.ts";
import { CommandError } from "./index.ts";

const targetSchema = z.object({ runKey: idSchema, sourceId: idSchema, runId: z.uuid(), sessionId: z.uuid(),
  sourceStatus: nativeCommandTerminalSchema, expectedCursor: sequenceSchema, sourceIdentity: z.string().min(1),
  binding: bindingSchema.nullable() }).strict();
const preparedSchema = z.object({ target: targetSchema, scopeIdentity: z.string().min(1), native: nativeCommandWriteSchema }).strict();
export type PreparedSuccessor = z.infer<typeof preparedSchema>;
export interface SuccessorPorts {
  prepare(input: SuccessorReviewInput): Promise<PreparedSuccessor>;
  authorize(prepared: PreparedSuccessor | null, writing: boolean): Promise<void>;
  dispatch(prepared: PreparedSuccessor): Promise<NativeCommandReceipt>;
  lookup(prepared: PreparedSuccessor): Promise<NativeCommandStatus>;
  observeAccepted(prepared: PreparedSuccessor, receipt: NativeCommandReceipt): Promise<boolean>;
  now?: () => number;
}
/** An adapter may prove that its final fence prevented invoking Native fetch. */
export class SuccessorDispatchWithheld extends Error {
  constructor(readonly detail: "review_changed" | "authority_changed" | "deadline_passed") { super("Native dispatch withheld before transmission"); }
}
interface Row {
  actor: string; id: string; run_key: string; digest: string; state: SuccessorReceipt["state"];
  detail: SuccessorReceipt["detail"]; private_json: string; input_json: string | null;
  receipt_json: string | null; observed: number; created_at: string; updated_at: string;
}
const fail = (status: number, code: string) => new CommandError(status, code, "Successor command could not be completed.");
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stamp = (ports: SuccessorPorts) => new Date((ports.now ?? Date.now)()).toISOString();

export class SuccessorCommands {
  constructor(private readonly store: Store) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS successor_intents (
      actor TEXT NOT NULL, id TEXT NOT NULL, run_key TEXT NOT NULL, digest TEXT NOT NULL,
      state TEXT NOT NULL, detail TEXT NOT NULL, private_json TEXT NOT NULL, input_json TEXT,
      receipt_json TEXT, observed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(actor,id));
      CREATE UNIQUE INDEX IF NOT EXISTS successor_unresolved ON successor_intents(actor,run_key)
      WHERE state IN ('prepared','dispatching','unknown');`);
  }

  async review(actor: string, raw: unknown, ports: SuccessorPorts): Promise<SuccessorReceipt> {
    this.actor(actor);
    const parsed = successorReviewInputSchema.safeParse(raw);
    if (!parsed.success) throw fail(400, "invalid_command");
    const input = parsed.data;
    // The public schema canonicalizes UUID and UTC timestamps before digesting or port I/O.
    if (Date.parse(input.expiresAt) <= (ports.now ?? Date.now)() ||
        Date.parse(input.expiresAt) > (ports.now ?? Date.now)() + 120_000) {
      throw fail(400, "invalid_deadline");
    }
    const digest = hash([actor, input.id, input.runKey, input.kind, input.expiresAt, input.input ?? null]);
    await this.auth(ports, null, true);
    const old = this.find(actor, input.id);
    if (old) {
      if (old.digest !== digest) throw fail(409, "idempotency_conflict");
      await this.auth(ports, this.prepared(old), false);
      return this.dto(this.expire(old, ports));
    }
    let prepared: PreparedSuccessor;
    try { prepared = preparedSchema.parse(await ports.prepare(structuredClone(input))); }
    catch { throw fail(502, "invalid_preparation"); }
    const { target, native } = prepared;
    if (target.runKey !== input.runKey || externalKey(target.sourceId, target.runId) !== target.runKey ||
        native.command.commandId !== input.id || native.command.sourceRunId !== target.runId ||
        native.command.kind !== input.kind || native.command.expiresAt !== input.expiresAt ||
        native.command.expectedSourceStatus !== target.sourceStatus ||
        JSON.stringify(native.input) !== JSON.stringify(input.input === undefined ? undefined : [{ type: "input_text", text: input.input }]) ||
        (target.binding !== null && (target.binding.sourceId !== target.sourceId || target.binding.runId !== target.runId))) {
      throw fail(502, "invalid_preparation");
    }
    await this.auth(ports, prepared, true);
    if (Date.parse(input.expiresAt) <= (ports.now ?? Date.now)()) throw fail(400, "invalid_deadline");
    const privateValue = { target, scopeIdentity: prepared.scopeIdentity, command: native.command };
    const now = stamp(ports);
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const raced = this.find(actor, input.id);
      if (raced) {
        if (raced.digest !== digest) throw fail(409, "idempotency_conflict");
      } else {
        const pending = this.store.db.prepare("SELECT * FROM successor_intents WHERE actor=? AND run_key=? AND state='prepared'")
          .all(actor, input.runKey) as unknown as Row[];
        pending.forEach(row => this.expire(row, ports));
        if (this.store.db.prepare("SELECT id FROM successor_intents WHERE actor=? AND run_key=? AND state IN ('prepared','dispatching','unknown')").get(actor, input.runKey)) throw fail(409, "successor_pending");
        this.store.db.prepare(`INSERT INTO successor_intents
          (actor,id,run_key,digest,state,detail,private_json,input_json,created_at,updated_at) VALUES(?,?,?,?,'prepared','review_ready',?,?,?,?)`)
          .run(actor, input.id, input.runKey, digest, JSON.stringify(privateValue), native.input ? JSON.stringify(native.input) : null, now, now);
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

  async dispatch(actor: string, id: string, ports: SuccessorPorts): Promise<SuccessorReceipt> {
    let row = this.require(actor, id);
    const prepared = this.prepared(row);
    if (row.state !== "prepared") {
      await this.auth(ports, prepared, false);
      return this.dto(this.require(actor, id));
    }
    try { await this.auth(ports, prepared, true); }
    catch (error) { this.rejectAuthority(row, error, ports, "prepared"); throw error; }
    row = this.expire(this.require(actor, id), ports);
    if (row.state !== "prepared") return this.dto(row);
    const claim = this.store.db.prepare("UPDATE successor_intents SET state='dispatching',detail='outcome_unknown',input_json=NULL,updated_at=? WHERE actor=? AND id=? AND state='prepared'")
      .run(stamp(ports), actor, id);
    if (!claim.changes) return this.dto(this.require(actor, id));
    try { await this.auth(ports, prepared, true); }
    catch (error) { this.rejectAuthority(row, error, ports, "dispatching"); throw error; }
    if (Date.parse(prepared.native.command.expiresAt) <= (ports.now ?? Date.now)()) {
      this.change(row, "expired", "deadline_passed", ports, "dispatching");
      return this.dto(this.require(actor, id));
    }
    // After invocation, errors can never establish nonexecution and never permit resending.
    try { this.record(row, prepared, await ports.dispatch(structuredClone(prepared)), ports); }
    catch (error) {
      if (error instanceof SuccessorDispatchWithheld)
        this.change(row, error.detail === "deadline_passed" ? "expired" : "rejected", error.detail, ports, "dispatching");
      else this.change(row, "unknown", "outcome_unknown", ports, "dispatching");
    }
    await this.auth(ports, prepared, false);
    await this.observe(this.require(actor, id), ports);
    await this.auth(ports, prepared, false);
    return this.dto(this.require(actor, id));
  }

  async discard(actor: string, id: string, ports: SuccessorPorts): Promise<SuccessorReceipt> {
    const row = this.require(actor, id);
    await this.auth(ports, this.prepared(row), false);
    this.expire(row, ports);
    this.change(row, "rejected", "review_discarded", ports, "prepared");
    return this.dto(this.require(actor, id));
  }

  async get(actor: string, id: string, ports: SuccessorPorts): Promise<SuccessorReceipt> {
    let row = this.require(actor, id);
    const prepared = this.prepared(row);
    await this.auth(ports, prepared, false);
    row = this.expire(this.require(actor, id), ports);
    if (row.state === "dispatching" || row.state === "unknown") {
      let result: NativeCommandStatus | undefined;
      try { result = nativeCommandStatusSchema.parse(await ports.lookup(structuredClone(prepared))); }
      catch { /* Transport uncertainty is retained; authorization is checked outside this catch. */ }
      await this.auth(ports, prepared, false);
      if (result?.status === "found") {
        try { this.record(row, prepared, result.receipt!, ports); }
        catch { this.change(row, "unknown", "outcome_unknown", ports, "dispatching"); }
      } else this.change(row, "unknown", "outcome_unknown", ports, "dispatching");
    }
    await this.observe(this.require(actor, id), ports);
    await this.auth(ports, prepared, false);
    return this.dto(this.require(actor, id));
  }

  async list(actor: string, runKey: string, ports: SuccessorPorts): Promise<SuccessorReceiptPage> {
    this.actor(actor);
    if (!idSchema.safeParse(runKey).success) throw fail(400, "invalid_run_key");
    await this.auth(ports, null, false);
    const rows = this.store.db.prepare("SELECT * FROM successor_intents WHERE actor=? AND run_key=? ORDER BY created_at DESC,rowid DESC LIMIT 101")
      .all(actor, runKey) as unknown as Row[];
    const receipts: SuccessorReceipt[] = [];
    for (const row of rows.slice(0, 100)) receipts.push(await this.get(actor, row.id, ports));
    // A later entry may await while an earlier entry's access is revoked.
    for (const row of rows.slice(0, 100)) await this.auth(ports, this.prepared(row), false);
    await this.auth(ports, null, false);
    return { receipts, hasMore: rows.length > 100 };
  }

  acceptedRunIds(sourceId: string, sourceIdentity: string): string[] {
    const rows = this.store.db.prepare("SELECT * FROM successor_intents WHERE state='accepted' AND observed=1").all() as unknown as Row[];
    return [...new Set(rows.flatMap(row => {
      const p = this.prepared(row);
      return p.target.sourceId === sourceId && p.target.sourceIdentity === sourceIdentity ? [this.dto(row).newRunId!] : [];
    }))];
  }

  private actor(actor: string): void { if (typeof actor !== "string" || !actor.trim()) throw fail(400, "invalid_actor"); }
  private find(actor: string, id: string): Row | undefined {
    return this.store.db.prepare("SELECT * FROM successor_intents WHERE actor=? AND id=?").get(actor, id) as Row | undefined;
  }
  private require(actor: string, id: string): Row {
    this.actor(actor);
    if (!z.uuid().safeParse(id).success) throw fail(400, "invalid_receipt_id");
    const row = this.find(actor, id);
    if (!row) throw fail(404, "receipt_not_found");
    return row;
  }
  private prepared(row: Row): PreparedSuccessor {
    try {
      const saved = z.object({ target: targetSchema, scopeIdentity: z.string().min(1), command: nativeCommandDescriptorSchema }).strict().parse(JSON.parse(row.private_json));
      // Recovery ports receive a descriptor-only native value after claim. It is never parsed
      // as a continue write or sent to dispatch; only the claimant retains the complete body.
      let native: NativeCommandWrite = { command: saved.command };
      if (row.input_json !== null || row.state === "prepared") {
        native = nativeCommandWriteSchema.parse({ command: saved.command,
          ...(row.input_json === null ? {} : { input: JSON.parse(row.input_json) as unknown }) });
        if ((native.input !== undefined && native.input.length !== 1) ||
            hash([row.actor, row.id, row.run_key, native.command.kind, native.command.expiresAt,
              native.input?.[0]?.text ?? null]) !== row.digest) throw fail(500, "invalid_stored_intent");
      }
      return { target: saved.target, scopeIdentity: saved.scopeIdentity, native };
    } catch { throw fail(500, "invalid_stored_intent"); }
  }
  private async auth(ports: SuccessorPorts, prepared: PreparedSuccessor | null, writing: boolean): Promise<void> {
    try { await ports.authorize(structuredClone(prepared), writing); }
    catch (error) {
      const changed = error instanceof CommandError && (error.status === 409 || error.code === "review_changed");
      throw fail(changed ? 409 : 403, changed ? "review_changed" : "authority_changed");
    }
  }
  private rejectAuthority(row: Row, error: unknown, ports: SuccessorPorts, from: string): void {
    this.change(row, "rejected", error instanceof CommandError && error.code === "review_changed" ? "review_changed" : "authority_changed", ports, from);
  }
  private change(row: Row, state: Row["state"], detail: Row["detail"], ports: SuccessorPorts, from: string): void {
    this.store.db.prepare("UPDATE successor_intents SET state=?,detail=?,input_json=NULL,updated_at=? WHERE actor=? AND id=? AND state=?")
      .run(state, detail, stamp(ports), row.actor, row.id, from);
  }
  private expire(row: Row, ports: SuccessorPorts): Row {
    if (row.state === "prepared" && Date.parse(this.prepared(row).native.command.expiresAt) <= (ports.now ?? Date.now)()) {
      this.change(row, "expired", "deadline_passed", ports, "prepared");
    }
    return this.require(row.actor, row.id);
  }
  private record(row: Row, p: PreparedSuccessor, raw: unknown, ports: SuccessorPorts): void {
    const receipt = nativeCommandReceiptSchema.parse(raw);
    if (receipt.command_id !== row.id || receipt.session_id !== p.target.sessionId || receipt.source_run_id !== p.target.runId ||
        receipt.kind !== p.native.command.kind || Date.parse(receipt.expires_at) !== Date.parse(p.native.command.expiresAt)) throw fail(502, "invalid_native_receipt");
    this.store.db.prepare(`UPDATE successor_intents SET state=?,detail=?,receipt_json=?,input_json=NULL,updated_at=?
      WHERE actor=? AND id=? AND state IN ('dispatching','unknown')`)
      .run(receipt.outcome, receipt.outcome === "accepted" ? "observation_pending" : "native_rejected",
        JSON.stringify(receipt), stamp(ports), row.actor, row.id);
  }
  private async observe(row: Row, ports: SuccessorPorts): Promise<void> {
    if (row.state !== "accepted" || row.observed) return;
    const prepared = this.prepared(row);
    await this.auth(ports, prepared, false);
    let observed = false;
    try { observed = await ports.observeAccepted(structuredClone(prepared), nativeCommandReceiptSchema.parse(JSON.parse(row.receipt_json!))); }
    catch { /* Acceptance is durable even when materialization is temporarily unavailable. */ }
    await this.auth(ports, prepared, false);
    if (observed) this.store.db.prepare("UPDATE successor_intents SET observed=1,detail='accepted',updated_at=? WHERE actor=? AND id=? AND state='accepted'")
      .run(stamp(ports), row.actor, row.id);
  }
  private dto(row: Row): SuccessorReceipt {
    const p = this.prepared(row);
    const receipt = row.receipt_json ? nativeCommandReceiptSchema.parse(JSON.parse(row.receipt_json)) : null;
    return successorReceiptSchema.parse({ id: row.id, runKey: row.run_key, sourceId: p.target.sourceId,
      runId: p.target.runId, sessionId: p.target.sessionId, kind: p.native.command.kind,
      sourceStatus: p.target.sourceStatus, expectedCursor: p.target.expectedCursor, state: row.state, detail: row.detail,
      expiresAt: p.native.command.expiresAt, createdAt: row.created_at, updatedAt: row.updated_at,
      newRunId: row.state === "accepted" ? receipt!.new_run_id : null, relation: row.state === "accepted" ? receipt!.relation : null,
      observationState: row.state === "accepted" ? row.observed ? "observed" : "pending" : null });
  }
}
