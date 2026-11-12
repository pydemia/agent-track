import type { ProjectTaskMetadata, RunView, RelationView, SourceView } from "../contracts/index.ts";
import type { ProjectDependencyPage } from "../contracts/project-dependencies.ts";
import type { AssistantExecutionView } from "../contracts/assistant-view.ts";
import type { GroupTaskRef } from "./group-workspace-scope.ts";
import { assistantEntityKey, assistantFlow, assistantRoleKey } from "./assistant-flow.ts";
import { missionEntityKey, missionFlow, type MissionNode, type MissionEdge } from "./mission-flow.ts";
import { dependencyEntityKey, projectDependenciesFlow } from "./project-dependencies-flow.ts";

export interface GroupTaskRecord { ref: GroupTaskRef; task: ProjectTaskMetadata }
export const groupTaskKey = (ref: GroupTaskRef) => JSON.stringify([ref.sourceId, ref.projectId, ref.taskId]);
export const isDetailedGroup = (kind: string) => !["project", "task", "task-bundle", "session", "run", "assistant-execution"].includes(kind);

/** Match native roles by their explicit source-qualified role/runtime references. */
export function groupAssistantRoles(view: AssistantExecutionView, nodeKeys?: readonly string[]) {
  if (!nodeKeys) return view.native.roles;
  const keys = new Set(nodeKeys);
  return view.native.roles.filter(role => keys.has(assistantRoleKey(view.sourceId, view.native.id, role.id)) ||
    ([["assistant-runtime-task", role.runtime.taskId], ["assistant-thread", role.runtime.threadId],
      ["assistant-turn", role.runtime.turnId]] as const).some(([kind, id]) => id !== null &&
        keys.has(assistantEntityKey(view.sourceId, kind, id))));
}

/** Preserve the selected subgroup; absent observations never fall back to all nodes. */
export function groupModelSubset<T extends { nodes: MissionNode[]; edges: MissionEdge[] }>(model: T, nodeKeys: readonly string[]): T {
  const keys = new Set(nodeKeys);
  const nodes = model.nodes.filter(node => keys.has(node.key));
  const visible = new Set(nodes.map(node => node.key));
  return { ...model, nodes, edges: model.edges.filter(edge => visible.has(edge.from) && visible.has(edge.to)) };
}

/** Keep authorized role -> Run boundary context without absorbing other roles. */
export function groupAssistantFlowSubset<T extends { nodes: MissionNode[]; edges: MissionEdge[] }>(model: T, nodeKeys: readonly string[]): T {
  const keys = new Set(nodeKeys), nodes = new Map(model.nodes.map(node => [node.key, node]));
  for (const edge of model.edges) {
    if (edge.kind !== "assistant-demian-runtime" || !keys.has(edge.from) || !edge.assistantRunRef) continue;
    const role = nodes.get(edge.from), run = nodes.get(edge.to), link = edge.assistantRunRef;
    if (role?.kind === "assistant-role" && role.id === link.roleId &&
        role.assistantExecutionRef?.sourceId === link.sourceId && role.assistantExecutionRef.executionId === link.executionId &&
        run?.kind === "run" && run.runKey && run.status !== "unobserved") keys.add(run.key);
  }
  return groupModelSubset(model, [...keys]);
}

/** A current metadata map. Task dependencies and Run relationships remain distinct. */
export function groupWorkspaceFlow(tasks: GroupTaskRecord[], runs: RunView[], relations: RelationView[],
  executions: AssistantExecutionView[], sources: SourceView[], pages: ProjectDependencyPage[]) {
  const nodes = new Map<string, MissionNode>(), edges = new Map<string, MissionEdge>();
  const taskKeys = new Set(tasks.map(record => groupTaskKey(record.ref)));
  let incomplete = true; // Metadata map, not the complete execution/event history.
  const boundary = new Map<string, { edge: MissionEdge; from: MissionNode; to: MissionNode }>();
  const canonical = (node: MissionNode) => node.kind === "task" && node.taskRef
    ? dependencyEntityKey(node.taskRef.sourceId, "task", node.taskRef.taskId)
    : ["run", "session", "workspace"].includes(node.kind) ? missionEntityKey(node.sourceId, node.kind, node.id) : node.key;
  const merge = (model: { nodes: MissionNode[]; edges: MissionEdge[] }) => {
    const mapping = new Map<string, string>();
    for (const node of model.nodes) {
      if (node.kind === "task" && (!node.taskRef || !taskKeys.has(groupTaskKey(node.taskRef)))) continue;
      const key = canonical(node); mapping.set(node.key, key);
      if (!nodes.has(key)) nodes.set(key, { ...node, key });
    }
    for (const edge of model.edges) {
      const from = mapping.get(edge.from), to = mapping.get(edge.to);
      if (from && to && !edges.has(edge.key)) edges.set(edge.key, { ...edge, from, to });
    }
  };
  for (const { ref, task } of tasks) {
    const key = dependencyEntityKey(ref.sourceId, "task", task.id);
    nodes.set(key, { key, kind: "task", id: task.id, sourceId: ref.sourceId, taskRef: ref,
      label: task.title, status: task.state, description: `현재 원본 revision ${task.revision}`, sequences: [],
      details: [{ label: "Task ID", value: task.id }, { label: "Project ID", value: task.projectId },
        { label: "Source ID", value: ref.sourceId }, { label: "현재 원본 revision", value: task.revision }] });
  }
  for (const run of runs) merge(missionFlow(run, runs, relations, [], { mode: "mission", includeExecution: false, maxNodes: 2000 }));
  merge(assistantFlow(executions, sources, { runs, maxNodes: 2000 }));
  for (const page of pages) {
    const admitted = projectDependenciesFlow(page, [], sources);
    const taskNodes = new Map(admitted.nodes.map(node => [node.key, node]));
    for (const edge of admitted.edges.filter(edge => edge.kind === "dependency")) {
      const from = taskNodes.get(edge.from), to = taskNodes.get(edge.to);
      if (!from?.taskRef || !to?.taskRef) continue;
      if (taskKeys.has(groupTaskKey(from.taskRef)) !== taskKeys.has(groupTaskKey(to.taskRef))) boundary.set(edge.key, { edge, from, to });
    }
    merge(admitted);
    incomplete ||= page.hasMore || !page.supported;
  }
  const output = [...nodes.values()].slice(0, 2000), included = new Set(output.map(node => node.key));
  return { nodes: output, edges: [...edges.values()].filter(edge => included.has(edge.from) && included.has(edge.to)),
    incomplete, boundaryDependencies: boundary.size, boundaries: [...boundary.values()], hiddenNodes: nodes.size - output.length };
}
