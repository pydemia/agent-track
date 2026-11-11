import { createHash } from "node:crypto";
import { z } from "zod";
import { statusSchema, terminalStatuses, type RunStatus } from "../contracts/index.ts";
import { Store } from "../storage/store.ts";

const decimalString = z.string().regex(/^(0|[1-9][0-9]*)$/);
const commandExpiry = z.iso.datetime({ offset: true });
const runReadSchema = z.object({ sourceId: z.string().min(1), runId: z.string().min(1),
  status: statusSchema, cursor: decimalString }).strict();
const cancelResponseSchema = z.object({ sourceId: z.string().min(1),
  runId: z.string().min(1), status: statusSchema }).strict();

export const cancelInputSchema = z.object({
  kind: z.literal("cancel"),
  runKey: z.string().min(1),
  idempotencyKey: z.uuid(),
  expectedCursor: decimalString,
  expiresAt: commandExpiry,
}).strict();

export type CancelInput = z.infer<typeof cancelInputSchema>;
export type ReceiptState = "requested" | "dispatching" | "accepted" |
  "succeeded" | "failed" | "expired" | "unknown";

export interface Receipt {
  id: string;
  actor: string;
  runKey: string;
  kind: "cancel";
  state: ReceiptState;
  createdAt: string;
  updatedAt: string;
  detail: string | null;
}

export class CommandError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "CommandError";
  }
}

export interface CancelPorts {
  authorize(): Promise<void>;
  readRun(): Promise<{ sourceId: string; runId: string; status: RunStatus; cursor: string }>;
  cancel(runId: string): Promise<{ sourceId: string; runId: string; status: RunStatus }>;
  now?: () => number;
}

interface ReceiptRow {
  key: string;
  actor: string;
  run_key: string;
  digest: string;
  state: string;
  result: string | null;
  created_at: string;
  updated_at: string;
}

const receiptStates = new Set<ReceiptState>([
  "requested", "dispatching", "accepted", "succeeded", "failed", "expired", "unknown",
]);
const receiptNamespace = "cancel:";

export class CommandService {
  constructor(private readonly store: Store) {}

  async execute(actor: string, rawInput: unknown, ports: CancelPorts): Promise<Receipt> {
    const parsed = cancelInputSchema.safeParse(rawInput);
    if (!parsed.success) throw new CommandError(400, "invalid_command", "Invalid cancel command.");
    if (!actor.trim()) throw new CommandError(400, "invalid_actor", "Actor is required.");
    const input = parsed.data;
    const target = this.targetIdentity(input.runKey);
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const key = this.receiptKey(actor, input.idempotencyKey);

    await this.authorize(ports);
    const old = this.find(actor, key);
    if (old) {
      if (old.digest !== digest) {
        throw new CommandError(409, "idempotency_conflict", "Idempotency key was used for a different command.");
      }
      return this.toReceipt(old);
    }

    const now = (ports.now ?? Date.now)();
    const expiry = Date.parse(input.expiresAt);
    if (expiry <= now) {
      return this.insertOrRead(actor, input, digest, key, "expired", "Command deadline has passed.").receipt;
    }
    if (expiry > now + 120_000) {
      throw new CommandError(400, "invalid_deadline", "Command deadline must be within 120 seconds.");
    }

    const created = this.insertOrRead(actor, input, digest, key, "requested", null);
    if (!created.inserted) return created.receipt;

    let observed: Awaited<ReturnType<CancelPorts["readRun"]>>;
    try {
      observed = runReadSchema.parse(await ports.readRun());
    } catch {
      this.update(created.receipt, "failed", "Fresh Run observation is unavailable.");
      throw new CommandError(502, "source_observation_unavailable", "Fresh Run observation is unavailable.");
    }
    if (observed.sourceId !== target.sourceId || observed.runId !== target.runId) {
      this.update(created.receipt, "failed", "Fresh Run identity did not match the tracked Run.");
      throw new CommandError(409, "run_identity_mismatch", "Fresh Run identity did not match the tracked Run.");
    }
    if (observed.cursor !== input.expectedCursor) {
      return this.update(created.receipt, "failed", "Run cursor changed before dispatch.");
    }

    try {
      await ports.authorize();
    } catch {
      this.update(created.receipt, "failed", "Source access was revoked before dispatch.");
      throw new CommandError(403, "source_forbidden", "Current source access is unavailable.");
    }
    if (Date.parse(input.expiresAt) <= (ports.now ?? Date.now)()) {
      return this.update(created.receipt, "expired", "Command deadline passed before dispatch.");
    }

    if (observed.status === "cancelling") {
      return this.update(created.receipt, "unknown", "runtime_cancelling_observed; no additional cancel was sent.");
    }
    if (terminalStatuses.has(observed.status)) {
      if (observed.status === "cancelled") {
        return this.update(created.receipt, "succeeded", "Observed Run was already cancelled.");
      }
      return this.update(created.receipt, "failed", `Run was already ${observed.status}; no cancel was sent.`);
    }

    const dispatching = this.update(created.receipt, "dispatching", null);
    let response: Awaited<ReturnType<CancelPorts["cancel"]>>;
    try {
      response = cancelResponseSchema.parse(await ports.cancel(observed.runId));
    } catch {
      return this.update(dispatching, "unknown", "Native cancel outcome is unknown; it will not be resent.");
    }
    if (response.sourceId !== target.sourceId || response.runId !== target.runId) {
      return this.update(dispatching, "unknown", "Native cancel response identified a different Run.");
    }
    if (response.status === "cancelling") {
      return this.update(dispatching, "accepted", "Native source accepted the cancel request.");
    }
    if (response.status === "cancelled") {
      return this.update(dispatching, "succeeded", "Native source reports the Run cancelled.");
    }
    if (terminalStatuses.has(response.status)) {
      return this.update(dispatching, "failed", `Native Run is already ${response.status}; cancel did not complete.`);
    }
    return this.update(dispatching, "unknown", "Native source returned an inconclusive cancel status.");
  }

  list(actor: string, runKey: string): Receipt[] {
    if (!actor.trim()) throw new CommandError(400, "invalid_actor", "Actor is required.");
    const rows = this.store.db.prepare(`SELECT * FROM receipts
      WHERE actor=? AND run_key=? AND key LIKE ? ORDER BY created_at,key`)
      .all(actor, runKey, `${receiptNamespace}%`) as unknown as ReceiptRow[];
    return rows.map((row) => this.toReceipt(row));
  }

  async reconcile(actor: string, receiptId: string, ports: CancelPorts): Promise<Receipt> {
    if (!z.uuid().safeParse(receiptId).success) {
      throw new CommandError(400, "invalid_receipt_id", "Receipt ID must be a UUID.");
    }
    if (!actor.trim()) throw new CommandError(400, "invalid_actor", "Actor is required.");
    await this.authorize(ports);
    const row = this.find(actor, this.receiptKey(actor, receiptId));
    if (!row) throw new CommandError(404, "receipt_not_found", "Command receipt was not found.");
    const receipt = this.toReceipt(row);
    if (["succeeded", "failed", "expired"].includes(receipt.state)) return receipt;

    const target = this.targetIdentity(row.run_key);
    let observed: Awaited<ReturnType<CancelPorts["readRun"]>>;
    try {
      observed = runReadSchema.parse(await ports.readRun());
    } catch {
      throw new CommandError(502, "source_observation_unavailable", "Fresh Run observation is unavailable.");
    }
    if (observed.sourceId !== target.sourceId || observed.runId !== target.runId) {
      throw new CommandError(409, "run_identity_mismatch", "Fresh Run identity did not match the tracked Run.");
    }
    await this.authorize(ports);
    if (observed.status === "cancelled") {
      return this.update(receipt, "succeeded", "runtime_cancelled_observed");
    }
    if (terminalStatuses.has(observed.status)) {
      return this.update(receipt, "failed", `Run is terminal (${observed.status}); cancel is not confirmed.`);
    }
    if (receipt.state === "unknown") return receipt;
    if (observed.status === "cancelling" && receipt.state !== "accepted") {
      return this.update(receipt, "unknown", "runtime_cancelling_observed; request acceptance is unconfirmed.");
    }
    if (receipt.state === "requested" || receipt.state === "dispatching") {
      return this.update(receipt, "unknown", "Fresh Run observation does not confirm cancel completion.");
    }
    return receipt;
  }

  recoverInterrupted(): number {
    const now = new Date().toISOString();
    const result = this.store.db.prepare(`UPDATE receipts SET state='unknown',
      result=?,updated_at=? WHERE key LIKE ? AND state IN ('requested','dispatching','accepted')`)
      .run(JSON.stringify({ detail: "Process restarted before native completion was confirmed." }), now,
        `${receiptNamespace}%`);
    return Number(result.changes);
  }

  private async authorize(ports: CancelPorts): Promise<void> {
    try {
      await ports.authorize();
    } catch {
      throw new CommandError(403, "source_forbidden", "Current source access is unavailable.");
    }
  }

  private receiptKey(actor: string, id: string): string {
    const actorDigest = createHash("sha256").update(actor).digest("hex");
    return `${receiptNamespace}${actorDigest}:${id}`;
  }

  private targetIdentity(runKey: string): { sourceId: string; runId: string } {
    try {
      const decoded: unknown = JSON.parse(Buffer.from(runKey, "base64url").toString("utf8"));
      if (Array.isArray(decoded) && decoded.length === 2 &&
          typeof decoded[0] === "string" && typeof decoded[1] === "string" &&
          decoded[0] && decoded[1] &&
          Buffer.from(JSON.stringify(decoded)).toString("base64url") === runKey) {
        return { sourceId: decoded[0], runId: decoded[1] };
      }
    } catch { /* Invalid Track key is reported below without leaking input. */ }
    throw new CommandError(400, "invalid_run_key", "Run key is invalid.");
  }

  private find(actor: string, key: string): ReceiptRow | undefined {
    return this.store.db.prepare("SELECT * FROM receipts WHERE actor=? AND key=?")
      .get(actor, key) as ReceiptRow | undefined;
  }

  private insertOrRead(
    actor: string,
    input: CancelInput,
    digest: string,
    key: string,
    state: ReceiptState,
    detail: string | null,
  ): { receipt: Receipt; inserted: boolean } {
    const timestamp = new Date().toISOString();
    const result = detail === null ? null : JSON.stringify({ detail });
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.find(actor, key);
      if (existing) {
        if (existing.digest !== digest) throw new CommandError(409, "idempotency_conflict", "Idempotency key was used for a different command.");
        this.store.db.exec("COMMIT");
        return { receipt: this.toReceipt(existing), inserted: false };
      }
      // Different tabs can generate different UUIDs for the same desired action.
      // Keep one unresolved cancellation per actor/Run, including across processes.
      if (state === "requested" && this.store.db.prepare(`SELECT key FROM receipts
        WHERE actor=? AND run_key=? AND key LIKE 'cancel:%'
        AND state IN ('requested','dispatching','accepted','unknown') LIMIT 1`).get(actor, input.runKey)) {
        throw new CommandError(409, "cancel_pending", "A cancellation outcome is still unresolved for this Run.");
      }
      this.store.db.prepare(`INSERT INTO receipts
        (key,actor,run_key,digest,state,result,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(key, actor, input.runKey, digest, state,
          result, timestamp, timestamp);
      this.store.db.exec("COMMIT");
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      if (error instanceof CommandError) throw error;
      throw new CommandError(500, "receipt_write_failed", "Could not persist command receipt.");
    }
    const row = this.find(actor, key);
    if (!row) throw new CommandError(500, "receipt_write_failed", "Could not persist command receipt.");
    return { receipt: this.toReceipt(row), inserted: true };
  }

  private update(receipt: Receipt, state: ReceiptState, detail: string | null): Receipt {
    const timestamp = new Date().toISOString();
    this.store.db.prepare(`UPDATE receipts SET state=?,result=?,updated_at=?
      WHERE key=? AND actor=?`).run(state,
        detail === null ? null : JSON.stringify({ detail }), timestamp,
        this.receiptKey(receipt.actor, receipt.id), receipt.actor);
    const row = this.find(receipt.actor, this.receiptKey(receipt.actor, receipt.id));
    if (!row) throw new CommandError(500, "receipt_write_failed", "Could not update command receipt.");
    return this.toReceipt(row);
  }

  private toReceipt(row: ReceiptRow): Receipt {
    let detail: string | null = null;
    try {
      const value: unknown = row.result === null ? null : JSON.parse(row.result);
      if (typeof value === "object" && value !== null &&
          "detail" in value && typeof value.detail === "string") detail = value.detail;
    } catch { /* Malformed legacy result remains private and is omitted. */ }
    const state = receiptStates.has(row.state as ReceiptState)
      ? row.state as ReceiptState : "unknown";
    const id = row.key.slice(row.key.lastIndexOf(":") + 1);
    return { id, actor: row.actor, runKey: row.run_key, kind: "cancel", state,
      createdAt: row.created_at, updatedAt: row.updated_at, detail };
  }
}
