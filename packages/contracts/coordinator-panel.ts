import { z } from "zod";
import { idSchema } from "./index.ts";
import { assistantCommandKindSchema } from "./assistant-commands.ts";
import { coordinatorReceiptPageSchema } from "./coordinator-commands.ts";

export const coordinatorAvailabilitySchema = z.strictObject({
  runKey: idSchema, state: z.enum(["available", "unsupported", "unavailable"]),
  availableKinds: z.array(assistantCommandKindSchema).max(2),
  detail: z.enum(["ready", "not_enabled", "attempt_history_unavailable", "not_current_attempt", "no_terminal_action", "coordinator_unavailable"]),
}).refine(value => new Set(value.availableKinds).size === value.availableKinds.length &&
  (value.state === "available" || value.availableKinds.length === 0) &&
  (value.detail !== "ready" || value.state === "available" && value.availableKinds.length > 0));
export type CoordinatorAvailability = z.infer<typeof coordinatorAvailabilitySchema>;
export const coordinatorPanelSchema = coordinatorReceiptPageSchema.safeExtend({ availability: coordinatorAvailabilitySchema });
export type CoordinatorPanel = z.infer<typeof coordinatorPanelSchema>;
