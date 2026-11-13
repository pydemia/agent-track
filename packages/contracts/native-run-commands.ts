import { z } from "zod";
import { relationUuidSchema } from "./session-relations.ts";
import { timestampSchema } from "./index.ts";

// Server-side native contract. Authority/head pins never become browser receipts.
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const nativeCommandKindSchema = z.enum(["retry", "resume", "continue"]);
export const nativeCommandTerminalSchema = z.enum(["succeeded", "failed", "cancelled", "expired"]);
const sourceStatus = z.enum(["queued", "leasing", "running", "waiting_for_permission", "cancelling",
  "succeeded", "failed", "cancelled", "expired"]);
export const nativeCommandDescriptorSchema = z.object({
  version: z.literal(1), commandId: relationUuidSchema, sourceRunId: relationUuidSchema,
  kind: nativeCommandKindSchema, expectedSessionHead: digest,
  expectedSourceStatus: nativeCommandTerminalSchema, expectedAuthoritySha256: digest,
  expiresAt: timestampSchema,
}).strict();
export type NativeCommandDescriptor = z.infer<typeof nativeCommandDescriptorSchema>;
export const nativeCommandWriteSchema = z.object({
  command: nativeCommandDescriptorSchema,
  input: z.array(z.object({ type: z.literal("input_text"), text: z.string().min(1).max(1_000_000) }).strict()).min(1).max(32).optional(),
}).strict().superRefine((value, context) => {
  if ((value.command.kind === "continue") !== (value.input !== undefined)) {
    context.addIssue({ code: "custom", message: "Only continue requires new input" });
  }
});
export type NativeCommandWrite = z.infer<typeof nativeCommandWriteSchema>;
export const nativeCommandContextSchema = z.object({
  object: z.literal("demian.run_command_context"), version: z.literal(1),
  source_run: z.object({ id: relationUuidSchema, session_id: relationUuidSchema, status: sourceStatus }).strict(),
  session_head_sha256: digest, authority_sha256: digest,
  available_kinds: z.array(nativeCommandKindSchema).max(2), observed_at: timestampSchema,
}).strict().superRefine((value, context) => {
  const status = value.source_run.status;
  const allowed = status === "failed" ? ["retry", "continue"] :
    status === "cancelled" || status === "expired" ? ["resume", "continue"] : status === "succeeded" ? ["continue"] : [];
  if (new Set(value.available_kinds).size !== value.available_kinds.length || value.available_kinds.some(kind => !allowed.includes(kind))) {
    context.addIssue({ code: "custom", message: "Command availability disagrees with source status" });
  }
});
export type NativeCommandContext = z.infer<typeof nativeCommandContextSchema>;
export const nativeCommandReceiptSchema = z.object({
  object: z.literal("demian.run_command_receipt"), version: z.literal(1),
  command_id: relationUuidSchema, session_id: relationUuidSchema, source_run_id: relationUuidSchema,
  kind: nativeCommandKindSchema, outcome: z.enum(["accepted", "rejected"]),
  rejection_code: z.enum(["command_expired", "session_head_changed", "source_status_changed", "active_run", "invalid_source_state"]).nullable(),
  new_run_id: relationUuidSchema.nullable(), task_root_run_id: relationUuidSchema.nullable(),
  relation: z.enum(["retry_of", "continues"]).nullable(), created_at: timestampSchema, expires_at: timestampSchema,
}).strict().superRefine((value, context) => {
  const accepted = value.outcome === "accepted";
  if (accepted ? value.rejection_code !== null || value.new_run_id === null || value.task_root_run_id === null ||
      value.new_run_id === value.source_run_id || value.relation !== (value.kind === "retry" ? "retry_of" : "continues") ||
      (value.kind === "continue" && value.task_root_run_id !== value.new_run_id) :
    value.rejection_code === null || value.new_run_id !== null || value.task_root_run_id !== null || value.relation !== null) {
    context.addIssue({ code: "custom", message: "Command receipt outcome is inconsistent" });
  }
});
export type NativeCommandReceipt = z.infer<typeof nativeCommandReceiptSchema>;
export const nativeCommandStatusSchema = z.object({
  object: z.literal("demian.run_command_status"), version: z.literal(1),
  status: z.enum(["found", "not_found"]), receipt: nativeCommandReceiptSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.status === "found") !== (value.receipt !== null)) context.addIssue({ code: "custom", message: "Command lookup is inconsistent" });
});
export type NativeCommandStatus = z.infer<typeof nativeCommandStatusSchema>;
