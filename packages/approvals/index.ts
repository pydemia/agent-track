import { createHash } from "node:crypto";
import { z } from "zod";
import {
  approvalRequestSchema, externalKey, permissionDecisionSchema, permissionViewSchema,
  statusSchema,
  type ApprovalReceipt, type ApprovalReceiptState, type ApprovalRequest,
  type PermissionDecision, type PermissionView, type RunStatus,
} from "../contracts/index.ts";
import { CommandError } from "../commands/index.ts";
import { Store } from "../storage/store.ts";

export interface ApprovalObservation {
  sourceId: string;
  runId: string;
  runStatus: RunStatus;
  permission: PermissionView;
}

export interface ApprovalPorts {
  authorize(): Promise<void>;
  read(permissionId: string): Promise<ApprovalObservation>;
  decide(permissionId: string, decision: PermissionDecision): Promise<ApprovalObservation>;
  now?: () => number;
}

interface ApprovalRow {
  actor: string;
  id: string;
  run_key: string;
  permission_id: string;
  digest: string;
  payload: string;
}

interface StoredPayload {
  receipt: ApprovalReceipt;
  fingerprint: string;
  expiresAt: string;
}

const observationSchema = z.object({
  sourceId: z.string().min(1),
  runId: z.string().min(1),
  runStatus: statusSchema,
  permission: permissionViewSchema,
}).strict();
const receiptStates = new Set<ApprovalReceiptState>([
  "requested", "dispatching", "succeeded", "failed", "expired", "unknown",
]);

export class ApprovalService {
  constructor(private readonly store: Store) {
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS approval_receipts (
      actor TEXT NOT NULL,
      id TEXT NOT NULL,
      run_key TEXT NOT NULL,
      permission_id TEXT NOT NULL,
      digest TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(actor,id)
    );
    CREATE INDEX IF NOT EXISTS approval_receipts_permission
      ON approval_receipts(actor,run_key,permission_id);`);
  }

  async execute(actor: string, raw: unknown, ports: ApprovalPorts): Promise<ApprovalReceipt> {
    this.requireActor(actor);
    const parsed = approvalRequestSchema.safeParse(raw);
    if (!parsed.success) throw new CommandError(400, "invalid_approval", "Invalid approval request.");
    const input = parsed.data;
    const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");

    // Authorization deliberately precedes all receipt lookup, including idempotent replay.
    await this.authorize(ports);
    const prior = this.find(actor, input.id);
    if (prior) return this.replay(prior, digest);

    const startedAt = this.now(ports);
    const deadline = Date.parse(input.expiresAt);
    if (deadline > startedAt + 120_000) {
      throw new CommandError(400, "invalid_deadline", "Approval deadline must be within 120 seconds.");
    }
    if (deadline <= startedAt) {
      return this.insert(actor, input, digest, "expired", "client_deadline_expired", false).receipt;
    }

    const requested = this.insert(actor, input, digest, "requested", "approval_requested", true);
    if (!requested.inserted) return requested.receipt;

    let observed: ApprovalObservation;
    try {
      observed = observationSchema.parse(await ports.read(input.permissionId));
    } catch {
      return this.update(actor, input.id, "failed", "source_observation_unavailable");
    }

    const identityError = this.validateIdentity(input, observed);
    if (identityError) return this.update(actor, input.id, "failed", identityError);

    try {
      await ports.authorize();
    } catch {
      return this.update(actor, input.id, "failed", "source_access_revoked_before_dispatch");
    }

    if (Date.parse(input.expiresAt) <= this.now(ports)) {
      return this.update(actor, input.id, "expired", "client_deadline_expired_before_dispatch");
    }
    if (observed.permission.status === "resolved") {
      return observed.permission.decision === input.decision
        ? this.update(actor, input.id, "succeeded", "observed_resolution_no_dispatch")
        : this.update(actor, input.id, "failed", "conflicting_resolution_no_dispatch");
    }
    if (Date.parse(observed.permission.expiresAt) <= this.now(ports) || observed.permission.status === "expired") {
      return this.update(actor, input.id, "expired", "native_permission_expired_before_dispatch");
    }
    if (observed.runStatus !== "running" && observed.runStatus !== "waiting_for_permission") {
      return this.update(actor, input.id, "failed", "run_not_eligible_for_permission_decision");
    }

    // The permission's expiry can pass while authorization is awaited; recheck just before election.
    if (Date.parse(observed.permission.expiresAt) <= this.now(ports)) {
      return this.update(actor, input.id, "expired", "native_permission_expired_before_dispatch");
    }
    const dispatching = this.update(actor, input.id, "dispatching", "native_decision_dispatching");
    if (dispatching.state !== "dispatching") return dispatching;
    let response: ApprovalObservation;
    try {
      response = observationSchema.parse(await ports.decide(input.permissionId, input.decision));
    } catch {
      return this.update(actor, input.id, "unknown", "native_decision_outcome_unknown_no_resend");
    }
    if (this.validateIdentity(input, response)) {
      return this.update(actor, input.id, "unknown", "native_response_identity_or_fingerprint_mismatch");
    }
    if (response.permission.status !== "resolved" || response.permission.decision !== input.decision) {
      return this.update(actor, input.id, "unknown", "native_response_did_not_confirm_requested_decision");
    }
    // A confirmed permission decision says nothing about completion of the tool Run.
    return this.update(actor, input.id, "succeeded", "native_permission_decision_recorded");
  }

  list(actor: string, runKey: string): ApprovalReceipt[] {
    this.requireActor(actor);
    const rows = this.store.db.prepare(`SELECT * FROM approval_receipts
      WHERE actor=? AND run_key=? ORDER BY json_extract(payload,'$.receipt.createdAt'),id`).all(actor, runKey) as unknown as ApprovalRow[];
    return rows.map((row) => this.readPayload(row).receipt);
  }

  async reconcile(actor: string, id: string, ports: ApprovalPorts): Promise<ApprovalReceipt> {
    this.requireActor(actor);
    if (!z.uuid().safeParse(id).success) {
      throw new CommandError(400, "invalid_receipt_id", "Approval receipt ID must be a UUID.");
    }
    await this.authorize(ports);
    const row = this.find(actor, id);
    if (!row) throw new CommandError(404, "receipt_not_found", "Approval receipt was not found.");
    const saved = this.readPayload(row);
    if (["succeeded", "failed", "expired"].includes(saved.receipt.state)) return saved.receipt;

    let observed: ApprovalObservation;
    try {
      observed = observationSchema.parse(await ports.read(row.permission_id));
    } catch {
      throw new CommandError(502, "source_observation_unavailable", "Fresh permission observation is unavailable.");
    }
    try {
      await ports.authorize();
    } catch {
      throw new CommandError(403, "source_forbidden", "Current source access is unavailable.");
    }

    const latest = this.find(actor, id);
    if (!latest) throw new CommandError(404, "receipt_not_found", "Approval receipt was not found.");
    const latestReceipt = this.readPayload(latest).receipt;
    if (["succeeded", "failed", "expired"].includes(latestReceipt.state)) return latestReceipt;

    if (externalKey(observed.sourceId, observed.runId) !== row.run_key ||
        observed.permission.runId !== observed.runId || observed.permission.id !== row.permission_id ||
        observed.permission.fingerprint !== saved.fingerprint) {
      return this.update(actor, id, "unknown", "reconcile_observation_identity_or_fingerprint_mismatch");
    }
    if (observed.permission.status === "resolved") {
      return observed.permission.decision === saved.receipt.decision
        ? this.update(actor, id, "succeeded", "runtime_resolution_observed_attribution_unknown")
        : this.update(actor, id, "failed", "conflicting_runtime_resolution_observed");
    }
    if (observed.permission.status === "expired" || Date.parse(observed.permission.expiresAt) <= this.now(ports)) {
      return this.update(actor, id, "expired", "native_permission_expired_on_reconcile");
    }
    if (saved.receipt.state !== "unknown") {
      return this.update(actor, id, "unknown", "runtime_permission_still_unresolved_no_resend");
    }
    return saved.receipt;
  }

  recoverInterrupted(): number {
    const rows = this.store.db.prepare("SELECT * FROM approval_receipts").all() as unknown as ApprovalRow[];
    const interrupted = rows.filter((row) => {
      try {
        const state: unknown = (JSON.parse(row.payload) as StoredPayload).receipt?.state;
        return state === "requested" || state === "dispatching";
      } catch { return false; }
    });
    for (const row of interrupted) {
      this.update(row.actor, row.id, "unknown", "process_restarted_before_native_completion_confirmed");
    }
    return interrupted.length;
  }

  private validateIdentity(input: ApprovalRequest, observed: ApprovalObservation): string | null {
    if (externalKey(observed.sourceId, observed.runId) !== input.runKey ||
        observed.permission.runId !== observed.runId || observed.permission.id !== input.permissionId) {
      return "source_permission_identity_mismatch";
    }
    if (observed.permission.fingerprint !== input.fingerprint) return "permission_fingerprint_mismatch";
    return null;
  }

  private insert(
    actor: string, input: ApprovalRequest, digest: string,
    state: ApprovalReceiptState, detail: string, elect: boolean,
  ): { receipt: ApprovalReceipt; inserted: boolean } {
    const now = this.nowIso();
    const receipt: ApprovalReceipt = { id: input.id, runKey: input.runKey, permissionId: input.permissionId,
      decision: input.decision, state, createdAt: now, updatedAt: now, detail };
    const payload: StoredPayload = { receipt, fingerprint: input.fingerprint, expiresAt: input.expiresAt };
    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.find(actor, input.id);
      if (existing) {
        this.store.db.exec("COMMIT");
        return { receipt: this.replay(existing, digest), inserted: false };
      }
      if (elect && this.store.db.prepare(`SELECT id FROM approval_receipts
        WHERE actor=? AND run_key=? AND permission_id=?
        AND json_extract(payload,'$.receipt.state') IN ('requested','dispatching','unknown') LIMIT 1`)
        .get(actor, input.runKey, input.permissionId)) {
        throw new CommandError(409, "approval_pending", "An approval outcome is unresolved for this permission.");
      }
      this.store.db.prepare(`INSERT INTO approval_receipts
        (actor,id,run_key,permission_id,digest,payload) VALUES(?,?,?,?,?,?)`)
        .run(actor, input.id, input.runKey, input.permissionId, digest, JSON.stringify(payload));
      this.store.db.exec("COMMIT");
      return { receipt, inserted: true };
    } catch (error) {
      try { this.store.db.exec("ROLLBACK"); } catch { /* transaction may already be closed */ }
      if (error instanceof CommandError) throw error;
      throw new CommandError(500, "receipt_write_failed", "Could not persist approval receipt.");
    }
  }

  private update(actor: string, id: string, state: ApprovalReceiptState, detail: string): ApprovalReceipt {
    const row = this.find(actor, id);
    if (!row) throw new CommandError(500, "receipt_write_failed", "Could not update approval receipt.");
    const payload = this.readPayload(row);
    if (["succeeded", "failed", "expired"].includes(payload.receipt.state)) return payload.receipt;
    const timestamp = this.nowIso();
    payload.receipt = { ...payload.receipt, state, detail, updatedAt: timestamp };
    const updated = this.store.db.prepare("UPDATE approval_receipts SET payload=? WHERE actor=? AND id=? AND payload=?")
      .run(JSON.stringify(payload), actor, id, row.payload);
    if (updated.changes) return payload.receipt;
    const current = this.find(actor, id);
    if (!current) throw new CommandError(500, "receipt_write_failed", "Could not update approval receipt.");
    return this.readPayload(current).receipt;
  }

  private find(actor: string, id: string): ApprovalRow | undefined {
    return this.store.db.prepare("SELECT * FROM approval_receipts WHERE actor=? AND id=?")
      .get(actor, id) as ApprovalRow | undefined;
  }

  private readPayload(row: ApprovalRow): StoredPayload {
    try {
      const parsed: unknown = JSON.parse(row.payload);
      if (typeof parsed === "object" && parsed !== null && "receipt" in parsed &&
          typeof parsed.receipt === "object" && parsed.receipt !== null) {
        const receipt = parsed.receipt as ApprovalReceipt;
        if (receiptStates.has(receipt.state)) return parsed as StoredPayload;
      }
    } catch { /* Corrupt local row becomes a generic safe error. */ }
    throw new CommandError(500, "receipt_read_failed", "Could not read approval receipt.");
  }

  private replay(row: ApprovalRow, digest: string): ApprovalReceipt {
    if (row.digest !== digest) {
      throw new CommandError(409, "idempotency_conflict", "Approval ID was used for a different request.");
    }
    return this.readPayload(row).receipt;
  }

  private async authorize(ports: ApprovalPorts): Promise<void> {
    try { await ports.authorize(); }
    catch { throw new CommandError(403, "source_forbidden", "Current source access is unavailable."); }
  }

  private requireActor(actor: string): void {
    if (typeof actor !== "string" || !actor.trim()) throw new CommandError(400, "invalid_actor", "Actor is required.");
  }

  private now(ports: ApprovalPorts): number { return (ports.now ?? Date.now)(); }
  private nowIso(): string { return new Date().toISOString(); }
}
