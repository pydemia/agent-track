import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type { Store } from "../../storage/store.ts";
import { idSchema, timestampSchema, type ObservationEvent, type RunObservation } from "../../contracts/index.ts";

interface LocalRun { run: RunObservation; events: ObservationEvent[] }
export interface CodexOptions { sourceId: string; logRoot: string; repositoryRoots: string[]; maxFiles: number; sinceDays: number }
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const safeId = (value: unknown): string | undefined => idSchema.safeParse(value).success ? String(value) : undefined;
const safeTime = (value: unknown): string | undefined => timestampSchema.safeParse(value).success ? String(value) : undefined;

export async function readCodexFile(path: string, options: CodexOptions): Promise<LocalRun[]> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  let sessionId: string | undefined;
  let workspace: string | undefined;
  let active: LocalRun | undefined;
  const runs = new Map<string, LocalRun>();
  try {
    for await (const line of lines) {
      if (line.length > 4_194_304) continue;
      let row: Record<string, unknown>;
      try { row = record(JSON.parse(line)); } catch { continue; }
      const payload = record(row.payload);
      if (row.type === "session_meta") {
        sessionId = safeId(payload.id ?? payload.session_id);
        const cwd = typeof payload.cwd === "string" ? resolve(payload.cwd) : undefined;
        if (!cwd || !options.repositoryRoots.some((root) => {
          const rest = relative(resolve(root), cwd);
          return rest === "" || (rest !== ".." && !rest.startsWith(`..${sep}`) && !isAbsolute(rest));
        })) return [];
        workspace = cwd;
        continue;
      }
      if (!sessionId || !workspace) continue;
      const timestamp = safeTime(row.timestamp);
      if (!timestamp) continue;
      if (row.type === "event_msg" && payload.type === "task_started") {
        const runId = safeId(payload.turn_id);
        if (!runId) continue;
        active = { run: { sourceId: options.sourceId, runId, sessionId, workspaceId: workspace,
          title: `${basename(workspace)} · ${sessionId.slice(0, 8)}`, status: "running",
          createdAt: timestamp, startedAt: timestamp, completedAt: null, observedAt: timestamp }, events: [] };
        runs.set(runId, active);
        active.events.push({ sourceId: options.sourceId, runId, sequence: "1", type: "run.started", occurredAt: timestamp, data: { redacted: true } });
        continue;
      }
      if (!active) continue;
      active.run.observedAt = timestamp;
      const data: ObservationEvent["data"] = { redacted: true };
      let type: string | undefined;
      if (row.type === "event_msg" && ["task_complete", "task_aborted"].includes(String(payload.type))) {
        const runId = safeId(payload.turn_id);
        const target = runId ? runs.get(runId) : active;
        if (!target) continue;
        active = target;
        active.run.status = payload.type === "task_complete" ? "succeeded" : "interrupted";
        active.run.completedAt = timestamp;
        data.status = active.run.status;
        type = payload.type === "task_complete" ? "run.finished" : "run.interrupted";
      } else if (row.type === "response_item" && ["function_call", "custom_tool_call", "function_call_output", "custom_tool_call_output"].includes(String(payload.type))) {
        type = String(payload.type).endsWith("output") ? "tool.completed" : "tool.started";
        const callId = safeId(payload.call_id);
        if (callId) data.callId = callId;
        if (typeof payload.name === "string" && /^[a-zA-Z0-9_.:-]{1,120}$/.test(payload.name)) data.tool = payload.name;
      }
      if (type) active.events.push({ sourceId: options.sourceId, runId: active.run.runId,
        sequence: String(active.events.length + 1), type, occurredAt: timestamp, data });
    }
  } finally { lines.close(); }
  return [...runs.values()];
}

export class CodexCollector {
  private versions = new Map<string, string>();
  constructor(private store: Store) {}

  async collect(options: CodexOptions): Promise<{ files: number; skipped: number; runs: number }> {
    const files: Array<{ path: string; mtimeMs: number; size: number }> = [];
    const earliest = Date.now() - options.sinceDays * 86_400_000;
    const visit = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const metadata = await stat(path);
          if (metadata.mtimeMs >= earliest) files.push({ path, mtimeMs: metadata.mtimeMs, size: metadata.size });
        }
      }
    };
    await visit(options.logRoot);
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let skipped = Math.max(0, files.length - options.maxFiles);
    let count = 0;
    for (const file of files.slice(0, options.maxFiles)) {
      if (file.size > 64 * 1024 * 1024) { skipped++; continue; }
      const version = `${file.mtimeMs}/${file.size}`;
      if (this.versions.get(file.path) === version) continue;
      for (const item of await readCodexFile(file.path, options)) {
        this.store.observeRun(item.run);
        for (const event of item.events) this.store.ingest(event);
        count++;
      }
      this.versions.set(file.path, version);
    }
    return { files: Math.min(files.length, options.maxFiles), skipped, runs: count };
  }
}
