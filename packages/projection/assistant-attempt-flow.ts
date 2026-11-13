import { z } from "zod";
import { assistantRunAttemptSchema, idSchema, type RunView } from "../contracts/index.ts";
import type { FlowGroupDefinition } from "./flow-groups.ts";
import { flowGroupKey } from "./flow-groups.ts";
import type { MissionEdge, MissionNode } from "./mission-flow.ts";

type AssistantAttempt = NonNullable<RunView["assistantAttempt"]>;
type BoundRun = Pick<RunView, "sourceId" | "runId" | "key" | "workspaceId"> & {
  binding: { projectSourceId: string; projectId: string; taskId: string };
};
type Candidate = { node: MissionNode; run: BoundRun; attempt: AssistantAttempt };

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const logicalRole = (sourceId: string, attempt: AssistantAttempt): string =>
  JSON.stringify([sourceId, attempt.assistantSourceId, attempt.executionId, attempt.roleId]);
const runIdentity = (run: Pick<RunView, "sourceId" | "runId">): string => JSON.stringify([run.sourceId, run.runId]);
const attemptScope = (run: BoundRun, attempt: AssistantAttempt): string => JSON.stringify([
  run.sourceId, attempt.assistantSourceId, attempt.executionId, attempt.roleId,
  run.binding.projectSourceId, run.binding.projectId, run.binding.taskId, run.workspaceId,
]);

function validAttempt(run: RunView): AssistantAttempt | undefined {
  const parsed = assistantRunAttemptSchema.safeParse(run.assistantAttempt);
  return parsed.success ? parsed.data : undefined;
}

const scopeSchema = z.object({ projectSourceId: idSchema, projectId: idSchema, taskId: idSchema,
  workspaceId: idSchema.nullable() }).strict();
const intentKinds = new Set(["assistant-retry-intent", "assistant-resume-intent"]);
const detailLabels = new Set(["Assistant source ID", "Assistant execution ID", "역할 ID", "Attempt ID", "Attempt ordinal",
  "Assistant attempt 프로젝트 출처", "Assistant attempt 프로젝트 ID", "Assistant attempt 업무 ID", "Assistant attempt Workspace ID",
  "선행 Attempt", "선행 Attempt 관측", "명령 ID", "명령 의미"]);

function decoratedCandidates(nodes: MissionNode[]): Candidate[] {
  const candidates: Candidate[] = [];
  for (const node of nodes) {
    if (node.kind !== "run" || !node.runKey || node.status === "unobserved") continue;
    const parsed = assistantRunAttemptSchema.safeParse(node.assistantAttemptRef);
    const scope = scopeSchema.safeParse(node.assistantAttemptScope);
    if (!parsed.success || !scope.success) continue;
    const { workspaceId, ...binding } = scope.data;
    const run: BoundRun = { sourceId: node.sourceId, runId: node.id, key: node.runKey, workspaceId, binding };
    candidates.push({ node, run, attempt: parsed.data });
  }
  return candidates;
}

function conflictedRoleKeys(candidates: Candidate[]): Set<string> {
  const roles = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const key = logicalRole(candidate.run.sourceId, candidate.attempt);
    const values = roles.get(key) ?? [];
    values.push(candidate);
    roles.set(key, values);
  }
  const rejected = new Set<string>();
  for (const [key, values] of roles) {
    const scopes = new Set(values.map(({ run, attempt }) => attemptScope(run, attempt)));
    const attempts = new Set<string>();
    const ordinals = new Set<number>();
    const identities = new Map<string, Set<string>>();
    for (const { run, attempt } of values) {
      const identity = runIdentity(run);
      const keys = identities.get(identity) ?? new Set<string>();
      keys.add(run.key);
      identities.set(identity, keys);
      if (attempts.has(attempt.attemptId) || ordinals.has(attempt.ordinal)) rejected.add(key);
      attempts.add(attempt.attemptId);
      ordinals.add(attempt.ordinal);
    }
    if (scopes.size > 1 || [...identities.values()].some((keys) => keys.size > 1)) rejected.add(key);
  }
  return rejected;
}

/** Add only explicit coordinator intent between unambiguous, bound Native Runs. */
export function withAssistantAttempts<T extends {
  nodes: MissionNode[]; edges: MissionEdge[]; incomplete: boolean;
}>(base: T, runs: RunView[]): T {
  // Repeated projections and authority withdrawal must not retain stale derived
  // intent edges, duplicate inspector rows, or a previously decorated reference.
  const hadDerived = base.edges.some(edge => intentKinds.has(edge.kind)) || base.nodes.some(node => node.assistantAttemptRef || node.assistantAttemptScope);
  const clean = hadDerived ? { ...base, edges: base.edges.filter(edge => !intentKinds.has(edge.kind)),
    nodes: base.nodes.map(node => {
      if (!node.assistantAttemptRef && !node.assistantAttemptScope) return node;
      const { assistantAttemptRef: _ref, assistantAttemptScope: _scope, ...rest } = node;
      return { ...rest, details: node.details.filter(detail => !detailLabels.has(detail.label)) };
    }) } : base;
  const runCounts = new Map<string, number>();
  const identityCounts = new Map<string, number>();
  for (const run of runs) {
    runCounts.set(run.key, (runCounts.get(run.key) ?? 0) + 1);
    identityCounts.set(runIdentity(run), (identityCounts.get(runIdentity(run)) ?? 0) + 1);
  }
  const candidates: Candidate[] = [];
  for (const node of clean.nodes) {
    if (node.kind !== "run" || !node.runKey) continue;
    const matches = runs.filter((run) => run.key === node.runKey && run.sourceId === node.sourceId && run.runId === node.id);
    const identityMatches = runs.filter((run) => run.sourceId === node.sourceId && run.runId === node.id);
    if (matches.length !== 1 || identityMatches.length !== 1 || runCounts.get(node.runKey) !== 1) continue;
    const run = matches[0]!;
    if (node.status === "unobserved" || run.sourceState !== "connected" || run.stale || !run.binding?.taskId ||
      run.binding.sourceId !== run.sourceId || run.binding.runId !== run.runId) continue;
    const attempt = validAttempt(run);
    if (attempt) candidates.push({ node, run: { ...run, binding: { ...run.binding, taskId: run.binding.taskId } }, attempt });
  }

  const rejected = conflictedRoleKeys(candidates);
  for (const run of runs) {
    const attempt = validAttempt(run);
    if (attempt && (runCounts.get(run.key)! > 1 || identityCounts.get(runIdentity(run))! > 1))
      rejected.add(logicalRole(run.sourceId, attempt));
  }
  const admitted = candidates.filter(({ run, attempt }) => !rejected.has(logicalRole(run.sourceId, attempt)));
  if (admitted.length === 0) return clean;
  const byAttempt = new Map<string, Candidate>();
  const attemptKey = (candidate: Candidate, id: string) => JSON.stringify([logicalRole(candidate.run.sourceId, candidate.attempt), id]);
  for (const candidate of admitted) byAttempt.set(attemptKey(candidate, candidate.attempt.attemptId), candidate);

  const nodeCopies = new Map<string, MissionNode>();
  const pendingEdges: MissionEdge[] = [];
  let incomplete = base.incomplete;
  for (const { node, run, attempt } of admitted) {
    const details = [...node.details,
      { label: "Assistant source ID", value: attempt.assistantSourceId },
      { label: "Assistant execution ID", value: attempt.executionId },
      { label: "역할 ID", value: attempt.roleId },
      { label: "Attempt ID", value: attempt.attemptId },
      { label: "Attempt ordinal", value: String(attempt.ordinal) },
      { label: "Assistant attempt 프로젝트 출처", value: run.binding.projectSourceId },
      { label: "Assistant attempt 프로젝트 ID", value: run.binding.projectId },
      { label: "Assistant attempt 업무 ID", value: run.binding.taskId },
      { label: "Assistant attempt Workspace ID", value: run.workspaceId ?? "unknown" },
    ];
    const nodeCopy: MissionNode = { ...node, details, assistantAttemptScope: { projectSourceId: run.binding.projectSourceId,
      projectId: run.binding.projectId, taskId: run.binding.taskId, workspaceId: run.workspaceId } };
    nodeCopy.assistantAttemptRef = attempt;
    const command = attempt.command;
    if (command) {
      const predecessor = byAttempt.get(attemptKey({ node, run, attempt }, command.predecessorAttemptId));
      nodeCopy.details.push({ label: "명령 ID", value: command.id },
        { label: "명령 의미", value: `${command.kind} · coordinator-intent; Native 접수·실행 성공은 별도` });
      const validPredecessor = predecessor && predecessor.node.key !== node.key &&
        predecessor.attempt.ordinal < attempt.ordinal &&
        attemptScope(predecessor.run, predecessor.attempt) === attemptScope(run, attempt);
      if (validPredecessor) {
        const kind = command.kind === "retry" ? "assistant-retry-intent" : "assistant-resume-intent";
        const label = command.kind === "retry" ? "재시도 요청" : "재개 요청";
        const edge: MissionEdge = {
          key: JSON.stringify([run.sourceId, kind, predecessor.run.runId, run.runId, command.id]),
          from: predecessor.node.key, to: node.key, kind, label, sourceId: run.sourceId,
          sequences: [],
          detail: `Coordinator intent (${command.provenance}). Command ID: ${command.id}. ` +
            "요청 이력만 나타내며 Native의 수용·실행 성공이나 업무 완료를 의미하지 않습니다.",
        };
        nodeCopy.details.push({ label: "선행 Attempt", value: command.predecessorAttemptId });
        pendingEdges.push(edge);
      } else {
        nodeCopy.details.push({ label: "선행 Attempt 관측", value: `${command.predecessorAttemptId}는 같은 역할·업무 범위에서 관측되지 않았습니다. 실패한 의존성을 뜻하지 않습니다.` });
        incomplete = true;
      }
    }
    nodeCopies.set(node.key, nodeCopy);
  }

  const edges = [...clean.edges, ...pendingEdges.sort((a, b) => compare(a.key, b.key))];
  return { ...clean, nodes: clean.nodes.map((node) => nodeCopies.get(node.key) ?? node), edges, incomplete };
}

/** Group only validated decorated Runs, bounded to one exact role and Task scope. */
export function assistantAttemptFlowGroups(
  model: { nodes: MissionNode[]; edges: MissionEdge[] },
): FlowGroupDefinition[] {
  const candidates = decoratedCandidates(model.nodes);
  const rejected = conflictedRoleKeys(candidates);
  const roles = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const role = logicalRole(candidate.run.sourceId, candidate.attempt);
    if (rejected.has(role)) continue;
    const members = roles.get(role) ?? [];
    members.push(candidate);
    roles.set(role, members);
  }
  const groups: FlowGroupDefinition[] = [];
  for (const [role, members] of roles) {
    const scopes = new Set(members.map(({ run, attempt }) => attemptScope(run, attempt)));
    if (scopes.size !== 1) continue;
    const first = [...members].sort((a, b) => a.attempt.ordinal - b.attempt.ordinal || compare(a.node.key, b.node.key))[0]!;
    const key = flowGroupKey("assistant-role-attempts", role);
    groups.push({ key, kind: "assistant-role-attempts", basis: "native",
      sourceId: first.run.sourceId,
      label: `실행 시도 · ${first.node.label}`,
      memberKeys: [...new Set(members.map(({ node }) => node.key))].sort(compare),
      description: "같은 Native 출처·Assistant 실행·역할·Task 범위의 실제 Run입니다. Coordinator 기록에 보이는 제한된 이력이며 요청 의도는 Native 수용이나 업무 완료를 뜻하지 않습니다.",
    });
  }
  return groups.sort((a, b) => compare(a.key, b.key));
}

