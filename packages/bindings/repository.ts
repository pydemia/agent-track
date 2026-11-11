import { bindingSchema, externalKey, type RunBinding, type BindingRecord, type BindingReceipt } from "../contracts/index.ts";
import { Store } from "../storage/store.ts";
export type { BindingRecord, BindingReceipt } from "../contracts/index.ts";

export type BindingConflictCode = "idempotency_conflict" | "binding_conflict" | "run_not_found";

export class BindingConflictError extends Error {
  constructor(readonly code: BindingConflictCode, message: string) {
    super(message);
    this.name = "BindingConflictError";
  }
}

interface ReceiptRow { digest: string; run_key: string; result: string }
interface BindingRow { version: string; payload: string; actor: string; bound_at: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digestPattern = /^[0-9a-f]{64}$/i;
const versionPattern = /^(0|[1-9][0-9]*)$/;

export class BindingRepository {
  constructor(private readonly store: Store) {
    this.store.db.exec(`
      CREATE TABLE IF NOT EXISTS binding_receipts (
        actor TEXT NOT NULL,
        id TEXT NOT NULL,
        digest TEXT NOT NULL,
        run_key TEXT NOT NULL,
        result TEXT NOT NULL,
        PRIMARY KEY(actor,id)
      );
    `);
  }

  currentVersion(runKey: string): string {
    const row = this.store.db.prepare(
      "SELECT CAST(coalesce(max(ordinal),0) AS TEXT) AS version FROM bindings WHERE run_key=?",
    ).get(runKey) as { version: string };
    return row.version;
  }

  history(runKey: string): BindingRecord[] {
    const rows = this.store.db.prepare(
      "SELECT CAST(ordinal AS TEXT) AS version,payload,actor,bound_at FROM bindings WHERE run_key=? ORDER BY ordinal",
    ).all(runKey) as unknown as BindingRow[];
    return rows.map((row) => ({
      version: row.version,
      binding: JSON.parse(row.payload) as RunBinding,
      actor: row.actor,
      recordedAt: row.bound_at,
    }));
  }

  receipt(actor: string, id: string): BindingReceipt | undefined {
    const row = this.store.db.prepare(
      "SELECT result FROM binding_receipts WHERE actor=? AND id=?",
    ).get(actor, id) as { result: string } | undefined;
    return row ? JSON.parse(row.result) as BindingReceipt : undefined;
  }

  apply(input: {
    actor: string;
    id: string;
    requestDigest: string;
    expectedVersion: string;
    binding: RunBinding;
  }): BindingReceipt {
    if (!uuidPattern.test(input.id)) throw new TypeError("Binding id must be a UUID");
    if (!input.actor.trim()) throw new TypeError("Binding actor is required");
    if (!digestPattern.test(input.requestDigest)) throw new TypeError("Request digest must be 64 hexadecimal characters");
    if (!versionPattern.test(input.expectedVersion)) throw new TypeError("Expected version must be a canonical nonnegative decimal");
    const binding = bindingSchema.parse(input.binding);
    const runKey = externalKey(binding.sourceId, binding.runId);
    const requestDigest = input.requestDigest.toLowerCase();

    this.store.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.store.run(runKey)) {
        throw new BindingConflictError("run_not_found", "Run not found");
      }

      const previous = this.store.db.prepare(
        "SELECT digest,run_key,result FROM binding_receipts WHERE actor=? AND id=?",
      ).get(input.actor, input.id) as ReceiptRow | undefined;
      if (previous) {
        if (previous.digest !== requestDigest || previous.run_key !== runKey) {
          throw new BindingConflictError("idempotency_conflict", "Idempotency key was already used for a different request");
        }
        const result = JSON.parse(previous.result) as BindingReceipt;
        this.store.db.exec("COMMIT");
        return result;
      }

      if (this.currentVersion(runKey) !== input.expectedVersion) {
        throw new BindingConflictError("binding_conflict", "Binding version is stale");
      }

      const recordedAt = new Date().toISOString();
      const inserted = this.store.db.prepare(
        "INSERT INTO bindings(run_key,payload,actor,bound_at) VALUES(?,?,?,?) RETURNING CAST(ordinal AS TEXT) AS version",
      ).get(runKey, JSON.stringify(binding), input.actor, recordedAt) as { version: string };
      const result: BindingReceipt = {
        id: input.id,
        runKey,
        version: inserted.version,
        binding,
        recordedAt,
      };
      this.store.db.prepare("UPDATE runs SET binding=? WHERE key=?").run(JSON.stringify(binding), runKey);
      this.store.db.prepare(
        "INSERT INTO binding_receipts(actor,id,digest,run_key,result) VALUES(?,?,?,?,?)",
      ).run(input.actor, input.id, requestDigest, runKey, JSON.stringify(result));
      this.store.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.store.db.exec("ROLLBACK");
      throw error;
    }
  }
}
