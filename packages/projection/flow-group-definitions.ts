import { missionUnitKind, type MissionNode, type MissionEdge } from "./mission-flow.ts";
import { flowGroupKey, type FlowGroupDefinition } from "./flow-groups.ts";
import { assistantFlowGroups } from "./assistant-flow.ts";
import { assistantAttemptFlowGroups } from "./assistant-attempt-flow.ts";
import { sessionRelationGroups } from "./session-relations-flow.ts";
export { flowGroupKey } from "./flow-groups.ts";

export type FlowGroupBy = "project" | "task" | "session" | "run" | "none";
export interface TaskBundle { key: string; label: string; taskKeys: string[] }

/** Reveal membership ancestors, including a collapsed direct owner of a selected leaf. */
export function groupsForNodes(groups: FlowGroupDefinition[], keys: string[]): Set<string> {
  const byKey = new Map(groups.map(group => [group.key, group]));
  const owners = new Map(groups.flatMap(group => group.memberKeys.map(key => [key, group.key] as const)));
  const result = new Set<string>();
  for (const key of keys) {
    let current = owners.get(key);
    while (current && !result.has(current)) { result.add(current); current = byKey.get(current)?.parentKey; }
  }
  return result;
}

/** Derive containers only from explicit scope, membership and binding evidence. */
export function nativeFlowGroupDefinitions(model: { nodes: MissionNode[]; edges: MissionEdge[] }, by: FlowGroupBy): FlowGroupDefinition[] {
  if (by === "none") return [];
  const nodes = new Map(model.nodes.map(node => [node.key, node]));
  const groups = new Map<string, FlowGroupDefinition>();
  const groupFor = new Map<string, string>();
  const insert = (anchor: MissionNode, kind: string, basis: FlowGroupDefinition["basis"], description: string) => {
    const key = flowGroupKey(kind, anchor.key);
    const group: FlowGroupDefinition = { key, kind, label: `${kind === "task" ? "업무 실행" : kind === "session" ? "Session" : kind === "run" ? "Run" : kind === "invocation" ? "호출 범위" : kind === "invocation-reference" ? "호출 참조 범위" : kind === "cowork-member" ? "멤버 범위" : "협업 범위"} · ${anchor.label}`,
      sourceId: anchor.sourceId, basis, memberKeys: [anchor.key], description };
    groups.set(key, group); groupFor.set(anchor.key, key); return group;
  };
  const attachLeaf = (key: string, group: FlowGroupDefinition) => {
    const previous = groupFor.get(key);
    if (previous && previous !== group.key) {
      const previousGroup = groups.get(previous);
      if (previousGroup?.memberKeys.includes(key)) previousGroup.memberKeys = previousGroup.memberKeys.filter(member => member !== key);
    }
    if (!group.memberKeys.includes(key)) group.memberKeys.push(key);
    groupFor.set(key, group.key);
  };
  const attachEntity = (node: MissionNode, parent: FlowGroupDefinition) => {
    const own = groups.get(flowGroupKey(node.kind, node.key));
    if (own && own.key !== parent.key) own.parentKey = parent.key;
    else attachLeaf(node.key, parent);
  };
  const actualRuns = model.nodes.filter(node => node.kind === "run" && node.runKey);
  for (const run of actualRuns) {
    const owned = model.nodes.filter(node => node.runKey === run.runKey && node.sourceId === run.sourceId && !["task", "session", "workspace"].includes(node.kind));
    if (owned.length <= 1 && by !== "run") continue;
    const group = insert(run, "run", "native", "원본 Run ID와 해당 실행 범위의 관측. 호출·협업 멤버는 독립 Run이 아닙니다.");
    for (const node of owned) attachLeaf(node.key, group);
  }
  const invocations = model.nodes.filter(node => node.kind === "invocation" && node.runKey);
  for (const invocation of invocations) {
    const reference = missionUnitKind(invocation) === "invocation-reference";
    const group = insert(invocation, missionUnitKind(invocation), "native", reference
      ? "이 Run에서 기록된 호출 ID 참조입니다. 호출 생명주기나 부모 Run의 실제 실행을 관측한 결과가 아닙니다."
      : "명시된 호출 ID, 상위 호출과 도구·승인 참조로 묶은 실행 범위입니다.");
    const run = actualRuns.find(run => run.runKey === invocation.runKey && run.sourceId === invocation.sourceId);
    const runGroup = run ? groups.get(flowGroupKey("run", run.key)) : undefined;
    if (runGroup) { runGroup.memberKeys = runGroup.memberKeys.filter(key => key !== invocation.key); group.parentKey = runGroup.key; }
  }
  for (const invocation of invocations) {
    const group = groups.get(flowGroupKey(missionUnitKind(invocation), invocation.key))!;
    const parents = model.edges.filter(edge => edge.to === invocation.key && edge.kind === "invocation-parent")
      .map(edge => nodes.get(edge.from)).filter((node): node is MissionNode => !!node && node.kind === "invocation" &&
        node.sourceId === invocation.sourceId && node.runKey === invocation.runKey);
    if (new Set(parents.map(node => node.key)).size === 1) group.parentKey = flowGroupKey(missionUnitKind(parents[0]!), parents[0]!.key);
  }
  for (const node of model.nodes.filter(node => ["tool", "permission", "model-request"].includes(node.kind) && node.runKey)) {
    const owners = model.edges.filter(edge => edge.to === node.key && ["tool-of", "native-tool", "permission", "model-request"].includes(edge.kind))
      .map(edge => nodes.get(edge.from)).filter((owner): owner is MissionNode => !!owner && owner.kind === "invocation" &&
        owner.sourceId === node.sourceId && owner.runKey === node.runKey);
    if (new Set(owners.map(owner => owner.key)).size === 1) attachLeaf(node.key, groups.get(flowGroupKey(missionUnitKind(owners[0]!), owners[0]!.key))!);
  }
  for (const anchor of model.nodes.filter(node => node.kind === "group" && node.runKey)) {
    const group = insert(anchor, "cowork", "native", "원본 cowork 객체와 명시된 멤버 관계입니다. 화면 묶음·관리형 child Run·peer와 구별합니다.");
    const run = actualRuns.find(run => run.runKey === anchor.runKey && run.sourceId === anchor.sourceId);
    const runGroup = run ? groups.get(flowGroupKey("run", run.key)) : undefined;
    if (runGroup) { runGroup.memberKeys = runGroup.memberKeys.filter(key => key !== anchor.key); group.parentKey = runGroup.key; }
    const parents = model.edges.filter(edge => edge.to === anchor.key && edge.kind === "cowork")
      .map(edge => nodes.get(edge.from)).filter((node): node is MissionNode => !!node && node.kind === "invocation" &&
        node.sourceId === anchor.sourceId && node.runKey === anchor.runKey);
    if (new Set(parents.map(node => node.key)).size === 1) group.parentKey = flowGroupKey(missionUnitKind(parents[0]!), parents[0]!.key);
    for (const edge of model.edges.filter(edge => edge.from === anchor.key && edge.kind === "cowork")) {
      const member = nodes.get(edge.to);
      const owners = model.edges.filter(candidate => candidate.to === edge.to && candidate.kind === "cowork");
      if (member?.kind === "member" && member.runKey === anchor.runKey && member.sourceId === anchor.sourceId && owners.length === 1) attachLeaf(member.key, group);
    }
  }

  for (const member of model.nodes.filter(node => node.kind === "member" && node.runKey && node.coworkRef?.memberId)) {
    const invocationKeys = model.edges.filter(edge => edge.from === member.key && edge.kind === "cowork-invocation").map(edge => edge.to);
    const calls = invocations.filter(node => invocationKeys.includes(node.key) && node.runKey === member.runKey && node.sourceId === member.sourceId);
    if (!calls.length) continue;
    const owner = [...groups.values()].find(group => group.kind === "cowork" && group.memberKeys.includes(member.key));
    if (!owner) continue;
    const group = insert(member, "cowork-member", "native", "명시된 그룹·멤버·호출 ID로 연결된 멤버 실행 범위입니다. 재시도 호출은 독립 Run이 아닙니다.");
    owner.memberKeys = owner.memberKeys.filter(key => key !== member.key); group.parentKey = owner.key;
    for (const invocation of calls) {
      const parents = model.edges.filter(edge => edge.to === invocation.key && edge.kind === "cowork-invocation");
      if (new Set(parents.map(edge => edge.from)).size !== 1) continue;
      const child = groups.get(flowGroupKey(missionUnitKind(invocation), invocation.key));
      if (child) child.parentKey = group.key;
    }
  }

  for (const group of [...assistantFlowGroups(model), ...sessionRelationGroups(model)]) {
    groups.set(group.key, group);
    for (const key of group.memberKeys) groupFor.set(key, group.key);
  }
  if (by === "session") {
    for (const session of model.nodes.filter(node => node.kind === "session")) {
      const members = model.edges.filter(edge => edge.from === session.key && edge.kind === "ownership")
        .map(edge => nodes.get(edge.to)).filter((run): run is MissionNode => !!run && run.kind === "run" &&
          run.sourceId === session.sourceId && !!run.runKey);
      if (!members.length) continue;
      const group = insert(session, "session", "native", "동일 출처의 Session → Run 소속입니다. Task 연결·실행 의존을 뜻하지 않습니다.");
      for (const run of members) {
        const owners = model.edges.filter(edge => edge.to === run.key && edge.kind === "ownership" && nodes.get(edge.from)?.kind === "session");
        if (new Set(owners.map(edge => edge.from)).size === 1) attachEntity(run, group);
      }
    }
  } else if (by === "task" || by === "project") {
    for (const task of model.nodes.filter(node => node.kind === "task")) {
      const runs = model.edges.filter(edge => edge.from === task.key && ["task-binding", "assistant-task-binding"].includes(edge.kind))
        .map(edge => nodes.get(edge.to)).filter((run): run is MissionNode => !!run &&
          (run.kind === "run" && !!run.runKey || run.kind === "assistant-execution"));
      if (!runs.length) continue;
      const group = insert(task, "task", "binding", "같은 Task에 명시적으로 연결된 Run과 Assistant 실행입니다. 서로 다른 실행 단위이며 업무 완료·수용과 구분합니다.");
      for (const run of runs) {
        const owners = model.edges.filter(edge => edge.to === run.key && ["task-binding", "assistant-task-binding"].includes(edge.kind));
        if (new Set(owners.map(edge => edge.from)).size === 1) attachEntity(run, group);
      }
      for (const session of model.nodes.filter(node => node.kind === "session")) {
        const sessionRuns = model.edges.filter(edge => edge.from === session.key && edge.kind === "ownership" && nodes.get(edge.to)?.kind === "run");
        if (sessionRuns.length && sessionRuns.every(edge => runs.some(run => run.key === edge.to)) && sessionRuns.every(edge =>
          model.edges.filter(candidate => candidate.to === edge.to && candidate.kind === "task-binding").every(candidate => candidate.from === task.key))) attachLeaf(session.key, group);
      }
    }
  }
  if (by === "project") {
    for (const task of model.nodes.filter(node => node.kind === "task")) {
      const projectId = task.details.find(detail => ["Project ID", "프로젝트 ID"].includes(detail.label))?.value;
      if (!projectId) continue;
      const key = flowGroupKey("project", JSON.stringify([task.sourceId, projectId]));
      let project = groups.get(key);
      if (!project) {
        project = { key, kind: "project", label: `Project · ${projectId.slice(0, 8)}`, sourceId: task.sourceId,
          basis: "binding", memberKeys: [], description: "동일 원본 Project의 Task와 명시적 업무 연결 실행을 함께 표시합니다." };
        groups.set(key, project);
      }
      attachEntity(task, project);
    }
  }
  const attemptGroups = assistantAttemptFlowGroups(model);
  const roleScope = (ref: NonNullable<MissionNode["assistantAttemptRef"]>) => JSON.stringify([ref.assistantSourceId, ref.executionId, ref.roleId]);
  const counts = new Map<string, number>();
  const stableRoleOwners = new Map(model.nodes.filter(node => node.kind === "assistant-role")
    .map(node => [node.key, [...groups.values()].filter(group => group.memberKeys.includes(node.key))]));
  for (const attempt of attemptGroups) {
    const ref = nodes.get(attempt.memberKeys[0]!)?.assistantAttemptRef;
    if (ref) counts.set(roleScope(ref), (counts.get(roleScope(ref)) ?? 0) + 1);
  }
  for (const attemptGroup of attemptGroups) {
    const first = nodes.get(attemptGroup.memberKeys[0]!)?.assistantAttemptRef;
    if (!first) continue;
    const roles = model.nodes.filter(node => node.kind === "assistant-role" && node.sourceId === first.assistantSourceId &&
      node.id === first.roleId && node.assistantExecutionRef?.sourceId === first.assistantSourceId &&
      node.assistantExecutionRef.executionId === first.executionId);
    const role = roles.length === 1 ? roles[0] : undefined;
    const roleOwners = role ? stableRoleOwners.get(role.key) ?? [] : [];
    const childRuns = attemptGroup.memberKeys.map(key => groups.get(flowGroupKey("run", key)));
    const oldParents = new Set(childRuns.flatMap(group => group?.parentKey ? [group.parentKey] : []));
    const parentKey = roleOwners.length === 1 ? roleOwners[0]!.key : oldParents.size === 1 ? [...oldParents][0] : undefined;
    const group: FlowGroupDefinition = { ...attemptGroup, label: role ? `${role.label} · 실행 시도` : attemptGroup.label,
      memberKeys: [], ...(parentKey ? { parentKey } : {}) };
    if (role && roleOwners.length === 1 && counts.get(roleScope(first)) === 1) {
      roleOwners[0]!.memberKeys = roleOwners[0]!.memberKeys.filter(key => key !== role.key);
      group.memberKeys.push(role.key);
    }
    for (const [index, key] of attemptGroup.memberKeys.entries()) {
      const child = childRuns[index];
      if (child) child.parentKey = group.key;
      else {
        for (const owner of groups.values()) owner.memberKeys = owner.memberKeys.filter(member => member !== key);
        group.memberKeys.push(key);
      }
    }
    groups.set(group.key, group);
  }
  return [...groups.values()].map(group => ({ ...group, memberKeys: [...group.memberKeys].sort() })).sort((a, b) => a.key.localeCompare(b.key));
}

/** A user view bundle changes presentation only; any missing member removes its private label too. */
export function withTaskBundles(model: { nodes: MissionNode[] }, definitions: FlowGroupDefinition[], bundles: TaskBundle[]): FlowGroupDefinition[] {
  const output = definitions.map(group => ({ ...group, memberKeys: [...group.memberKeys] }));
  const tasks = new Set(model.nodes.filter(node => node.kind === "task").map(node => node.key));
  const claimed = new Set<string>();
  for (const bundle of bundles) {
    const members = [...new Set(bundle.taskKeys)];
    if (members.length < 2 || members.some(key => !tasks.has(key) || claimed.has(key))) continue;
    const children = members.map(key => output.find(group => group.kind === "task" && group.memberKeys.includes(key)));
    const parents = members.map((key, index) => children[index]?.parentKey ?? output.find(group => group.memberKeys.includes(key))?.key);
    const commonParent = parents[0] && parents.every(key => key === parents[0]) ? parents[0] : undefined;
    const group: FlowGroupDefinition = { key: bundle.key, kind: "task-bundle", basis: "view", label: bundle.label,
      sourceId: "visual-group", memberKeys: [], description: "사용자가 현재 화면에서 고른 업무 묶음입니다. 원본 업무·담당·의존성을 변경하지 않습니다.",
      ...(commonParent ? { parentKey: commonParent } : {}) };
    for (const [index, key] of members.entries()) {
      const child = children[index];
      for (const existing of output) existing.memberKeys = existing.memberKeys.filter(member => member !== key);
      if (child) { child.memberKeys.push(key); child.parentKey = group.key; }
      else group.memberKeys.push(key);
      claimed.add(key);
    }
    output.push(group);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (let index = output.length - 1; index >= 0; index--) {
      const group = output[index]!;
      if (!group.memberKeys.length && !output.some(child => child.parentKey === group.key)) { output.splice(index, 1); changed = true; }
    }
  }
  return output;
}
