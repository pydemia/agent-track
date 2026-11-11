import { z } from "zod";
import { sequenceSchema, statusSchema, timestampSchema } from "../contracts/index.ts";

const sourceId = z.string().regex(/^[a-z0-9_-]{1,80}$/);
export const contextTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), sourceId, projectId: z.uuid() }).strict(),
  z.object({ kind: z.literal("task"), sourceId, projectId: z.uuid(), taskId: z.uuid() }).strict(),
  z.object({ kind: z.literal("session"), sourceId, sessionId: z.uuid() }).strict(),
  z.object({ kind: z.literal("run"), sourceId, runId: z.uuid() }).strict(),
]);
export type ContextTarget = z.infer<typeof contextTargetSchema>;
const link = z.url().refine((value) => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash && url.pathname === "/" &&
    value.length <= 2048 && [...url.searchParams.keys()].every((key) => ["view", "run", "project", "source"].includes(key));
});
const binding = z.object({ projectSourceId: sourceId, projectId: z.uuid(), taskId: z.uuid().nullable(), revision: sequenceSchema.nullable() }).strict();
export const contextRunSchema = z.object({
  sourceId, runId: z.uuid(), sessionId: z.uuid(), status: statusSchema, binding: binding.nullable(),
  observedAt: timestampSchema, cursor: sequenceSchema, highWater: sequenceSchema, stale: z.boolean(), incomplete: z.boolean(), url: link,
}).strict();
export const contextSummarySchema = z.object({
  version: z.literal(1), context: contextTargetSchema, observedAt: timestampSchema,
  task: z.object({ id: z.uuid(), revision: sequenceSchema, state: z.string().min(1).max(100), requiresTest: z.boolean() }).strict().nullable(),
  runs: z.array(contextRunSchema).max(50),
  counts: z.object({ runs: z.number().int().min(0).max(50), sessions: z.number().int().min(0).max(50), byStatus: z.record(statusSchema, z.number().int().min(0).max(50)) }).strict(),
  coverage: z.object({ kind: z.literal("observed-window"), limit: z.literal(50), capped: z.boolean(), unavailable: z.boolean() }).strict(),
  trackUrl: link.nullable(),
}).strict().superRefine((value, context) => {
  const keys = value.runs.map((run) => JSON.stringify([run.sourceId, run.runId]));
  const sessions = new Set(value.runs.map((run) => JSON.stringify([run.sourceId, run.sessionId])));
  if (new Set(keys).size !== keys.length || value.counts.runs !== keys.length || value.counts.sessions !== sessions.size ||
    Object.values(value.counts.byStatus).reduce((sum, count) => sum + count, 0) !== keys.length ||
    value.runs.some((run) => value.counts.byStatus[run.status] !== value.runs.filter((row) => row.status === run.status).length)) {
    context.addIssue({ code: "custom", message: "Summary counts must describe the unique returned Run window" });
  }
  for (const run of value.runs) {
    const target = value.context;
    const match = target.kind === "run" ? run.sourceId === target.sourceId && run.runId === target.runId
      : target.kind === "session" ? run.sourceId === target.sourceId && run.sessionId === target.sessionId
      : run.binding?.projectSourceId === target.sourceId && run.binding.projectId === target.projectId && (target.kind === "project" || run.binding.taskId === target.taskId);
    if (!match) context.addIssue({ code: "custom", message: "Run is outside the requested context" });
  }
  if ((value.context.kind === "task" && value.task?.id !== value.context.taskId) || (value.context.kind !== "task" && value.task !== null)) {
    context.addIssue({ code: "custom", message: "Original Task metadata must match the requested context" });
  }
});
export type ContextSummary = z.infer<typeof contextSummarySchema>;
export type ContextResult = { state: "connected"; summary: ContextSummary } | { state: "forbidden" | "unavailable"; summary: null };

export function contextPath(target: ContextTarget): string {
  const value = contextTargetSchema.parse(target); const source = encodeURIComponent(value.sourceId);
  return "/api/integrations/context/v1/" + (value.kind === "run" ? `runs/${source}/${value.runId}`
    : value.kind === "session" ? `sessions/${source}/${value.sessionId}`
    : `projects/${source}/${value.projectId}${value.kind === "task" ? `/tasks/${value.taskId}` : ""}`);
}
