import { z } from "zod";
import { idSchema, sequenceSchema, timestampSchema, type RunView } from "../../../packages/contracts/index.ts";
import { modelRequestFields, type ModelRequestEvidence } from "../../../packages/contracts/model-requests.ts";
import type { ToolEvidencePage } from "../../../packages/adapters/demian/tool-evidence.ts";

const mark = z.object({
  type: z.enum(["tool.requested", "tool.started", "tool.completed", "tool.failed"]),
  sequence: sequenceSchema,
  occurredAt: timestampSchema,
  ok: z.boolean().optional(),
}).strict();

const toolCall = z.object({
  invocationId: idSchema.nullable(), callId: idSchema, tool: z.string().max(120).nullable(),
  requested: z.array(mark).max(2000), started: z.array(mark).max(2000), ended: z.array(mark).max(2000),
  outcome: z.enum(["succeeded", "failed", "unknown", "ambiguous"]),
}).strict();

const replySchema = z.object({
  state: z.enum(["connected", "disconnected", "forbidden", "unsupported"]), runKey: idSchema,
  observedAt: timestampSchema, detail: z.string().max(2000), calls: z.array(toolCall).max(500),
  scanned: z.number().int().min(0).max(2000), limit: z.literal(2000),
  targetSequence: sequenceSchema, throughSequence: sequenceSchema, targetReached: z.boolean(), gaps: z.boolean(),
  truncated: z.boolean(), omittedCalls: z.number().int().nonnegative(), unidentifiedEvents: z.number().int().nonnegative(),
  complete: z.boolean(), ...modelRequestFields,
}).strict().superRefine((value, context) => {
  const models = value.modelRequests ?? [];
  if (new Set(models.map(model => model.id)).size !== models.length ||
      BigInt(value.throughSequence) > BigInt(value.targetSequence) ||
      value.complete && ((value.unidentifiedModelEvents ?? 0) > 0 || (value.omittedModelRequests ?? 0) > 0) ||
      models.some(model => model.sequences.some(sequence => BigInt(sequence) > BigInt(value.throughSequence)))) {
    context.addIssue({ code: "custom", message: "Model evidence exceeds or conflicts with its source window" });
  }
});

export type ToolEvidenceReply = ToolEvidencePage & ModelRequestEvidence & {
  state: "connected" | "disconnected" | "forbidden" | "unsupported";
  runKey: string; observedAt: string; detail: string;
};

/** Validates untrusted BFF JSON and binds the evidence to the selected Run. */
export function parseToolEvidenceReply(value: unknown, run: RunView): ToolEvidenceReply {
  const reply = replySchema.parse(value);
  if (reply.runKey !== run.key) throw new Error("Tool evidence Run mismatch");
  const { modelRequestCoverage, modelRequests, unidentifiedModelEvents, omittedModelRequests, ...base } = reply;
  const calls = base.calls.map(({ requested, started, ended, ...call }) => ({
    ...call, requested: requested.map(cleanMark), started: started.map(cleanMark), ended: ended.map(cleanMark),
  }));
  return {
    ...base, calls,
    ...(modelRequestCoverage === undefined ? {} : { modelRequestCoverage }),
    ...(modelRequests === undefined ? {} : { modelRequests }),
    ...(unidentifiedModelEvents === undefined ? {} : { unidentifiedModelEvents }),
    ...(omittedModelRequests === undefined ? {} : { omittedModelRequests }),
  };
}

function cleanMark({ ok, ...value }: z.infer<typeof mark>) {
  return { ...value, ...(ok === undefined ? {} : { ok }) };
}
