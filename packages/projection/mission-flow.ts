import type { AssistantRunAttempt, EventView, RelationKind, RelationView, RunView } from "../contracts/index.ts";
import { projectTrace } from "./trace.ts";
import { missionEntityKey, coworkMemberKey } from "./mission-identity.ts";
import { withCoworkFlow } from "./cowork-flow.ts";
import { assistantRunAttemptSchema } from "../contracts/index.ts";
import { withAssistantAttempts } from "./assistant-attempt-flow.ts";
export { missionEntityKey, coworkMemberKey } from "./mission-identity.ts";

export interface MissionNode {
  key: string;
  kind: string;
  id: string;
  label: string;
  status: string;
  description: string;
  sourceId: string;
  runKey?: string;
  taskRef?: { sourceId: string; projectId: string; taskId: string };
  assistantExecutionRef?: { sourceId: string; executionId: string };
  assistantAttemptRef?: AssistantRunAttempt;
  assistantAttemptScope?: { projectSourceId: string; projectId: string; taskId: string; workspaceId: string | null };
  callId?: string;
  invocationId?: string;
  coworkRef?: { groupId: string; memberId?: string };
  details: Array<{ label: string; value: string }>;
  sequences: string[];
}

export interface MissionEdge {
  key: string;
  from: string;
  to: string;
  kind: string;
  label: string;
  detail: string;
  sourceId: string;
  sequences: string[];
  assistantRunRef?: { sourceId: string; executionId: string; roleId: string; operationId: string };
}

export interface MissionFlowOptions { mode?: "mission" | "execution"; maxNodes?: number; hasMoreEvents?: boolean; includeExecution?: boolean }
export interface MissionFlow { nodes: MissionNode[]; edges: MissionEdge[]; hiddenNodes: number; eventCount: number; incomplete: boolean }

const attemptObservationStamp = (run: RunView): string => {
  const parsed = assistantRunAttemptSchema.safeParse(run.assistantAttempt), binding = run.binding;
  return JSON.stringify([run.key, run.sourceId, run.runId, run.sessionId, run.workspaceId, run.status, run.sourceState, run.stale,
    parsed.success ? parsed.data : run.assistantAttempt ?? null,
    binding ? [binding.sourceId, binding.runId, binding.projectSourceId, binding.projectId, binding.taskId] : null]);
};

/** A referenced invocation ID does not establish an observed invocation lifecycle. */
export const missionUnitKind = (node: Pick<MissionNode, "kind" | "status">): string =>
  node.kind === "invocation" && ["unobserved", "observed-reference", "unknown"].includes(node.status)
    ? "invocation-reference" : node.kind;

const compareSequence = (a: string, b: string): number => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const edgeKey = (sourceId: string, from: string, to: string, kind: string): string => JSON.stringify([sourceId, from, to, kind]);
const phaseLabel: Record<string, string> = { started: "시작 관측", completed: "완료 이벤트 관측", failed: "실패 이벤트 관측", cancelled: "취소 이벤트 관측", unfinished: "Run 종료 · 호출 종료 미확인", unknown: "확인 불가", ambiguous: "기록 모호" };
const relationLabels: Record<RelationKind, string> = {
  invocation: "호출", cowork: "협업", "managed-child": "관리 하위 실행", peer: "연결 세션", dependency: "의존성", artifact: "산출물",
};

function addDetail(node: MissionNode, label: string, value: string | null | undefined): void {
  if (value && !node.details.some((detail) => detail.label === label && detail.value === value)) node.details.push({ label, value });
}

function range(sequences: string[]): string {
  const ordered = [...new Set(sequences)].sort(compareSequence);
  if (!ordered.length) return "시퀀스 없음";
  return ordered.length === 1 ? ordered[0]! : `${ordered[0]}–${ordered[ordered.length - 1]}`;
}

function hasSequenceGap(events: EventView[], run: RunView): boolean {
  const values = [...new Set(events.filter((event) => event.sourceId === run.sourceId && event.runId === run.runId).map((event) => event.sequence))].sort(compareSequence);
  for (let index = 1; index < values.length; index++) {
    if (BigInt(values[index]!) - BigInt(values[index - 1]!) > 1n) return true;
  }
  return false;
}

/** Build a deterministic, metadata-only mission or execution view. Inputs are never modified. */
export function missionFlow(
  selected: RunView,
  runs: RunView[],
  relations: RelationView[],
  events: EventView[],
  options: MissionFlowOptions = {},
): MissionFlow {
  const mode = options.mode ?? "mission";
  const runByKey = new Map<string, RunView>([[selected.key, selected]]);
  for (const run of runs) if (!runByKey.has(run.key)) runByKey.set(run.key, run);
  const nodes = new Map<string, MissionNode>();
  const edges = new Map<string, MissionEdge>();
  const getNode = (sourceId: string, kind: string, id: string, label = id, status = "unknown", description = "기록된 메타데이터 참조", run?: RunView): MissionNode => {
    const key = missionEntityKey(sourceId, kind, id, run?.runId);
    let node = nodes.get(key);
    if (!node) {
      node = { key, kind, id, label, status, description, sourceId, ...(run ? { runKey: run.key } : {}), details: [], sequences: [] };
      nodes.set(key, node);
    } else if (run && !node.runKey) node.runKey = run.key;
    return node;
  };
  const addEdge = (sourceId: string, from: MissionNode, to: MissionNode, kind: string, label: string, detail: string, sequences: string[] = []): void => {
    const key = edgeKey(sourceId, from.key, to.key, kind);
    const existing = edges.get(key);
    const merged = [...new Set([...(existing?.sequences ?? []), ...sequences])].sort(compareSequence);
    edges.set(key, { key, from: from.key, to: to.key, kind, label, detail, sourceId, sequences: merged });
  };
  const actualRunNode = (run: RunView): MissionNode => {
    const node = getNode(run.sourceId, "run", run.runId, run.title || run.runId, run.status, "실제로 관측된 실행", run);
    addDetail(node, "실행 ID", run.runId); addDetail(node, "세션 ID", run.sessionId); addDetail(node, "출처", run.sourceLabel);
    addDetail(node, "장치", run.device); addDetail(node, "Workspace ID", run.workspaceId);
    addDetail(node, "시작", run.startedAt); addDetail(node, "종료", run.completedAt); addDetail(node, "마지막 관측", run.observedAt);
    return node;
  };
  const root = actualRunNode(selected);
  const eligibleRuns: RunView[] = [selected];
  // A shared coordinator role is explicit membership, not causal ordering. The
  // intent projection below alone can connect predecessor/successor Run edges.
  const selectedAttempt = assistantRunAttemptSchema.safeParse(selected.assistantAttempt);
  const roleRuns = mode === "mission" && selectedAttempt.success && selected.sourceState === "connected" && !selected.stale && selected.binding?.taskId &&
    selected.binding.sourceId === selected.sourceId && selected.binding.runId === selected.runId
    ? runs.filter(run => {
      const attempt = assistantRunAttemptSchema.safeParse(run.assistantAttempt);
      return run.key !== selected.key && run.sourceState === "connected" && !run.stale && run.sourceId === selected.sourceId &&
        run.workspaceId === selected.workspaceId && run.binding?.taskId === selected.binding?.taskId &&
        run.binding?.projectId === selected.binding?.projectId && run.binding?.projectSourceId === selected.binding?.projectSourceId &&
        run.binding?.sourceId === run.sourceId && run.binding?.runId === run.runId &&
        attempt.success && attempt.data.assistantSourceId === selectedAttempt.data.assistantSourceId &&
        attempt.data.executionId === selectedAttempt.data.executionId && attempt.data.roleId === selectedAttempt.data.roleId;
    }) : [];
  for (const run of roleRuns) { eligibleRuns.push(run); actualRunNode(run); }
  let taskNode: MissionNode | undefined;
  const binding = selected.binding;
  if (mode === "mission" && binding?.taskId && binding.provenance === "operator") {
    taskNode = getNode(binding.projectSourceId, "task", binding.taskId, binding.taskTitle || binding.taskId, "bound", "선택 실행의 명시적 작업 연결");
    taskNode.taskRef = { sourceId: binding.projectSourceId, projectId: binding.projectId, taskId: binding.taskId };
    addDetail(taskNode, "프로젝트 ID", binding.projectId); addDetail(taskNode, "프로젝트 출처", binding.projectSourceId);
    addDetail(taskNode, "업무 ID", binding.taskId); addDetail(taskNode, "연결 당시 업무 revision", binding.taskRevision);
    addDetail(taskNode, "바인딩", binding.provenance);
    addEdge(binding.projectSourceId, taskNode, root, "task-binding", "작업 연결", `${binding.projectTitle} · ${binding.provenance}`);
    const matches = runs.filter((run) => run.key !== selected.key && run.binding?.taskId === binding.taskId &&
      run.binding.projectId === binding.projectId && run.binding.projectSourceId === binding.projectSourceId);
    eligibleRuns.push(...matches.filter(run => !eligibleRuns.some(item => item.key === run.key)));
    for (const run of matches) addEdge(run.sourceId, taskNode, actualRunNode(run), "task-binding", "같은 작업", `${run.binding?.taskTitle || binding.taskTitle || binding.taskId} · ${run.binding?.provenance ?? "연결 기록"}`);
  }
  const eligibleKeys = new Set(eligibleRuns.map((run) => run.key));
  // Follow explicit Run endpoints across sessions, including children whose Task
  // binding is absent. A reference does not assign that child to the parent's Task.
  for (let changed = true; changed;) {
    changed = false;
    for (const relation of relations) {
      if (!eligibleKeys.has(relation.runKey)) continue;
      const owner = runByKey.get(relation.runKey); if (!owner) continue;
      for (const endpoint of [relation.from, relation.to]) {
        if (!endpoint.startsWith("run:")) continue;
        const observed = [...runByKey.values()].find((candidate) => candidate.sourceId === owner.sourceId && candidate.runId === endpoint.slice(4));
        if (observed && !eligibleKeys.has(observed.key)) { eligibleKeys.add(observed.key); eligibleRuns.push(observed); changed = true; }
      }
    }
  }

  // Ownership is deliberately a low-priority contextual clue, not execution causality.
  for (const run of eligibleRuns) {
    const runNode = actualRunNode(run);
    if (mode === "execution") continue;
    const session = getNode(run.sourceId, "session", run.sessionId, run.title ? `세션 · ${run.title}` : `Session ${run.sessionId.slice(0, 8)}`, "observed", "관측된 세션 소속");
    addDetail(session, "세션 ID", run.sessionId); addDetail(session, "장치", run.device);
    addEdge(run.sourceId, session, runNode, "ownership", "소속", "실행의 세션 소속");
    if (run.workspaceId) {
      const workspace = getNode(run.sourceId, "workspace", run.workspaceId, `Workspace ${run.workspaceId.slice(0, 8)}`, "observed", "관측된 작업공간 소속");
      addDetail(workspace, "Workspace ID", run.workspaceId); addDetail(workspace, "출처", run.sourceLabel);
      addEdge(run.sourceId, workspace, session, "ownership", "소속", "세션의 작업공간 소속");
    }
  }

  // A relation is admitted only from the selected run or an explicitly same-task run.
  const scopedRelations = relations.filter((relation) => eligibleKeys.has(relation.runKey));
  const relationRun = (relation: RelationView): RunView | undefined => runByKey.get(relation.runKey);
  for (const relation of scopedRelations) {
    const owner = relationRun(relation);
    if (!owner) continue;
    const endpoint = (entity: string, coworkGroupId?: string): MissionNode => {
      const separator = entity.indexOf(":");
      const kind = separator < 0 ? "unknown" : entity.slice(0, separator);
      const id = separator < 0 ? entity : entity.slice(separator + 1);
      if (kind === "member" && coworkGroupId) {
        const member = getNode(owner.sourceId, kind, coworkMemberKey(coworkGroupId, id), id, "observed-reference", "이 협업 그룹 안에서 명시된 멤버 참조", owner);
        addDetail(member, "협업 그룹 ID", coworkGroupId); addDetail(member, "멤버 ID", id);
        return member;
      }
      if (kind === "run") {
        const observed = [...runByKey.values()].find((run) => run.sourceId === owner.sourceId && run.runId === id);
        return observed ? actualRunNode(observed) : getNode(owner.sourceId, "run", id, id, "unobserved", "관계에 기록된 실행 ID; 실제 실행은 이 입력에서 관측되지 않음");
      }
      return getNode(owner.sourceId, kind, id, id, "observed-reference", "관계 증거의 출처·실행 범위 참조", ["invocation", "tool", "permission", "group", "member"].includes(kind) ? owner : undefined);
    };
    const from = endpoint(relation.from);
    const to = endpoint(relation.to, relation.kind === "cowork" && relation.from.startsWith("group:") ? relation.from.slice(6) : undefined);
    if (from.key !== actualRunNode(owner).key) addEdge(owner.sourceId, actualRunNode(owner), from, "relation-evidence", "관계 출처", `이 실행에서 관측한 ${relationLabels[relation.kind]} 관계`, [relation.evidenceSequence]);
    addDetail(from, "관계 증거", relation.evidenceSequence); addDetail(to, "관계 증거", relation.evidenceSequence);
    addEdge(owner.sourceId, from, to, relation.kind, relationLabels[relation.kind], `${owner.title || owner.runId} · ${relation.evidenceSequence}`, [relation.evidenceSequence]);
  }

  let eventCount = 0;
  let incomplete = Boolean(options.hasMoreEvents);
  for (const run of eligibleRuns) {
    incomplete ||= run.incomplete || run.stale || run.cursor !== run.highWater || hasSequenceGap(events, run);
    // Event type establishes lifecycle only; it does not disclose outcome or Task acceptance.
    const coworkUnits = new Map<string, { node: MissionNode; starts: string[]; ends: Set<string>; endSequences: string[] }>();
    for (const event of events) {
      if (event.sourceId !== run.sourceId || event.runId !== run.runId || !event.data.groupId) continue;
      const match = /^cowork\.(group|member)\.(started|completed|failed|cancelled)$/.exec(event.type);
      if (!match || match[1] === "member" && !event.data.memberId) continue;
      const groupId = event.data.groupId;
      const kind = match[1] === "group" ? "group" : "member";
      const id = kind === "group" ? groupId : coworkMemberKey(groupId, event.data.memberId!);
      const node = getNode(run.sourceId, kind, id, kind === "group" ? groupId : event.data.memberId!, "observed-reference", "원본 협업 생명주기", run);
      const unit = coworkUnits.get(node.key) ?? { node, starts: [], ends: new Set<string>(), endSequences: [] };
      if (match[2] === "started") unit.starts.push(event.sequence);
      else { unit.ends.add(match[2]!); unit.endSequences.push(event.sequence); }
      node.sequences = [...new Set([...node.sequences, event.sequence])].sort(compareSequence);
      addDetail(node, "협업 그룹 ID", groupId);
      if (kind === "member") addDetail(node, "멤버 ID", event.data.memberId);
      coworkUnits.set(node.key, unit);
    }
    for (const { node, starts, ends, endSequences } of coworkUnits.values()) {
      const terminal = [...ends][0];
      const reversed = starts.some(start => endSequences.some(end => compareSequence(start, end) > 0));
      node.status = ends.size > 1 || reversed ? "ambiguous" : terminal === "completed" ? "ended" : terminal ??
        (["succeeded", "failed", "cancelled", "expired", "interrupted"].includes(run.status) ? "unfinished" : "started");
      incomplete ||= !starts.length || node.status === "ambiguous" || node.status === "unfinished";
      node.description = "원본 협업 이벤트의 시작·종료 관측입니다. 실행 결과·업무 수용과 구별합니다.";
      addDetail(node, "협업 관측", node.status === "ended" ? "종료 이벤트 관측 · 결과 상태 미제공" :
        node.status === "unfinished" ? "Run 종료 · 협업 종료 미확인" : node.status === "ambiguous" ? "서로 다른 종료 근거 충돌" : node.status);
      if (!starts.length) addDetail(node, "관측 범위", "시작 이벤트 미조회");
      addDetail(node, "시퀀스", range(node.sequences));
    }
    if ((mode === "execution" || options.includeExecution) && run.key === selected.key) {
      const trace = projectTrace(run, events);
      eventCount = trace.eventCount;
      const scopedEvents = events.filter((event) => event.sourceId === run.sourceId && event.runId === run.runId);
      const invocationNodes = new Map<string, MissionNode>();
      for (const step of trace.steps) {
        const node = getNode(run.sourceId, "invocation", step.id, `호출 ${step.id}`, step.phase, "관측된 호출 생명주기", run);
        // A lifecycle observation is stronger than an earlier relation-only
        // reference, but does not resolve a conflicting lifecycle projection.
        node.label = `호출 ${step.id}`; node.status = step.phase; node.description = "관측된 호출 생명주기";
        node.sequences = [...new Set(scopedEvents.filter((event) => event.type.startsWith("agent.invocation.") && event.data.invocationId === step.id).map((event) => event.sequence))].sort(compareSequence);
        addDetail(node, "호출 ID", step.id); addDetail(node, "상태", phaseLabel[step.phase] ?? step.phase);
        if (node.sequences.length) addDetail(node, "시퀀스", range(node.sequences));
        invocationNodes.set(step.id, node);
      }
      for (const step of trace.steps) {
        const child = invocationNodes.get(step.id)!;
        if (step.parentId && step.phase !== "ambiguous") {
          const parent = invocationNodes.get(step.parentId) ?? getNode(run.sourceId, "invocation", step.parentId, `호출 ${step.parentId}`, "unobserved", "명시된 부모 호출 참조; 생명주기는 관측되지 않음", run);
          const rawKey = edgeKey(run.sourceId, parent.key, child.key, "invocation");
          const raw = edges.get(rawKey);
          if (raw) edges.delete(rawKey);
          const sequences = scopedEvents.filter(event => event.type.startsWith("agent.invocation.") &&
            event.data.invocationId === step.id && event.data.parentInvocationId === step.parentId).map(event => event.sequence);
          addEdge(run.sourceId, parent, child, "invocation-parent", "하위 호출",
            raw ? `명시된 parentInvocationId · 원본 invocation 관계: ${raw.detail}` : "명시된 parentInvocationId",
            [...(raw?.sequences ?? []), ...sequences]);
        } else if (!step.parentId && step.phase !== "ambiguous") addEdge(run.sourceId, root, child, "invocation-root", "실행 호출", "기록된 parentInvocationId 없음");
      }
      const units = new Map<string, Array<{ node: MissionNode; min: string; max: string }>>();
      const addUnit = (invocationId: string | null, node: MissionNode, sequences: string[]): void => {
        if (!sequences.length) return;
        const ordered = [...new Set(sequences)].sort(compareSequence);
        const group = units.get(invocationId ?? "") ?? [];
        group.push({ node, min: ordered[0]!, max: ordered[ordered.length - 1]! }); units.set(invocationId ?? "", group);
      };
      const tools = [...trace.steps.flatMap((step) => step.tools.map((tool) => ({ tool, owner: step.id }))),
        ...trace.unassigned.map((tool) => ({ tool, owner: tool.invocationId }))];
      for (const { tool, owner } of tools) {
        const node = getNode(run.sourceId, "tool", tool.key, tool.tool || `도구 ${tool.callId}`, tool.phase, "도구 호출의 관측 상태와 구간", run);
        node.sequences = [...tool.sequences];
        node.callId = tool.callId;
        if (owner) node.invocationId = owner;
        addDetail(node, "도구", tool.tool); addDetail(node, "도구 호출 ID", tool.callId); addDetail(node, "Invocation ID", tool.invocationId);
        addDetail(node, "시작 관측", tool.startedAt); addDetail(node, "완료 관측", tool.completedAt);
        if (tool.observedIntervalMs !== null) addDetail(node, "관측 구간", `${tool.observedIntervalMs} ms`);
        addDetail(node, "정규 이벤트 상태", phaseLabel[tool.phase] ?? tool.phase); addDetail(node, "시퀀스", range(tool.sequences));
        const parent = owner ? invocationNodes.get(owner) ?? getNode(run.sourceId, "invocation", owner, `호출 ${owner}`, "unobserved", "도구 메타데이터가 참조하지만 호출 생명주기는 없음", run) : root;
        if (owner && !invocationNodes.has(owner)) addEdge(run.sourceId, root, parent, "event-reference", "이벤트 참조", "도구 이벤트의 invocationId; 호출 생명주기는 관측되지 않음", tool.sequences);
        addEdge(run.sourceId, parent, node, "tool-of", owner ? "도구 호출" : "상위 호출 미상", owner ? "명시된 invocationId" : "도구 이벤트에 invocationId 없음", tool.sequences);
        addUnit(owner, node, tool.sequences);
      }
      for (const [invocationId, group] of units) {
        group.sort((a, b) => compareSequence(a.min, b.min) || compareSequence(a.max, b.max) || a.node.key.localeCompare(b.node.key));
        for (let left = 0; left < group.length; left++) {
          const before = group[left]!; let earliestEnd: string | undefined;
          for (let right = left + 1; right < group.length; right++) {
            const after = group[right]!;
            if (compareSequence(before.max, after.min) >= 0) continue;
            // Omit transitive shortcuts while retaining parallel minimal successors.
            if (earliestEnd && compareSequence(earliestEnd, after.min) < 0) break;
            addEdge(run.sourceId, before.node, after.node, "record-order", "기록 순서", `시퀀스 순서${invocationId ? ` · 호출 ${invocationId}` : " · 상위 호출 미상"}; 인과·의존 관계를 뜻하지 않음`, [before.max, after.min]);
            if (!earliestEnd || compareSequence(after.max, earliestEnd) < 0) earliestEnd = after.max;
          }
        }
      }
      for (const event of scopedEvents) {
        const permissionId = event.data.permissionId;
        if (!permissionId || !event.type.includes("permission")) continue;
        const permission = getNode(run.sourceId, "permission", permissionId, `권한 ${permissionId}`, event.data.status ?? "observed", "권한 식별자와 상태 메타데이터만 표시", run);
        permission.sequences = [...new Set([...permission.sequences, event.sequence])].sort(compareSequence);
        addDetail(permission, "권한 ID", permissionId); addDetail(permission, "상태", event.data.status);
        const ownerId = event.data.invocationId;
        const owner = ownerId ? invocationNodes.get(ownerId) ?? getNode(run.sourceId, "invocation", ownerId, `호출 ${ownerId}`, "unobserved", "권한 메타데이터가 참조한 호출", run) : root;
        if (ownerId && !invocationNodes.has(ownerId)) addEdge(run.sourceId, root, owner, "event-reference", "이벤트 참조", "권한 이벤트의 invocationId; 호출 생명주기는 관측되지 않음", [event.sequence]);
        addEdge(run.sourceId, owner, permission, "permission", "권한 상태", event.type, [event.sequence]);
      }
    } else {
      const runEvents = events.filter((event) => event.sourceId === run.sourceId && event.runId === run.runId);
      const trace = projectTrace(run, runEvents);
      eventCount += trace.eventCount;
    }
  }

  const attemptInputs = runs.some(run => attemptObservationStamp(run) === attemptObservationStamp(selected)) ? runs : [selected, ...runs];
  const cowork = withAssistantAttempts(withCoworkFlow({ nodes: [...nodes.values()], edges: [...edges.values()], eventCount, hiddenNodes: 0, incomplete }, eligibleRuns, events), attemptInputs);
  nodes.clear(); for (const node of cowork.nodes) nodes.set(node.key, node);
  edges.clear(); for (const edge of cowork.edges) edges.set(edge.key, edge);
  incomplete = cowork.incomplete;

  // Select a bounded connected component with BFS from the selected run. Edges are kept
  // whenever both endpoints survive, so useful relation endpoints are not discarded by edge slicing.
  const maxNodes = Number.isFinite(options.maxNodes) ? Math.max(1, Math.floor(options.maxNodes!)) : 200;
  const adjacency = new Map<string, string[]>();
  for (const edge of edges.values()) {
    (adjacency.get(edge.from) ?? (adjacency.set(edge.from, []), adjacency.get(edge.from)!)).push(edge.to);
    (adjacency.get(edge.to) ?? (adjacency.set(edge.to, []), adjacency.get(edge.to)!)).push(edge.from);
  }
  for (const links of adjacency.values()) links.sort();
  const chosen = new Set<string>(); const queue = [root.key, ...roleRuns.map(run => actualRunNode(run).key).sort()];
  for (let index = 0; index < queue.length && chosen.size < maxNodes; index++) {
    const key = queue[index]!;
    if (chosen.has(key) || !nodes.has(key)) continue;
    chosen.add(key);
    for (const next of adjacency.get(key) ?? []) if (!chosen.has(next)) queue.push(next);
  }
  const outputNodes = [...chosen].map((key) => nodes.get(key)!).sort((a, b) => a.key.localeCompare(b.key));
  const outputEdges = [...edges.values()].filter((edge) => chosen.has(edge.from) && chosen.has(edge.to)).sort((a, b) => a.key.localeCompare(b.key));
  return { nodes: outputNodes, edges: outputEdges, hiddenNodes: nodes.size - chosen.size, eventCount, incomplete: incomplete || nodes.size > chosen.size };
}
