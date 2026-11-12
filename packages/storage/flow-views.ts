import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { z } from "zod";
import {
  flowViewContentSchema, flowViewIdSchema, flowViewRevisionSchema, savedFlowViewSchema,
  type FlowViewContent, type SavedFlowView,
} from "../contracts/flow-views.ts";

const actorSchema = z.string().min(1).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const contextSchema = flowViewContentSchema.shape.contextId;
const columns = "id, context_id, revision, content, created_at, updated_at";

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error("Invalid flow view input");
  return result.data;
}

function readRecord(row: Record<string, SQLOutputValue>): SavedFlowView {
  try {
    if (typeof row.content !== "string") throw new Error();
    const record = savedFlowViewSchema.parse({
      id: row.id, revision: row.revision, content: JSON.parse(row.content),
      createdAt: row.created_at, updatedAt: row.updated_at,
    });
    if (record.content.contextId !== row.context_id) throw new Error();
    return record;
  } catch {
    // Neither JSON parser messages nor schema issues may disclose stored content.
    throw new Error("Invalid stored flow view");
  }
}

export class FlowViewLimitError extends Error {
  constructor() {
    super("Saved flow view limit reached");
    this.name = "FlowViewLimitError";
  }
}

export class FlowViewRepository {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS saved_flow_views (
      actor TEXT NOT NULL, id TEXT NOT NULL, context_id TEXT NOT NULL,
      revision INTEGER NOT NULL, content TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (actor, id)
    )`);
  }

  list(actor: string, contextId: string): SavedFlowView[] {
    validate(actorSchema, actor);
    validate(contextSchema, contextId);
    return this.db.prepare(`SELECT ${columns} FROM saved_flow_views
      WHERE actor=? AND context_id=? ORDER BY created_at ASC, id ASC`)
      .all(actor, contextId).map(readRecord);
  }

  get(actor: string, id: string): SavedFlowView | undefined {
    validate(actorSchema, actor);
    validate(flowViewIdSchema, id);
    const row = this.db.prepare(`SELECT ${columns} FROM saved_flow_views WHERE actor=? AND id=?`).get(actor, id);
    return row === undefined ? undefined : readRecord(row);
  }

  put(actor: string, id: string, expectedRevision: number, content: FlowViewContent): SavedFlowView | null {
    validate(actorSchema, actor);
    validate(flowViewIdSchema, id);
    validate(flowViewRevisionSchema, expectedRevision);
    const value = validate(flowViewContentSchema, content);
    return this.transaction(() => {
      const previous = this.get(actor, id);
      if (previous ? previous.revision !== expectedRevision : expectedRevision !== 0) return null;
      if (!previous) {
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM saved_flow_views WHERE actor=?").get(actor);
        if (Number(count?.count) >= 20) throw new FlowViewLimitError();
      }
      const now = new Date().toISOString();
      const record = validate(savedFlowViewSchema, {
        id, revision: expectedRevision + 1, content: value,
        createdAt: previous?.createdAt ?? now, updatedAt: now,
      });
      this.db.prepare(`INSERT INTO saved_flow_views
        (actor,id,context_id,revision,content,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(actor,id) DO UPDATE SET context_id=excluded.context_id,
        revision=excluded.revision, content=excluded.content, updated_at=excluded.updated_at`)
        .run(actor, id, value.contextId, record.revision, JSON.stringify(value), record.createdAt, record.updatedAt);
      return record;
    });
  }

  remove(actor: string, id: string, expectedRevision: number): boolean {
    validate(actorSchema, actor);
    validate(flowViewIdSchema, id);
    validate(flowViewRevisionSchema, expectedRevision);
    return this.transaction(() => {
      const previous = this.get(actor, id);
      if (!previous || previous.revision !== expectedRevision) return false;
      return this.db.prepare("DELETE FROM saved_flow_views WHERE actor=? AND id=? AND revision=?")
        .run(actor, id, expectedRevision).changes === 1;
    });
  }

  private transaction<T>(operation: () => T): T {
    // Acquire the write lock before reading revisions or counting the owner's records.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
