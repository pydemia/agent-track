import { z } from "zod";

const source = z.string().regex(/^[a-z0-9_-]{1,80}$/);
const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
const key = z.string().min(1).max(1024).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
const title = z.string().trim().min(1).max(80).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const flowViewAnchorsSchema = z.object({
  tasks: z.array(z.object({ sourceId: source, projectId: uuid, taskId: uuid }).strict()).max(32),
  runs: z.array(z.object({ sourceId: source, runId: key, key }).strict()).max(32),
  assistants: z.array(z.object({ sourceId: source, executionId: uuid }).strict()).max(32),
}).strict().refine(value => {
  const refs = [...value.tasks.map(ref => JSON.stringify(["task", ref.sourceId, ref.projectId, ref.taskId])),
    ...value.runs.map(ref => JSON.stringify(["run", ref.sourceId, ref.runId])),
    ...value.assistants.map(ref => JSON.stringify(["assistant", ref.sourceId, ref.executionId]))];
  return refs.length > 0 && refs.length <= 32 && new Set(refs).size === refs.length;
});
export const flowViewContentSchema = z.object({
  version: z.literal(1), contextId: z.string().regex(/^[a-f0-9]{64}$/), name: title,
  anchors: flowViewAnchorsSchema,
  state: z.object({
    by: z.enum(["project", "task", "session", "run", "none"]),
    depth: z.enum(["overview", "structure", "detail"]),
    bundles: z.array(z.object({ key, label: title, taskKeys: z.array(key).min(2).max(32) }).strict()).max(16),
    overrides: z.array(z.tuple([key, z.boolean()])).max(128), focus: key.nullable(),
  }).strict(),
}).strict().refine(value => {
  const tasks = value.state.bundles.flatMap(bundle => bundle.taskKeys);
  return new Set(tasks).size === tasks.length &&
    new Set(value.state.bundles.map(bundle => bundle.key)).size === value.state.bundles.length &&
    new Set(value.state.overrides.map(([id]) => id)).size === value.state.overrides.length &&
    new TextEncoder().encode(JSON.stringify(value)).length <= 12_288;
});
export const flowViewIdSchema = uuid;
export const flowViewRevisionSchema = z.number().int().min(0).max(2_147_483_646);
export const saveFlowViewSchema = z.object({ id: uuid, expectedRevision: flowViewRevisionSchema, content: flowViewContentSchema }).strict();
export const deleteFlowViewSchema = z.object({ expectedRevision: flowViewRevisionSchema.min(1) }).strict();
export const savedFlowViewSchema = z.object({ id: uuid, revision: flowViewRevisionSchema.min(1), content: flowViewContentSchema,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() }).strict();
export type FlowViewAnchors = z.infer<typeof flowViewAnchorsSchema>;
export type FlowViewContent = z.infer<typeof flowViewContentSchema>;
export type SavedFlowView = z.infer<typeof savedFlowViewSchema>;
