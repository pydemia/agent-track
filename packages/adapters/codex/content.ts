import { open, readdir, lstat, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { relative, resolve, sep, isAbsolute } from "node:path";
import type { CodexOptions } from "./index.ts";
import { contentText, workContentSchema, type WorkContent } from "../../contracts/work-content.ts";

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const within = (root: string, path: string) => { const tail = relative(root, path); return tail === "" || tail !== ".." && !tail.startsWith(`..${sep}`) && !isAbsolute(tail); };
const plain = (value: unknown): string => typeof value === "string" ? value : "";
export function requestTitle(text: string): string {
  const cleaned = text.replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
    .replace(/# AGENTS\.md instructions[^\n]*[\s\S]*?<\/INSTRUCTIONS>/gi, "").trim();
  return cleaned.split(/\r?\n/).map(line => line.replace(/^\s*[#*>-]+\s*/, "").trim()).find(line => line && !line.startsWith("<"))?.slice(0, 180) ?? "";
}

/** One known turn inside a current allowed repository; no reasoning/system records. */
export async function readCodexContent(options: CodexOptions, sessionId: string, runId: string, signal?: AbortSignal): Promise<WorkContent> {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(sessionId) || !/^[a-zA-Z0-9_-]{1,200}$/.test(runId)) throw new Error("Local content unavailable");
  const root = resolve(options.logRoot), canonical = await realpath(root);
  if (relative(root, canonical) || (await lstat(root)).isSymbolicLink()) throw new Error("Local content unavailable");
  let visited = 0; const files: string[] = [];
  async function walk(directory: string): Promise<void> {
    if (signal?.aborted) throw new Error("Aborted");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++visited > 20_000) throw new Error("Local content scan limit");
      if (entry.isSymbolicLink()) continue;
      const path = resolve(directory, entry.name);
      if (!within(root, path) || relative(path, await realpath(path))) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith(".jsonl") && entry.name.includes(sessionId)) files.push(path);
    }
  }
  await walk(root);
  if (files.length !== 1) throw new Error("Ambiguous local session");
  const file = files[0]!, before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 64 * 1024 * 1024) throw new Error("Local content unavailable");
  const handle = await open(file, "r");
  const messages: WorkContent["messages"] = []; const seen = new Set<string>();
  let sessionAllowed = false, active = false, found = false, ended = false, incomplete = false, total = 0, toolTotal = 0;
  let failure: WorkContent["failure"] = null, steps: WorkContent["steps"] = [];
  const tools = new Map<string, string>();
  const add = (role: WorkContent["messages"][number]["role"], raw: string, at: unknown, tool: string | null = null, callId: string | null = null) => {
    const identity = JSON.stringify([role, callId, raw]);
    if (!raw || seen.has(identity)) return;
    seen.add(identity);
    if (messages.length >= 80 || total >= 128_000 || role === "tool" && toolTotal >= 64_000) { incomplete = true; return; }
    const text = contentText(raw); const remaining = Math.min(128_000 - total, role === "tool" ? Math.min(8_000, 64_000 - toolTotal) : 32_000);
    if (text.text.length > remaining) { text.text = text.text.slice(0, remaining); text.truncated = true; }
    total += text.text.length; if (role === "tool") toolTotal += text.text.length;
    if (text.truncated) incomplete = true;
    messages.push({ id: `${runId}:${messages.length + 1}`, role, text, occurredAt: typeof at === "string" && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null, tool, callId });
  };
  try {
    const opened = await handle.stat();
    if (opened.ino !== before.ino || opened.dev !== before.dev || opened.nlink !== 1) throw new Error("Local file changed");
    async function* chunks() {
      for (let position = 0; position < before.size;) {
        if (signal?.aborted) throw new Error("Aborted");
        const buffer = Buffer.alloc(Math.min(65_536, before.size - position));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) throw new Error("Local file changed");
        position += bytesRead; yield buffer.subarray(0, bytesRead);
      }
    }
    const stream = Readable.from(chunks());
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    try { for await (const line of lines) {
      if (signal?.aborted) throw new Error("Aborted");
      if (line.length > 4_194_304) { incomplete = true; continue; }
      let row: Record<string, unknown>;
      try { row = record(JSON.parse(line)); } catch { incomplete = true; continue; }
      const p = record(row.payload);
      if (row.type === "session_meta") {
        if (sessionAllowed || plain(p.id ?? p.session_id) !== sessionId || typeof p.cwd !== "string") throw new Error("Local session forbidden");
        const cwd = await realpath(resolve(p.cwd));
        const roots = await Promise.all(options.repositoryRoots.map(repo => realpath(resolve(repo))));
        if (!roots.some(repo => within(repo, cwd))) throw new Error("Local session forbidden");
        sessionAllowed = true; continue;
      }
      if (!sessionAllowed) continue;
      if (row.type === "event_msg" && p.type === "task_started") { active = p.turn_id === runId; if (active) found = true; continue; }
      if (!active) continue;
      if (row.type === "event_msg" && p.type === "user_message") add("user", plain(p.message), row.timestamp);
      else if (row.type === "event_msg" && p.type === "agent_message" && p.phase !== "analysis" && p.channel !== "analysis") add("assistant", plain(p.message), row.timestamp);
      else if (row.type === "response_item" && p.type === "message" && p.phase !== "analysis" && p.channel !== "analysis" && ["user", "assistant"].includes(plain(p.role))) {
        const text = Array.isArray(p.content) ? p.content.map(item => plain(record(item).text)).filter(Boolean).join("\n") : "";
        add(p.role as "user" | "assistant", text, row.timestamp);
      } else if (row.type === "response_item" && ["function_call", "custom_tool_call"].includes(plain(p.type))) {
        const callId = plain(p.call_id), tool = plain(p.name).slice(0, 200); if (callId) tools.set(callId, tool);
        const args = plain(p.arguments ?? p.input); add("tool", args, row.timestamp, tool || null, callId || null);
        if (/(^|[._])update_plan$/.test(tool)) {
          try { const plan = record(JSON.parse(args)).plan;
            if (Array.isArray(plan)) steps = plan.slice(0, 100).flatMap((raw, index) => { const item = record(raw);
              return typeof item.step === "string" && typeof item.status === "string" ? [{ id: `plan:${index}`, title: item.step.slice(0, 500), status: item.status.slice(0, 100), detail: null }] : []; });
          } catch { /* Not a native plan record. */ }
        }
      } else if (row.type === "response_item" && ["function_call_output", "custom_tool_call_output"].includes(plain(p.type))) {
        const callId = plain(p.call_id); add("tool", typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? ""), row.timestamp, tools.get(callId) || null, callId || null);
      } else if (row.type === "event_msg" && ["task_complete", "task_aborted"].includes(plain(p.type)) && (p.turn_id === undefined || p.turn_id === runId)) {
        if (p.type === "task_aborted") failure = { code: "task_aborted", message: plain(p.reason) ? contentText(plain(p.reason)) : null, basis: "local-log" };
        add("assistant", plain(p.last_agent_message), row.timestamp); ended = true; active = false;
      } else if (row.type === "event_msg" && p.type === "error") {
        const error = record(p.error); failure = { code: plain(error.code ?? p.code).slice(0, 200) || "runtime_error", message: plain(error.message ?? p.message) ? contentText(plain(error.message ?? p.message)) : null, basis: "local-log" };
      }
    } } finally { lines.close(); stream.destroy(); }
    const after = await handle.stat();
    if (after.nlink !== 1 || after.ino !== before.ino || after.dev !== before.dev || after.size < before.size || after.size === before.size && after.mtimeMs !== before.mtimeMs || relative(file, await realpath(file))) throw new Error("Local file changed");
    if (!sessionAllowed || !found) throw new Error("Local turn not found");
    const prompt = messages.find(item => item.role === "user" && requestTitle(item.text.text)) ?? messages.find(item => item.role === "user");
    const result = messages.findLast(item => item.role === "assistant")?.text ?? null;
    return workContentSchema.parse({ title: requestTitle(prompt?.text.text ?? "") || "기록된 업무", purpose: prompt?.text ?? null,
      acceptanceCriteria: [], steps, messages, result, failure, coverage: "local-session-turn", incomplete: incomplete || !ended, observedAt: new Date().toISOString() });
  } finally { await handle.close(); }
}
