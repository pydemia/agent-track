import type { RunView, SourceView } from "../contracts/index.ts";
import type { AssistantExecutionView } from "../contracts/assistant-view.ts";
import type { FlowGroupSummary } from "./flow-groups.ts";
import type { MissionEdge, MissionNode } from "./mission-flow.ts";
import { assistantEntityKey, assistantRoleKey, authorizedAssistantLinks } from "./assistant-flow.ts";

export type GroupTaskRef = { sourceId: string; projectId: string; taskId: string };
export interface GroupWorkspaceScope {
  actor: string;
  key: string;
  label: string;
  kind: string;
  basis: "native" | "binding" | "view";
  nodeKeys: string[];
  taskRefs: GroupTaskRef[];
  runRefs: Array<{ sourceId: string; runId: string; key: string; taskRef?: GroupTaskRef; assistantLinks?: NonNullable<MissionEdge["assistantRunRef"]>[] }>;
  assistantRefs: Array<{ sourceId: string; executionId: string }>;
}

const identity = (...parts: string[]) => JSON.stringify(parts);
const taskKey = (ref: GroupTaskRef) => identity(ref.sourceId, ref.projectId, ref.taskId);
const nonempty = (value: string) => typeof value === "string" && value.length > 0;
const validTask = (ref: GroupTaskRef) => ref && [ref.sourceId, ref.projectId, ref.taskId].every(nonempty);
const copyTask = (ref: GroupTaskRef): GroupTaskRef => ({ sourceId: ref.sourceId, projectId: ref.projectId, taskId: ref.taskId });
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") return JSON.stringify(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return JSON.stringify(value) ?? "undefined";
}
function unique<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>(), conflicts = new Set<string>();
  for (const item of items) {
    const id = key(item), previous = result.get(id);
    if (previous && canonical(previous) !== canonical(item)) conflicts.add(id);
    result.set(id, item);
  }
  for (const id of conflicts) result.delete(id);
  return result;
}
const actualRun = (node: MissionNode) => node.kind === "run" && node.status !== "unobserved" && nonempty(node.runKey ?? "");

/** Snapshot only explicit leaf anchors; labels, order and graph reachability confer no ownership. */
export function createGroupWorkspaceScope(actor: string, group: FlowGroupSummary,
  nodes: MissionNode[], edges: MissionEdge[]): GroupWorkspaceScope | null {
  if (!nonempty(actor) || !group.leafKeys.length || group.leafKeys.length > 2000 ||
      new Set(group.leafKeys).size !== group.leafKeys.length || !group.leafKeys.every(nonempty)) return null;
  const known = unique(nodes, node => node.key);
  if (known.size !== new Set(nodes.map(node => node.key)).size) return null;
  const tasks = new Map<string, GroupTaskRef>();
  const runs = new Map<string, GroupWorkspaceScope["runRefs"][number]>();
  const assistants = new Map<string, GroupWorkspaceScope["assistantRefs"][number]>();
  const observed = nodes.filter(actualRun);
  for (const key of group.leafKeys) {
    const node = known.get(key);
    if (!node || !nonempty(node.sourceId) || !nonempty(node.id)) return null;
    // Unobserved parent/peer references are Trace context, never actual units.
    if (node.status === "unobserved") continue;
    if (node.kind === "task") {
      const ref = node.taskRef;
      if (!ref || !validTask(ref) || ref.sourceId !== node.sourceId || ref.taskId !== node.id) return null;
      tasks.set(taskKey(ref), copyTask(ref));
    }
    if (node.assistantExecutionRef) {
      const ref = node.assistantExecutionRef;
      if (ref.sourceId !== node.sourceId || !nonempty(ref.executionId) ||
          (node.kind === "assistant-execution" && node.id !== ref.executionId)) return null;
      assistants.set(identity(ref.sourceId, ref.executionId), { sourceId: ref.sourceId, executionId: ref.executionId });
    } else if (["assistant-execution", "assistant-role", "assistant-work-package"].includes(node.kind)) return null;
    if (node.runKey) {
      const candidates = observed.filter(run => run.runKey === node.runKey);
      if (!candidates.length || candidates.some(run => !known.has(run.key) || run.sourceId !== node.sourceId ||
          run.id !== candidates[0]!.id) || (node.kind === "run" && node.id !== candidates[0]!.id)) return null;
      const run = candidates[0]!;
      // Aliases of one native identity must agree on the external Run key.
      if (observed.some(other => other.sourceId === run.sourceId && other.id === run.id && other.runKey !== run.runKey)) return null;
      const id = identity(run.sourceId, run.id);
      const ref: GroupWorkspaceScope["runRefs"][number] = runs.get(id) ?? { sourceId: run.sourceId, runId: run.id, key: run.runKey! };
      for (const edge of edges.filter(edge => edge.kind === "task-binding" && candidates.some(item => item.key === edge.to))) {
        const task = known.get(edge.from);
        if (!task || task.kind !== "task" || !task.taskRef || !validTask(task.taskRef) ||
            task.taskRef.sourceId !== task.sourceId || task.taskRef.taskId !== task.id) return null;
        if (ref.taskRef && taskKey(ref.taskRef) !== taskKey(task.taskRef)) return null;
        ref.taskRef = copyTask(task.taskRef);
      }
      runs.set(id, ref);
    } else if (node.kind === "run") return null;
  }
  // Related native Runs stay outside exclusive visual ownership. Only an
  // explicit selected role -> actual Run reference can add execution context.
  const leaves = new Set(group.leafKeys);
  for (const edge of edges.filter(edge => edge.kind === "assistant-demian-runtime" && leaves.has(edge.from))) {
    const link = edge.assistantRunRef, role = known.get(edge.from), target = known.get(edge.to);
    if (!link || role?.kind !== "assistant-role" || role.id !== link.roleId || !role.assistantExecutionRef || role.assistantExecutionRef.sourceId !== link.sourceId ||
        role.assistantExecutionRef.executionId !== link.executionId || !target || !actualRun(target) ||
        !assistants.has(identity(link.sourceId, link.executionId))) return null;
    const id = identity(target.sourceId, target.id);
    const ref = runs.get(id) ?? { sourceId: target.sourceId, runId: target.id, key: target.runKey! };
    if (ref.key !== target.runKey) return null;
    const links = ref.assistantLinks ??= [];
    if (!links.some(item => canonical(item) === canonical(link))) links.push({ ...link });
    runs.set(id, ref);
  }
  if (!tasks.size && !runs.size && !assistants.size || Math.max(tasks.size, runs.size, assistants.size) > 256) return null;
  return { actor, key: group.key, label: group.label, kind: group.kind, basis: group.basis,
    nodeKeys: [...group.leafKeys], taskRefs: [...tasks.values()], runRefs: [...runs.values()], assistantRefs: [...assistants.values()] };
}

/** Resolve atomically against current grants and observations; never fall back to the dashboard. */
export function resolveGroupWorkspaceScope(scope: GroupWorkspaceScope, actor: string, runs: RunView[],
  sources: SourceView[], executions: AssistantExecutionView[]): { runs: RunView[]; executions: AssistantExecutionView[] } | null {
  if (!scope || !nonempty(actor) || scope.actor !== actor || !scope.nodeKeys.length || scope.nodeKeys.length > 2000 ||
      !scope.nodeKeys.every(nonempty) || new Set(scope.nodeKeys).size !== scope.nodeKeys.length ||
      Math.max(scope.taskRefs.length, scope.runRefs.length, scope.assistantRefs.length) > 256 ||
      !scope.taskRefs.length && !scope.runRefs.length && !scope.assistantRefs.length) return null;
  const sourceById = unique(sources, source => source.id);
  const granted = (ref: GroupTaskRef) => validTask(ref) && sourceById.get(ref.sourceId)?.kind === "projects" &&
    sourceById.get(ref.sourceId)?.state === "connected" && sourceById.get(ref.sourceId)?.authorizedProjectIds?.includes(ref.projectId) === true;
  if (!scope.taskRefs.every(granted)) return null;
  const runByKey = unique(runs, run => run.key);
  const runById = unique(runs, run => identity(run.sourceId, run.runId));
  const selectedRuns = new Map<string, RunView>();
  for (const ref of scope.runRefs) {
    const run = runByKey.get(ref.key);
    if (![ref.sourceId, ref.runId, ref.key].every(nonempty) || !run || run.sourceId !== ref.sourceId || run.runId !== ref.runId ||
        !runById.has(identity(ref.sourceId, ref.runId)) || run.sourceState === "forbidden" ||
        !sourceById.has(ref.sourceId) || sourceById.get(ref.sourceId)?.state === "forbidden") return null;
    if (ref.taskRef) {
      const binding = run.binding;
      if (!granted(ref.taskRef) || !binding || binding.sourceId !== run.sourceId || binding.runId !== run.runId ||
          binding.projectSourceId !== ref.taskRef.sourceId || binding.projectId !== ref.taskRef.projectId ||
          binding.taskId !== ref.taskRef.taskId) return null;
    }
    for (const link of ref.assistantLinks ?? []) {
      if (!scope.assistantRefs.some(item => item.sourceId === link.sourceId && item.executionId === link.executionId)) return null;
      const views = executions.filter(item => item.sourceId === link.sourceId && item.native.id === link.executionId);
      if (views.length !== 1 || !authorizedAssistantLinks(views[0]!, sources, runs).some(current => current.roleId === link.roleId &&
          current.operationId === link.operationId && current.sourceId === ref.sourceId && current.runId === ref.runId && current.runKey === ref.key)) return null;
    }
    selectedRuns.set(ref.key, run);
  }
  const executionById = unique(executions, view => identity(view.sourceId, view.native.id));
  const selectedExecutions = new Map<string, AssistantExecutionView>();
  for (const ref of scope.assistantRefs) {
    const id = identity(ref.sourceId, ref.executionId), view = executionById.get(id);
    const source = sourceById.get(ref.sourceId);
    if (![ref.sourceId, ref.executionId].every(nonempty) || !view || source?.kind !== "assistant" || source.state !== "connected" ||
        new Set(view.native.roles.map(role => role.id)).size !== view.native.roles.length) return null;
    const task = view.native.task, current = view.currentTask;
    if (!task) { if (current !== null) return null; }
    else if (!current || task.projectId !== current.project.id || task.projectId !== current.task.projectId ||
        task.taskId !== current.task.id || !granted({ sourceId: current.projectsSourceId,
          projectId: current.project.id, taskId: current.task.id })) return null;
    selectedExecutions.set(id, view);
  }
  // Assistant keys encode native membership. Recheck selected roles/runtime
  // references without retaining their payloads or interpreting human labels.
  const assistantKeys = new Set<string>();
  for (const view of selectedExecutions.values()) {
    assistantKeys.add(assistantEntityKey(view.sourceId, "assistant-execution", view.native.id));
    for (const role of view.native.roles) {
      assistantKeys.add(assistantRoleKey(view.sourceId, view.native.id, role.id));
      for (const [kind, id] of [["assistant-runtime-task", role.runtime.taskId],
        ["assistant-thread", role.runtime.threadId], ["assistant-turn", role.runtime.turnId]] as const) {
        if (id) assistantKeys.add(assistantEntityKey(view.sourceId, kind, id));
      }
    }
  }
  for (const key of scope.nodeKeys) {
    let parts: unknown;
    try { parts = JSON.parse(key); } catch { continue; }
    if (Array.isArray(parts) && parts.length === 3 && ["assistant-execution", "assistant-role",
      "assistant-runtime-task", "assistant-thread", "assistant-turn"].includes(parts[1]) && !assistantKeys.has(key)) return null;
  }
  return { runs: [...selectedRuns.values()], executions: [...selectedExecutions.values()] };
}
