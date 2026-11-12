import { flowViewAnchorsSchema, flowViewContentSchema, flowViewIdSchema,
  type FlowViewAnchors, type FlowViewContent } from "../contracts/flow-views.ts";
import type { MissionEdge, MissionNode } from "./mission-flow.ts";
import { nativeFlowGroupDefinitions, withTaskBundles, flowGroupKey } from "./flow-group-definitions.ts";
import { projectFlowGroups } from "./flow-groups.ts";

const identity = (...parts: string[]) => JSON.stringify(parts);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") return JSON.stringify(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return JSON.stringify(value) ?? "undefined";
}

/** Capture explicit observed identities only. Conflicting evidence fails closed. */
export function captureFlowViewAnchors(nodes: MissionNode[]): FlowViewAnchors | null {
  const known = new Map<string, string>();
  const tasks = new Map<string, FlowViewAnchors["tasks"][number]>();
  const runs = new Map<string, FlowViewAnchors["runs"][number]>();
  const assistants = new Map<string, FlowViewAnchors["assistants"][number]>();
  const taskIds = new Map<string, string>(), runKeys = new Map<string, string>();
  for (const node of nodes) {
    const fingerprint = canonical(node);
    if (known.has(node.key) && known.get(node.key) !== fingerprint) return null;
    known.set(node.key, fingerprint);
    if (node.status === "unobserved") continue;
    if (node.kind === "task" && !node.taskRef || node.kind === "run" && !node.runKey ||
        ["assistant-role", "assistant-execution", "assistant-work-package"].includes(node.kind) && !node.assistantExecutionRef) return null;
    if (node.kind === "task" && node.taskRef) {
      const ref = node.taskRef;
      if (ref.sourceId !== node.sourceId || ref.taskId !== node.id) return null;
      const id = identity(ref.sourceId, ref.projectId, ref.taskId), taskId = identity(ref.sourceId, ref.taskId);
      if (taskIds.has(taskId) && taskIds.get(taskId) !== id) return null;
      taskIds.set(taskId, id); tasks.set(id, { ...ref });
    }
    if (node.kind === "run" && node.runKey) {
      const id = identity(node.sourceId, node.id);
      if (runs.has(id) && runs.get(id)!.key !== node.runKey ||
          runKeys.has(node.runKey) && runKeys.get(node.runKey) !== id) return null;
      runKeys.set(node.runKey, id);
      runs.set(id, { sourceId: node.sourceId, runId: node.id, key: node.runKey });
    }
    if (["assistant-role", "assistant-execution", "assistant-work-package"].includes(node.kind) && node.assistantExecutionRef) {
      const ref = node.assistantExecutionRef;
      if (ref.sourceId !== node.sourceId || node.kind === "assistant-execution" && node.id !== ref.executionId) return null;
      assistants.set(identity(ref.sourceId, ref.executionId), { ...ref });
    }
  }
  const sorted = <T>(values: Map<string, T>): T[] => [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, ref]) => ref);
  const parsed = flowViewAnchorsSchema.safeParse({ tasks: sorted(tasks), runs: sorted(runs), assistants: sorted(assistants) });
  return parsed.success ? parsed.data : null;
}

/** Reconcile presentation state only; no labels, bindings or authority are inferred. */
export function reconcileSavedFlowView(content: FlowViewContent,
  model: { nodes: MissionNode[]; edges: MissionEdge[] }): FlowViewContent["state"] | null {
  const parsed = flowViewContentSchema.safeParse(content);
  if (!parsed.success) return null;
  const current = captureFlowViewAnchors(model.nodes);
  if (!current) return null;
  const { anchors, state } = parsed.data;
  for (const kind of ["tasks", "runs", "assistants"] as const) {
    const available = new Set(current[kind].map(canonical));
    if (anchors[kind].some(ref => !available.has(canonical(ref)))) return null;
  }
  const native = nativeFlowGroupDefinitions(model, state.by);
  const occupied = new Set([...model.nodes.map(node => node.key), ...native.map(group => group.key)]);
  const savedTasks = new Set(anchors.tasks.map(canonical));
  const tasks = new Set(model.nodes.filter(node => node.kind === "task" && node.status !== "unobserved" &&
    node.taskRef && savedTasks.has(canonical(node.taskRef))).map(node => node.key));
  for (const bundle of state.bundles) {
    let tuple: unknown;
    try { tuple = JSON.parse(bundle.key); } catch { return null; }
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== "flow-container" || tuple[1] !== "view-task-bundle" ||
        !flowViewIdSchema.safeParse(tuple[2]).success || bundle.key !== flowGroupKey("view-task-bundle", tuple[2]) ||
        occupied.has(bundle.key) || bundle.taskKeys.some(key => !tasks.has(key))) return null;
  }
  const definitions = withTaskBundles(model, native, state.by === "none" ? [] : state.bundles);
  const valid = new Set(projectFlowGroups(model, definitions, new Set()).groups.map(group => group.key));
  if (state.by !== "none" && state.bundles.some(bundle => !valid.has(bundle.key))) return null;
  return { ...state, overrides: state.overrides.filter(([key]) => valid.has(key)),
    focus: state.focus !== null && valid.has(state.focus) ? state.focus : null };
}
