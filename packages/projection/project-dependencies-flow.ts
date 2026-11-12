import type { ProjectTaskMetadata, RunView, SourceView } from "../contracts/index.ts";
import type { ProjectDependencyPage } from "../contracts/project-dependencies.ts";
import type { MissionNode, MissionEdge } from "./mission-flow.ts";
import { analyseGraph } from "./graph.ts";

export const dependencyEntityKey = (source: string, kind: string, id: string) =>
  JSON.stringify([source, kind, id]);

export function dependencyGrants(sources: SourceView[]): Set<string> {
  return new Set(sources.filter((s) => s.kind === "projects" && s.state === "connected")
    .flatMap((s) => (s.authorizedProjectIds ?? []).map((id) => JSON.stringify([s.id, id]))));
}

export function projectDependenciesFlow(page: ProjectDependencyPage, runs: RunView[],
  sources: SourceView[], focusTaskId?: string) {
  const grants = dependencyGrants(sources);
  const allowed = (id: string) => grants.has(JSON.stringify([page.sourceId, id]));
  const nodes = new Map<string, MissionNode>();
  const edges = new Map<string, MissionEdge>();
  const scoped = allowed(page.projectId) && page.supported;
  const admitted = scoped ? page.dependencies.filter((e) =>
    allowed(e.projectId) && allowed(e.fromTask.projectId) && allowed(e.toTask.projectId)) : [];
  let dependencies = admitted;
  const focusPresent = admitted.some((e) => e.fromTask.id === focusTaskId || e.toTask.id === focusTaskId);
  if (focusTaskId && focusPresent) {
    const closure = new Set([focusTaskId]);
    for (let changed = true; changed;) {
      changed = false;
      for (const e of admitted) {
        if (!closure.has(e.fromTask.id) && !closure.has(e.toTask.id)) continue;
        for (const t of [e.fromTask, e.toTask]) if (!closure.has(t.id)) {
          closure.add(t.id); changed = true;
        }
      }
    }
    dependencies = admitted.filter((e) => closure.has(e.fromTask.id) && closure.has(e.toTask.id));
  }
  if (focusTaskId && !focusPresent) dependencies = [];
  const task = (t: ProjectTaskMetadata) => {
    const key = dependencyEntityKey(page.sourceId, "task", t.id);
    const previous = nodes.get(key);
    if (previous) return previous;
    const node: MissionNode = { key, id: t.id, kind: "task", sourceId: page.sourceId,
      taskRef: { sourceId: page.sourceId, projectId: t.projectId, taskId: t.id },
      label: t.title || t.id, status: t.state, description: `현재 원본 revision ${t.revision}`,
      sequences: [], details: [
        { label: "Task ID", value: t.id }, { label: "Project ID", value: t.projectId },
        { label: "Source ID", value: page.sourceId }, { label: "현재 원본 상태", value: t.state },
        { label: "현재 원본 revision", value: t.revision },
        { label: "테스트 필요", value: t.requiresTest ? "예" : "아니요" },
      ] };
    nodes.set(key, node); return node;
  };
  const edge = (key: string, from: MissionNode, to: MissionNode,
    kind: string, label: string, detail: string) => {
    edges.set(key, { key, from: from.key, to: to.key, sourceId: kind === "ownership" ? to.sourceId : page.sourceId,
      kind, label, detail, sequences: [] });
  };
  for (const e of dependencies) {
    const dependent = task(e.fromTask); const prerequisite = task(e.toTask);
    edge(JSON.stringify([page.sourceId, "dependency", e.id]), prerequisite, dependent,
      "dependency", "선행 조건", [
        `Relation ID: ${e.id}; Source ID: ${page.sourceId}; Owner Project ID: ${e.projectId}.`,
        `원본 방향: fromTask ${e.fromTask.id} depends_on toTask ${e.toTask.id}.`,
        "화살표: 선행 업무(toTask) → 의존 업무(fromTask). 실행 배정·Task 성공을 뜻하지 않습니다.",
        `fromTask Project ID: ${e.fromTask.projectId}; 현재 상태 ${e.fromTask.state}; 현재 revision ${e.fromTask.revision}; 관계 기록 revision ${e.fromRevision}.`,
        `toTask Project ID: ${e.toTask.projectId}; 현재 상태 ${e.toTask.state}; 현재 revision ${e.toTask.revision}; 관계 기록 revision ${e.toRevision}.`,
      ].join("\n"));
  }
  // Tasks get first claim on the bounded display; Runs never create Task nodes.
  const orderedTasks = [...nodes.values()].sort((a, b) =>
    Number(b.id === focusTaskId) - Number(a.id === focusTaskId) || a.key.localeCompare(b.key));
  const displayedTasks = new Set(orderedTasks.slice(0, 160).map((n) => n.key));
  for (const run of scoped ? runs : []) {
    const binding = run.binding;
    if (!binding?.taskId || binding.sourceId !== run.sourceId || binding.runId !== run.runId ||
      binding.projectSourceId !== page.sourceId || !allowed(binding.projectId)) continue;
    const owner = nodes.get(dependencyEntityKey(page.sourceId, "task", binding.taskId));
    if (!owner || !displayedTasks.has(owner.key) ||
      !owner.details.some((d) => d.label === "Project ID" && d.value === binding.projectId)) continue;
    const key = dependencyEntityKey(run.sourceId, "run", run.runId);
    const sessionKey = dependencyEntityKey(run.sourceId, "session", run.sessionId);
    const runNode: MissionNode = { key, id: run.runId, sourceId: run.sourceId,
      kind: "run", label: run.title || run.runId, status: run.status, runKey: run.key,
      description: "관측된 Run 상태 · Task 상태와 별도", sequences: [], details: [
        { label: "Run ID", value: run.runId }, { label: "Source ID", value: run.sourceId },
        { label: "Session ID", value: run.sessionId }, { label: "Run 상태", value: run.status },
        { label: "연결된 Task Source ID", value: binding.projectSourceId },
        { label: "연결된 Project ID", value: binding.projectId },
        { label: "연결된 Task ID", value: binding.taskId },
        { label: "연결 당시 Task revision", value: binding.taskRevision ?? "미기록" },
        { label: "연결 근거", value: binding.provenance },
        { label: "관측 시각", value: run.observedAt },
        { label: "Run 부분 관측", value: String(run.incomplete) },
        { label: "Run 오래된 관측", value: String(run.stale) },
      ] };
    if (!nodes.has(key)) nodes.set(key, runNode);
    if (!nodes.has(sessionKey)) nodes.set(sessionKey, { key: sessionKey, id: run.sessionId,
      sourceId: run.sourceId, kind: "session", label: `Session ${run.sessionId}`,
      status: "observed", description: "실제로 관측된 Run의 세션 소속", sequences: [],
      details: [{ label: "Session ID", value: run.sessionId }, { label: "Source ID", value: run.sourceId }] });
    edge(JSON.stringify(["task-binding", owner.key, key]), owner, runNode,
      "task-binding", "명시적 Task 연결", `명시적 ${binding.provenance} binding; 실행 의존·Task 완료 근거 아님`);
    edge(JSON.stringify(["ownership", sessionKey, key]), nodes.get(sessionKey)!, runNode,
      "ownership", "Session 소속", "관측된 Session → Run; 실행 배정 관계 아님");
  }
  const selected = [...orderedTasks, ...[...nodes.values()].filter((n) => n.kind !== "task")].slice(0, 160);
  const keys = new Set(selected.map((n) => n.key));
  const outputEdges = [...edges.values()].filter((e) => keys.has(e.from) && keys.has(e.to));
  const cycles = analyseGraph({ nodes: selected, edges: outputEdges
    .filter((e) => e.kind === "dependency").map((e) => ({ ...e, kind: "dependency" as const })) }).cyclic;
  return { nodes: selected, edges: outputEdges, cycles, focusPresent,
    hiddenNodes: nodes.size - selected.length,
    incomplete: page.hasMore || nodes.size > 160 || admitted.length < page.dependencies.length };
}
