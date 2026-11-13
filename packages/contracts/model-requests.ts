import { z } from "zod";
import { idSchema, sequenceSchema, timestampSchema } from "./index.ts";

const markSchema = z.object({
  sequence: sequenceSchema.refine(value => value !== "0"),
  occurredAt: timestampSchema,
}).strict();

/** A source lifecycle observation, never a provider request ID or success verdict. */
export const modelRequestSchema = z.object({
  id: sequenceSchema.refine(value => value !== "0"),
  contextKey: z.string().regex(/^[a-f0-9]{64}$/),
  invocationId: idSchema.nullable(),
  provider: z.string().regex(/^[a-zA-Z0-9_.:-]{1,120}$/),
  model: z.string().regex(/^[a-zA-Z0-9_.:/-]{1,200}$/),
  phase: z.enum(["started", "ended", "end-only", "ambiguous"]),
  started: markSchema.nullable(),
  ended: markSchema.nullable(),
  reportedDurationMs: z.number().nonnegative().finite().optional(),
  sequences: z.array(sequenceSchema.refine(value => value !== "0")).min(1).max(2),
}).strict().superRefine((value, context) => {
  const validMarks = value.phase === "ended" ? value.started !== null && value.ended !== null :
    value.phase === "end-only" ? value.started === null && value.ended !== null : value.started !== null && value.ended === null;
  const anchor = value.started?.sequence ?? value.ended?.sequence;
  const unique = new Set(value.sequences);
  const ordered = value.sequences.every((item, index) => index === 0 || BigInt(item) > BigInt(value.sequences[index - 1]!));
  if (!validMarks || anchor !== value.id || unique.size !== value.sequences.length || !ordered ||
      value.started && !unique.has(value.started.sequence) || value.ended && !unique.has(value.ended.sequence) ||
      value.started && value.ended && BigInt(value.started.sequence) >= BigInt(value.ended.sequence) ||
      ["started", "ambiguous"].includes(value.phase) && value.reportedDurationMs !== undefined) {
    context.addIssue({ code: "custom", message: "Inconsistent model lifecycle evidence" });
  }
});

export type ModelRequestObservation = z.infer<typeof modelRequestSchema>;

/** Optional extensions keep old tool-evidence replies readable without inventing coverage. */
export const modelRequestFields = {
  modelRequestCoverage: z.literal("native-model-lifecycle").optional(),
  modelRequests: z.array(modelRequestSchema).max(500).optional(),
  unidentifiedModelEvents: z.number().int().nonnegative().optional(),
  omittedModelRequests: z.number().int().nonnegative().optional(),
};

export interface ModelRequestEvidence {
  modelRequestCoverage?: "native-model-lifecycle";
  modelRequests?: ModelRequestObservation[];
  unidentifiedModelEvents?: number;
  omittedModelRequests?: number;
}
