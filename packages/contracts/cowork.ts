import { z } from "zod";

const memberId = z.string().regex(/^[a-z0-9_-]{1,32}$/);
/** Versioned producer metadata, bounded independently of runtime configuration. */
export const coworkPlanSchema = z.object({
  version: z.literal(1),
  members: z.array(z.object({ memberId, dependsOn: z.array(memberId).max(64) }).strict()).min(2).max(64),
}).strict().superRefine((plan, context) => {
  const ids = new Set(plan.members.map(member => member.memberId));
  if (ids.size !== plan.members.length || plan.members.some(member => member.dependsOn.some(id => !ids.has(id))))
    context.addIssue({ code: "custom", message: "Unique members and in-plan prerequisites required" });
});
export type CoworkPlan = z.infer<typeof coworkPlanSchema>;
