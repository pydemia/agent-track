import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  bindingSchema, compareSequence, eventSchema, externalKey, runSchema,
  terminalStatuses,
  type EventView, type ObservationEvent, type RelationView, type RunBinding,
  type RunObservation, type RunStatus, type RunView, type Snapshot, type SourceView,
} from "../contracts/index.ts";

interface RunRow {
  key: string;
  observation: string;
  cursor: string;
  high_water: string;
  binding: string | null;
  history_pruned: number;
}
interface EventRow { ordinal: number; payload: string; received_at: string }

export class Store {
  readonly db: DatabaseSync;
  private viewEpoch = randomUUID();
  private viewVersion = 0n;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO metadata VALUES ('schema_version','1');
      CREATE TABLE IF NOT EXISTS runs (
        key TEXT PRIMARY KEY, source_id TEXT NOT NULL, run_id TEXT NOT NULL,
        observation TEXT NOT NULL, cursor TEXT NOT NULL DEFAULT '0',
        high_water TEXT NOT NULL DEFAULT '0', binding TEXT,
        UNIQUE(source_id,run_id)
      );
      CREATE TABLE IF NOT EXISTS events (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        run_key TEXT NOT NULL REFERENCES runs(key), sequence TEXT NOT NULL,
        digest TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL,
        UNIQUE(run_key,sequence)
      );
      CREATE INDEX IF NOT EXISTS events_run ON events(run_key,ordinal);
      CREATE TABLE IF NOT EXISTS bindings (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
        run_key TEXT NOT NULL REFERENCES runs(key),
        payload TEXT NOT NULL, actor TEXT NOT NULL, bound_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS receipts (
        key TEXT PRIMARY KEY, actor TEXT NOT NULL, run_key TEXT NOT NULL,
        digest TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_digests (
        run_key TEXT NOT NULL REFERENCES runs(key), sequence TEXT NOT NULL,
        digest TEXT NOT NULL, PRIMARY KEY(run_key,sequence)
      );
    `);
    const version = this.db.prepare("SELECT value FROM metadata WHERE key='schema_version'").get() as { value: string };
    if (!["1", "2"].includes(version.value)) throw new Error("Unsupported storage schema");
    if (version.value === "1") {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.exec("ALTER TABLE runs ADD COLUMN history_pruned INTEGER NOT NULL DEFAULT 0");
        this.db.exec("UPDATE metadata SET value='2' WHERE key='schema_version'");
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
  }

  close(): void { this.db.close(); }

  pinSourceIdentity(sourceId: string, fingerprint: string): boolean {
    const key = `source_identity:${sourceId}`;
    this.db.prepare("INSERT OR IGNORE INTO metadata(key,value) VALUES(?,?)").run(key, fingerprint);
    return this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value === fingerprint;
  }

  observeRun(input: RunObservation): string {
    const value = runSchema.parse(input);
    const key = externalKey(value.sourceId, value.runId);
    const previous = this.run(key);
    if (previous) {
      const old = JSON.parse(previous.observation) as RunObservation;
      if (old.sessionId !== value.sessionId) throw new Error("Run session identity changed");
      if (old.observedAt > value.observedAt) return key;
      // A transport replay cannot turn a finished immutable Run back into running.
      if (terminalStatuses.has(old.status) && !terminalStatuses.has(value.status)) {
        value.status = old.status;
        value.startedAt = old.startedAt;
        value.completedAt = old.completedAt;
      }
    }
    this.db.prepare(`INSERT INTO runs(key,source_id,run_id,observation) VALUES (?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET observation=excluded.observation`)
      .run(key, value.sourceId, value.runId, JSON.stringify(value));
    return key;
  }

  run(key: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM runs WHERE key=?").get(key) as RunRow | undefined;
  }

  ingest(input: ObservationEvent): "inserted" | "duplicate" {
    const event = eventSchema.parse(input);
    const key = externalKey(event.sourceId, event.runId);
    const row = this.run(key);
    if (!row) throw new Error("Observe the authorized Run before ingesting events");
    const payload = JSON.stringify(event);
    const digest = createHash("sha256").update(payload).digest("hex");
    const old = this.db.prepare("SELECT digest FROM events WHERE run_key=? AND sequence=? UNION ALL SELECT digest FROM event_digests WHERE run_key=? AND sequence=? LIMIT 1")
      .get(key, event.sequence, key, event.sequence) as { digest: string } | undefined;
    if (old) {
      if (old.digest !== digest) throw new Error("Conflicting event at immutable source sequence");
      return "duplicate";
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO events(run_key,sequence,digest,payload,received_at) VALUES(?,?,?,?,?)")
        .run(key, event.sequence, digest, payload, new Date().toISOString());
      let cursor = BigInt(row.cursor);
      const exists = this.db.prepare("SELECT 1 FROM events WHERE run_key=? AND sequence=?");
      while (exists.get(key, (cursor + 1n).toString())) cursor += 1n;
      const highWater = compareSequence(row.high_water, event.sequence) < 0 ? event.sequence : row.high_water;
      this.db.prepare("UPDATE runs SET cursor=?,high_water=? WHERE key=?")
        .run(cursor.toString(), highWater, key);
      this.db.exec("COMMIT");
      return "inserted";
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  bind(input: RunBinding, actor: string): void {
    const binding = bindingSchema.parse(input);
    const key = externalKey(binding.sourceId, binding.runId);
    if (!this.run(key)) throw new Error("Unknown Run");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO bindings(run_key,payload,actor,bound_at) VALUES(?,?,?,?)")
        .run(key, JSON.stringify(binding), actor, new Date().toISOString());
      this.db.prepare("UPDATE runs SET binding=? WHERE key=?").run(JSON.stringify(binding), key);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  bindingHistory(key: string): unknown[] {
    return this.db.prepare("SELECT payload,actor,bound_at FROM bindings WHERE run_key=? ORDER BY ordinal")
      .all(key).map((row) => ({ ...row, payload: JSON.parse(String(row.payload)) }));
  }

  cursor(sourceId: string, runId: string): string {
    return this.run(externalKey(sourceId, runId))?.cursor ?? "0";
  }

  events(key: string, after = "0", limit = 200): { events: EventView[]; nextCursor: string; hasMore: boolean } {
    // This cursor is Track's local paging ordinal, not the source SSE sequence.
    if (!/^(0|[1-9][0-9]{0,14})$/.test(after)) throw new Error("Invalid local page cursor");
    const rows = this.db.prepare("SELECT ordinal,payload,received_at FROM events WHERE run_key=? AND ordinal>? ORDER BY ordinal LIMIT ?")
      .all(key, Number(after), limit + 1) as unknown as EventRow[];
    const page = rows.slice(0, limit);
    return {
      events: page.map((row) => ({ ...JSON.parse(row.payload) as ObservationEvent, key: String(row.ordinal), receivedAt: row.received_at })),
      nextCursor: page.at(-1)?.ordinal.toString() ?? after,
      hasMore: rows.length > limit,
    };
  }

  snapshot(user: string, sources: Array<SourceView & { uiBaseUrl?: string }>, now = Date.now()): Snapshot {
    const allowed = new Map(sources.map((source) => [source.id, source]));
    const rows = this.db.prepare("SELECT * FROM runs ORDER BY key").all() as unknown as RunRow[];
    const runs: RunView[] = [];
    const relations: RelationView[] = [];
    for (const row of rows) {
      const observation = JSON.parse(row.observation) as RunObservation;
      const source = allowed.get(observation.sourceId);
      if (!source || source.state === "forbidden" || source.state === "unsupported") continue;
      const binding = row.binding ? JSON.parse(row.binding) as RunBinding : null;
      // Attached Project visibility is a second independent grant.
      if (binding) {
        const projectSource = allowed.get(binding.projectSourceId);
        if (projectSource?.kind !== "projects" || projectSource.state !== "connected" ||
            !projectSource.authorizedProjectIds?.includes(binding.projectId)) continue;
      }
      const sourceUrl = source.kind === "demian" && source.uiBaseUrl
        ? new URL(`sessions/${encodeURIComponent(observation.sessionId)}`, `${source.uiBaseUrl.replace(/\/$/, "")}/`).href : null;
      runs.push({
        ...observation, key: row.key, cursor: row.cursor, highWater: row.high_water,
        incomplete: row.cursor !== row.high_water || row.history_pruned === 1,
        stale: source.state !== "connected" || (!terminalStatuses.has(observation.status) && now - Date.parse(observation.observedAt) > 90_000),
        binding, sourceLabel: source.label, device: source.device,
        sourceState: source.state, sourceUrl, capabilities: source.capabilities,
        workspaceKey: observation.workspaceId ? `workspace:${createHash("sha256").update(JSON.stringify([observation.sourceId, observation.workspaceId])).digest("base64url")}` : null,
        projectKey: binding ? `project:${createHash("sha256").update(JSON.stringify([binding.projectSourceId, binding.projectId])).digest("base64url")}` : null,
      });
      relations.push(...this.relations(row.key));
    }
    const revision = this.db.prepare("SELECT coalesce(max(ordinal),0) AS value FROM events").get() as { value: number };
    return {
      viewEpoch: this.viewEpoch, viewVersion: String(++this.viewVersion),
      revision: String(revision.value), generatedAt: new Date(now).toISOString(), user,
      runs: runs.sort((a, b) => b.observedAt.localeCompare(a.observedAt)),
      sources: sources.map(({ uiBaseUrl: _url, ...source }) => source), relations,
    };
  }

  private relations(key: string): RelationView[] {
    const rows = this.db.prepare("SELECT payload FROM events WHERE run_key=? ORDER BY ordinal").all(key);
    const edges = new Map<string, RelationView>();
    const append = (event: ObservationEvent, kind: RelationView["kind"], from: string, to: string): void => {
      const edgeKey = externalKey(key, kind, from, to);
      edges.set(edgeKey, { key: edgeKey, runKey: key, kind, from, to, evidenceSequence: event.sequence, observedAt: event.occurredAt });
    };
    for (const row of rows) {
      const event = JSON.parse(String(row.payload)) as ObservationEvent;
      const d = event.data;
      if (event.type.startsWith("agent.invocation.") && d.invocationId) {
        append(event, "invocation", d.parentInvocationId ? `invocation:${d.parentInvocationId}` : `run:${event.runId}`, `invocation:${d.invocationId}`);
      }
      if (event.type.startsWith("cowork.") && d.groupId) {
        append(event, "cowork", d.parentInvocationId ? `invocation:${d.parentInvocationId}` : `run:${event.runId}`, `group:${d.groupId}`);
        if (d.memberId) append(event, "cowork", `group:${d.groupId}`, `member:${d.memberId}`);
      }
      if (event.type.startsWith("managed_child.") && d.childRunId) append(event, "managed-child", `run:${event.runId}`, `run:${d.childRunId}`);
      if (event.type.startsWith("peer.") && d.peerSessionId) append(event, "peer", `run:${event.runId}`, `session:${d.peerSessionId}`);
      if (d.artifactId) append(event, "artifact", `run:${event.runId}`, `artifact:${d.artifactId}`);
    }
    return [...edges.values()];
  }

  integrity(): string {
    const result = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    return result.integrity_check;
  }

  pruneBefore(cutoff: string): { runs: number; events: number } {
    const limit = Date.parse(cutoff);
    if (!Number.isFinite(limit)) throw new Error("ISO cutoff required");
    const rows = this.db.prepare("SELECT * FROM runs").all() as unknown as RunRow[];
    let count = 0;
    let affected = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        const run = JSON.parse(row.observation) as RunObservation;
        if (!terminalStatuses.has(run.status) || !run.completedAt || Date.parse(run.completedAt) >= limit || row.cursor !== row.high_water) continue;
        this.db.prepare("INSERT OR IGNORE INTO event_digests SELECT run_key,sequence,digest FROM events WHERE run_key=?").run(row.key);
        const result = this.db.prepare("DELETE FROM events WHERE run_key=?").run(row.key);
        if (result.changes) {
          this.db.prepare("UPDATE runs SET history_pruned=1 WHERE key=?").run(row.key);
          affected++; count += Number(result.changes);
        }
      }
      this.db.exec("COMMIT");
      return { runs: affected, events: count };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}
