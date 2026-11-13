import { z } from "zod";
import { timestampSchema } from "./index.ts";
import { nativeCommandKindSchema } from "./native-run-commands.ts";

/** Positive, metadata-only Native admission evidence under the current Run scope. */
export const nativeCommandObservationSchema = z.object({
  commandId: z.uuid(), kind: nativeCommandKindSchema, sourceRunId: z.uuid(), targetRunId: z.uuid(), sessionId: z.uuid(),
  rootRunId: z.uuid().nullable(), relation: z.enum(["retry_of", "continues"]), acceptedAt: timestampSchema,
  provenance: z.literal("native-command-receipt"),
}).strict().refine(value => value.sourceRunId !== value.targetRunId && value.relation === (value.kind === "retry" ? "retry_of" : "continues") &&
  (value.kind !== "continue" || value.rootRunId === value.targetRunId), "Native admission relationship is inconsistent");
export type NativeCommandObservation = z.infer<typeof nativeCommandObservationSchema>;
export const nativeCommandLinkSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("observed"), receipt: nativeCommandObservationSchema }).strict(),
  z.object({ state: z.literal("unavailable"), reason: z.enum(["predecessor-unavailable", "source-unavailable", "ambiguous-receipt"]) }).strict(),
]);
export type NativeCommandLink = z.infer<typeof nativeCommandLinkSchema>;
