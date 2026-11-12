import type { AssistantExecutionView } from "../contracts/assistant-view.ts";
import type { SourceView } from "../contracts/index.ts";
import type { MissionEdge, MissionNode } from "./mission-flow.ts";
import { flowGroupKey, type FlowGroupDefinition } from "./flow-groups.ts";
import { dependencyEntityKey } from "./project-dependencies-flow.ts";

export const assistantEntityKey = (sourceId: string, kind: string, id: string): string =>
  JSON.stringify([sourceId, kind, id]);
export const assistantRoleKey = (sourceId: string, executionId: string, roleId: string): string =>
  assistantEntityKey(sourceId, "assistant-role", JSON.stringify([executionId, roleId]));
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const ordered = <T extends { key: string }>(values: Iterable<T>): T[] =>
  [...values].sort((a, b) => compare(a.key, b.key));
const details = (values: Record<string, string | number | boolean | null>): MissionNode["details"] =>
  Object.entries(values).map(([label, value]) => ({ label, value: value === null ? "unknown" : String(value) }));
const runtimeKinds = new Set(["assistant-runtime-task", "assistant-thread", "assistant-turn"]);

// Canonical comparison ignores object property order, but never chooses a winner
// between conflicting observations of one identity.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") return JSON.stringify(Object.entries(value)
    .sort(([a], [b]) => compare(a, b)).map(([key, item]) => [key, canonical(item)]));
  return JSON.stringify(value) ?? "undefined";
}
function unambiguous<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const result = new Map<string, T>();
  const rejected = new Set<string>();
  for (const item of items) {
    const id = key(item);
    if (rejected.has(id)) continue;
    if (result.has(id) && canonical(result.get(id)) !== canonical(item)) {
      result.delete(id); rejected.add(id);
    } else result.set(id, item);
  }
  return result;
}

/** Pure metadata projection of the live native window, never a Demian Run conversion. */
export function assistantFlow(executions: AssistantExecutionView[], sources: SourceView[], options: {
  projectsSourceId?: string; projectId?: string; taskId?: string; maxNodes?: number;
} = {}): { nodes: MissionNode[]; edges: MissionEdge[]; hiddenNodes: number; incomplete: boolean } {
  const sourceById = unambiguous(sources, source => source.id);
  const candidates = unambiguous(executions, view => assistantEntityKey(view.sourceId, "assistant-execution", view.native.id));
  const eligible = [...candidates.values()].filter(view => {
    const source = sourceById.get(view.sourceId);
    if (source?.kind !== "assistant" || source.state !== "connected") return false;
    const ref = view.native.task; const current = view.currentTask;
    if (!ref) return current === null && options.projectsSourceId === undefined &&
      options.projectId === undefined && options.taskId === undefined;
    if (!current || ref.taskId !== current.task.id || ref.projectId !== current.task.projectId ||
      ref.projectId !== current.project.id) return false;
    const projects = sourceById.get(current.projectsSourceId);
    return projects?.kind === "projects" && projects.state === "connected" &&
      projects.authorizedProjectIds?.includes(current.project.id) === true &&
      (options.projectsSourceId === undefined || options.projectsSourceId === current.projectsSourceId) &&
      (options.projectId === undefined || options.projectId === current.project.id) &&
      (options.taskId === undefined || options.taskId === current.task.id);
  });
  // A Task key is shared with the parent's dependency projection. Conflicting
  // snapshots cannot silently supply another execution's current Task metadata.
  const currentTasks = unambiguous(eligible.flatMap(view => view.currentTask ? [{ ...view.currentTask, observedAt: "" }] : []),
    current => dependencyEntityKey(current.projectsSourceId, "task", current.task.id));
  const nodes = new Map<string, MissionNode>(); const edges = new Map<string, MissionEdge>();
  const add = (sourceId: string, kind: string, id: string, label: string, status: string,
    description: string, metadata: MissionNode["details"], key = assistantEntityKey(sourceId, kind, id)): MissionNode => {
    const node = nodes.get(key) ?? { key, sourceId, kind, id, label, status, description, details: metadata, sequences: [] };
    nodes.set(key, node); return node;
  };
  const edge = (from: MissionNode, to: MissionNode, kind: string, label: string, provenance: string) => {
    const key = JSON.stringify([to.sourceId, kind, from.key, to.key]);
    edges.set(key, { key, sourceId: to.sourceId, from: from.key, to: to.key, kind, label, sequences: [],
      detail: `Source ID: ${to.sourceId}; from: ${from.key}; to: ${to.key}; provenance: ${provenance}` });
  };
  for (const view of eligible.sort((a, b) => compare(assistantEntityKey(a.sourceId, "assistant-execution", a.native.id),
    assistantEntityKey(b.sourceId, "assistant-execution", b.native.id)))) {
    const native = view.native; const current = view.currentTask;
    if (current && !currentTasks.has(dependencyEntityKey(current.projectsSourceId, "task", current.task.id))) continue;
    // Repeated role identity is invalid even if the repeated payload is identical.
    if (new Set(native.roles.map(role => role.id)).size !== native.roles.length) continue;
    const execution = add(view.sourceId, "assistant-execution", native.id, `Assistant 실행 · ${native.id.slice(0, 8)}`,
      native.state, "원본 WorkExecution 상태 · 실행 완료는 업무 완료를 뜻하지 않습니다.", details({
        "Source ID": view.sourceId, "출처": view.sourceLabel, "장치": view.device,
        "Execution ID": native.id, "Execution revision": native.revision, "원본 실행 상태": native.state,
        "Instruction ID": native.instructionId, "Instruction revision": native.instructionRevision,
        "Error code": native.errorCode, "생성 시각": native.createdAt, "갱신 시각": native.updatedAt,
        "관측 범위": "부분 native window; 전체 실행 이력 아님",
        ...(native.task ? { "기록 당시 Project ID": native.task.projectId, "기록 당시 Task ID": native.task.taskId,
          "기록 당시 Task revision": native.task.revision, "기록 당시 Task 상태": native.task.state,
          "기록 당시 Task 관측 시각": native.task.observedAt } : { "업무 연결": "원본 연결 없음" }),
        ...(current ? { "현재 Projects Source ID": current.projectsSourceId, "현재 Project ID": current.project.id,
          "현재 Task ID": current.task.id, "현재 Task revision": current.task.revision,
          "현재 Task 상태": current.task.state, "현재 Task 관측 시각": current.observedAt } : {}),
      }));
    if (current) {
      const task = add(current.projectsSourceId, "task", current.task.id, current.task.title || current.task.id,
        current.task.state, "현재 Projects 원본 업무 상태 · Assistant 실행 상태와 별도", details({
          "Source ID": current.projectsSourceId, "Project ID": current.project.id, "Task ID": current.task.id,
          "현재 원본 revision": current.task.revision, "현재 원본 상태": current.task.state,
          "현재 관측 시각": current.observedAt, "테스트 필요": current.task.requiresTest,
        }), dependencyEntityKey(current.projectsSourceId, "task", current.task.id));
      edge(task, execution, "assistant-task-binding", "원본 업무 연결",
        `WorkExecution.task; Project ID: ${current.project.id}; Task ID: ${current.task.id}; Projects Source ID: ${current.projectsSourceId}; 현재 식별자·권한 대조; 실행 의존·업무 완료 근거 아님`);
    }
    for (const role of [...native.roles].sort((a, b) => compare(a.id, b.id))) {
      const roleNode = add(view.sourceId, "assistant-role", role.id, role.label || `역할 · ${role.id.slice(0, 8)}`,
        role.state, "이 WorkExecution에 기록된 역할과 관측 시간", details({
          "Source ID": view.sourceId, "Execution ID": native.id, "Role ID": role.id,
          "역할": role.label, "팀": role.teamLabel, "에이전트": role.agentLabel,
          "Team ID": role.teamId, "책임": role.responsibility, "Assignment ID": role.assignmentId,
          "Work package ID": role.workPackageId, "Membership ID": role.membershipId,
          "Membership revision": role.membershipRevision, "원본 역할 상태": role.state, "시도 횟수": role.attempts,
          "대기 관측 시각": role.observation.queuedAt, "시작 관측 시각": role.observation.startedAt,
          "종료 관측 시각": role.observation.endedAt, "관측 시간 (초)": role.observation.seconds,
          "시간 관측 완전성": role.observation.timingComplete, "시간 관측 근거": role.observation.basis,
          "Runtime Task ID": role.runtime.taskId, "Thread ID": role.runtime.threadId, "Turn ID": role.runtime.turnId,
        }), assistantRoleKey(view.sourceId, native.id, role.id));
      edge(execution, roleNode, "assistant-role", "원본 역할",
        `WorkExecution.roles; Execution ID: ${native.id}; Role ID: ${role.id}; 명시적 실행 내 역할 소속`);
      for (const [kind, id, label, field] of [
        ["assistant-runtime-task", role.runtime.taskId, "런타임 작업 참조", "taskId"],
        ["assistant-thread", role.runtime.threadId, "스레드 참조", "threadId"],
        ["assistant-turn", role.runtime.turnId, "턴 참조", "turnId"],
      ] as const) {
        if (!id) continue;
        const ref = add(view.sourceId, kind, id, `${label} · ${id}`, "observed",
          "원본 runtime ID 참조만 관측됨 · 런타임 상태는 확인 불가", details({ "Source ID": view.sourceId, "Runtime ID": id, "런타임 상태": "unknown" }));
        if (!ref.details.some(item => item.label === "Referencing execution key" && item.value === execution.key))
          ref.details.push({ label: "Referencing execution key", value: execution.key });
        edge(roleNode, ref, "assistant-runtime-reference", "원본 런타임 참조",
          `WorkExecution.roles.runtime.${field}; Execution ID: ${native.id}; Role ID: ${role.id}; Runtime ID: ${id}; ID 참조이며 역할 상태로 런타임 상태·Demian 연결을 추론하지 않음`);
      }
    }
  }
  const priority = (node: MissionNode) => node.kind === "task" ? 0 : node.kind === "assistant-execution" ? 1 : node.kind === "assistant-role" ? 2 : 3;
  const limit = Number.isFinite(options.maxNodes) ? Math.min(500, Math.max(0, Math.floor(options.maxNodes!))) : 240;
  const selected = [...nodes.values()].sort((a, b) => priority(a) - priority(b) || compare(a.key, b.key)).slice(0, limit);
  const keys = new Set(selected.map(node => node.key));
  return { nodes: selected, edges: ordered(edges.values()).filter(item => keys.has(item.from) && keys.has(item.to)),
    hiddenNodes: nodes.size - selected.length, incomplete: true };
}

/** Containers are native execution scopes; the parent owns all Task attachment. */
export function assistantFlowGroups(model: { nodes: MissionNode[]; edges: MissionEdge[] }): FlowGroupDefinition[] {
  const nodes = unambiguous(model.nodes, node => node.key);
  const executions = ordered([...nodes.values()].filter(node => node.kind === "assistant-execution"));
  const owners = new Map<string, Set<string>>();
  for (const edge of model.edges.filter(edge => edge.kind === "assistant-role")) {
    const from = nodes.get(edge.from); const to = nodes.get(edge.to);
    if (!from || !to || from.kind !== "assistant-execution" || to.kind !== "assistant-role" ||
      from.sourceId !== to.sourceId || edge.sourceId !== from.sourceId) continue;
    const set = owners.get(to.key) ?? new Set<string>(); set.add(from.key); owners.set(to.key, set);
  }
  const groups: FlowGroupDefinition[] = [];
  for (const execution of executions) {
    const roles = ordered([...nodes.values()].filter(node => node.kind === "assistant-role" &&
      owners.get(node.key)?.size === 1 && owners.get(node.key)?.has(execution.key)));
    const group: FlowGroupDefinition = { key: flowGroupKey("assistant-execution", execution.key),
      kind: "assistant-execution", basis: "native", sourceId: execution.sourceId,
      label: execution.label, memberKeys: [execution.key, ...roles.map(role => role.key)],
      description: "현재 원본 WorkExecution과 명시된 역할·현재 범위의 단일 실행 runtime 참조; 전체 이력 아님" };
    for (const ref of ordered([...nodes.values()].filter(node => runtimeKinds.has(node.kind)))) {
      const references = model.edges.filter(edge => edge.kind === "assistant-runtime-reference" && edge.to === ref.key);
      const referring = new Set(ref.details.filter(item => item.label === "Referencing execution key").map(item => item.value));
      let ambiguous = references.length === 0;
      for (const edge of references) {
        const role = nodes.get(edge.from); const roleOwners = owners.get(edge.from);
        if (!role || role.kind !== "assistant-role" || role.sourceId !== ref.sourceId ||
          edge.sourceId !== ref.sourceId || roleOwners?.size !== 1) { ambiguous = true; continue; }
        for (const owner of roleOwners) referring.add(owner);
      }
      if (!ambiguous && referring.size === 1 && referring.has(execution.key)) group.memberKeys.push(ref.key);
    }
    const packages = new Map<string, string[]>();
    for (const role of roles) {
      const ids = new Set(role.details.filter(item => item.label === "Work package ID").map(item => item.value).filter(Boolean));
      if (ids.size !== 1) continue;
      const id = [...ids][0]!; const members = packages.get(id) ?? []; members.push(role.key); packages.set(id, members);
    }
    for (const [id, members] of packages) {
      if (members.length < 2) continue;
      const child: FlowGroupDefinition = { key: flowGroupKey("assistant-work-package", JSON.stringify([execution.key, id])),
        kind: "assistant-work-package", basis: "native", sourceId: execution.sourceId, parentKey: group.key,
        label: `실행 내 작업 패키지 · ${id}`, memberKeys: members,
        description: "현재 WorkExecution 역할의 명시적 Work package ID; 전역 Task 작업 패키지 계층 아님" };
      const moved = new Set(members); group.memberKeys = group.memberKeys.filter(key => !moved.has(key)); groups.push(child);
    }
    groups.push(group);
  }
  return ordered(groups).map(group => ({ ...group, memberKeys: group.memberKeys.sort(compare) }));
}

/** Join both native execution types on the same authorized Projects Task key. */
export function withAssistantExecutions<T extends { nodes: MissionNode[]; edges: MissionEdge[]; hiddenNodes: number; incomplete: boolean; focusPresent: boolean }>(
  base: T, executions: AssistantExecutionView[], sources: SourceView[],
  scope: { sourceId: string; projectId: string; focusTaskId?: string },
): T {
  const known = new Set(base.nodes.filter(node => node.kind === "task").map(node => node.id));
  const relevant = executions.filter(view => !scope.focusTaskId || known.has(view.currentTask?.task.id ?? "") || view.currentTask?.task.id === scope.focusTaskId);
  const extra = assistantFlow(relevant, sources, { projectsSourceId: scope.sourceId, projectId: scope.projectId, maxNodes: 240 });
  const nodes = new Map(base.nodes.map(node => [node.key, node]));
  for (const node of extra.nodes) {
    const previous = nodes.get(node.key);
    if (!previous) nodes.set(node.key, node);
    else if (node.kind === "task" && previous.details.find(detail => detail.label === "현재 원본 revision")?.value !==
        node.details.find(detail => detail.label === "현재 원본 revision")?.value) {
      nodes.set(node.key, { ...previous, status: "unknown", description: "두 원본 조회의 업무 revision이 달라 현재 상태를 다시 확인해야 합니다.",
        details: [...previous.details, { label: "Assistant 업무 조회 revision", value: node.details.find(detail => detail.label === "현재 원본 revision")?.value ?? "미확인" }] });
    }
  }
  const selected = [...nodes.values()].slice(0, 240), keys = new Set(selected.map(node => node.key));
  const edges = new Map([...base.edges, ...extra.edges].filter(edge => keys.has(edge.from) && keys.has(edge.to)).map(edge => [edge.key, edge]));
  return { ...base, nodes: selected, edges: [...edges.values()], hiddenNodes: base.hiddenNodes + extra.hiddenNodes + nodes.size - selected.length,
    focusPresent: base.focusPresent || selected.some(node => node.kind === "task" && node.id === scope.focusTaskId),
    incomplete: base.incomplete || extra.nodes.length > 0 || nodes.size > 240 };
}
