import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { SourceConfig } from "./config.ts";
import { sourceIdentity } from "./source-identity.ts";

export type ReadOperation = "assistant.capabilities" | "assistant.list" | "assistant.detail" | "assistant.events" |
  "assistant.native-window" | "assistant.native-evidence" | "projects.refresh" | "native.collect" | "native.refresh";
export type ReadStage = "queue" | "native.admission" | "native.window" | "native.persist" | "authority.projects" |
  "authority.links" | "rpc.capabilities" | "rpc.projects" | "rpc.task" | "rpc.executions" | "rpc.execution" |
  "rpc.events" | "rpc.nativeMetadata" | "rpc.nativeEvidence" | "rpc.roleAttempts";
const stages = new Set<ReadStage>(["queue", "native.admission", "native.window", "native.persist", "authority.projects",
  "authority.links", "rpc.capabilities", "rpc.projects", "rpc.task", "rpc.executions", "rpc.execution", "rpc.events",
  "rpc.nativeMetadata", "rpc.nativeEvidence", "rpc.roleAttempts"]);
const rpcMethods = new Set(["capabilities", "projects", "task", "executions", "execution", "events", "nativeMetadata", "nativeEvidence", "roleAttempts"]);
const elapsed = (start: number) => Math.max(0, Math.round((performance.now() - start) * 100) / 100);

export function readFailureStatus(error: unknown): number {
  if (!error || typeof error !== "object") return 503;
  const value: unknown = Object.getOwnPropertyDescriptor(error, "status")?.value;
  return typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599 ? value : 503;
}

type ReadOrigin = "snapshot" | "events" | "evidence" | "stream" | "assistant" | "projects" | "context" | "other" | "background";
const origins = new AsyncLocalStorage<ReadOrigin>();
export function withReadOrigin<T>(url: string | undefined, read: () => T): T {
  let origin: ReadOrigin = "other";
  try {
    const path = new URL(url ?? "/", "http://localhost").pathname;
    origin = path === "/api/snapshot" ? "snapshot" : path === "/api/stream" ? "stream" :
      /^\/api\/runs\/[^/]+\/events$/.test(path) ? "events" : /^\/api\/runs\/[^/]+\/evidence$/.test(path) ? "evidence" :
      path.startsWith("/api/assistant/") ? "assistant" : path.startsWith("/api/projects/") ? "projects" :
      path.startsWith("/api/integrations/context/") ? "context" : "other";
  } catch { /* The real handler retains malformed-URL handling. */ }
  return origins.run(origin, read);
}

interface StageObservation { name: ReadStage; offsetMs: number; durationMs: number | null; status: number | null }
interface ReadObservation {
  id: string; parentId: string | null; origin: ReadOrigin; relatedId: string | null; queueDepth: number | null; remainingBudgetAtAdmissionMs: number | null; observations: number | null; sourceId: string; operation: ReadOperation; startedAt: string;
  durationMs: number | null; status: number | null; deadlineReached: boolean; grantState: string | null;
  steps: StageObservation[]; omittedSteps: number;
}

/** Timings only: no arguments, URLs, credentials, DTOs, error messages or stacks. */
export class ReadTrace {
  private start = performance.now();
  private sealed = false;
  readonly observation: ReadObservation;
  constructor(sourceId: string, operation: ReadOperation, parentId?: string) {
    this.observation = { id: randomUUID(), parentId: parentId ?? null, origin: origins.getStore() ?? "background", relatedId: null, queueDepth: null, remainingBudgetAtAdmissionMs: null, observations: null, sourceId, operation, startedAt: new Date().toISOString(),
      durationMs: null, status: null, deadlineReached: false, grantState: null, steps: [], omittedSteps: 0 };
  }
  get id(): string { return this.observation.id; }
  admission(queueDepth: number, remainingMs: number): void {
    if (!this.sealed) { this.observation.queueDepth = Math.max(0, Math.min(2, queueDepth)); this.observation.remainingBudgetAtAdmissionMs = Math.round(remainingMs); }
  }
  related(id: string | undefined): void { if (!this.sealed && id && /^[0-9a-f-]{36}$/.test(id)) this.observation.relatedId = id; }
  observations(count: number): void { if (!this.sealed) this.observation.observations = Math.min(64, Math.max(0, count)); }
  step(name: ReadStage): (status?: number) => void {
    if (this.sealed || !stages.has(name)) return () => {};
    if (this.observation.steps.length >= 64) { this.observation.omittedSteps++; return () => {}; }
    const start = performance.now(), step: StageObservation = { name, offsetMs: elapsed(this.start), durationMs: null, status: null };
    this.observation.steps.push(step);
    return (status = 200) => { if (!this.sealed && step.durationMs === null) { step.durationMs = elapsed(start); step.status = status; } };
  }
  async measure<T>(name: ReadStage, read: () => Promise<T>): Promise<T> {
    const end = this.step(name);
    try { const result = await read(); end(); return result; }
    catch (error) { end(readFailureStatus(error)); throw error; }
  }
  client<T extends object>(client: T): T {
    return new Proxy(client, { get: (target, key) => {
      const member: unknown = Reflect.get(target, key, target);
      if (typeof member !== "function") return member;
      if (typeof key !== "string" || !rpcMethods.has(key)) return member.bind(target);
      return (...args: unknown[]) => this.measure(`rpc.${key}` as ReadStage, () => Reflect.apply(member, target, args));
    } });
  }
  finish(status: number, deadlineReached = false, grantState?: string): void {
    if (this.sealed) return;
    this.observation.durationMs = elapsed(this.start); this.observation.status = status;
    this.observation.deadlineReached = deadlineReached;
    this.observation.grantState = ["connected", "disconnected", "forbidden", "unsupported"].includes(grantState ?? "") ? grantState! : null;
    this.sealed = true;
  }
}

/** One bounded process-local ring. Access is filtered by current actor, source and identity. */
export class ReadDiagnostics {
  private records: Array<{ actor: string; identity: string; trace: ReadTrace }> = [];
  begin(source: SourceConfig, actor: string, operation: ReadOperation, parentId?: string): ReadTrace {
    const trace = new ReadTrace(source.id, operation, parentId);
    this.records.push({ actor, identity: sourceIdentity(source), trace });
    if (this.records.length > 128) this.records.shift();
    return trace;
  }
  snapshot(actor: string, sources: SourceConfig[]): ReadObservation[] {
    const allowed = new Map(sources.filter(source => source.users.includes(actor)).map(source => [source.id, sourceIdentity(source)]));
    return this.records.filter(record => record.actor === actor && allowed.get(record.trace.observation.sourceId) === record.identity)
      .map(record => structuredClone(record.trace.observation));
  }
}
