import type { MissionNode, MissionEdge } from "./mission-flow.ts";
import type { FlowGroupDefinition } from "./flow-groups.ts";

export type FlowGroupBy = "project" | "task" | "session" | "run" | "none";
export interface TaskBundle { key: string; label: string; taskKeys: string[] }
export const flowGroupKey = (kind: string, key: string) => JSON.stringify(["flow-container", kind, key]);

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
    const group: FlowGroupDefinition = { key, kind, label: `${kind === "task" ? "업무 실행" : kind === "session" ? "Session" : kind === "run" ? "Run" : kind === "invocation" ? "호출 범위" : "협업 범위"} · ${anchor.label}`,
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
    const group = insert(invocation, "invocation", "native", "명시된 호출 ID, 상위 호출과 도구·승인 참조로 묶은 실행 범위입니다.");
    const run = actualRuns.find(run => run.runKey === invocation.runKey && run.sourceId === invocation.sourceId);
    const runGroup = run ? groups.get(flowGroupKey("run", run.key)) : undefined;
    if (runGroup) { runGroup.memberKeys = runGroup.memberKeys.filter(key => key !== invocation.key); group.parentKey = runGroup.key; }
  }
  for (const invocation of invocations) {
    const group = groups.get(flowGroupKey("invocation", invocation.key))!;
    const parents = model.edges.filter(edge => edge.to === invocation.key && edge.kind === "invocation-parent")
      .map(edge => nodes.get(edge.from)).filter((node): node is MissionNode => !!node && node.kind === "invocation" &&
        node.sourceId === invocation.sourceId && node.runKey === invocation.runKey);
    if (new Set(parents.map(node => node.key)).size === 1) group.parentKey = flowGroupKey("invocation", parents[0]!.key);
  }
  for (const node of model.nodes.filter(node => ["tool", "permission"].includes(node.kind) && node.runKey)) {
    const owners = model.edges.filter(edge => edge.to === node.key && ["tool-of", "native-tool", "permission"].includes(edge.kind))
      .map(edge => nodes.get(edge.from)).filter((owner): owner is MissionNode => !!owner && owner.kind === "invocation" &&
        owner.sourceId === node.sourceId && owner.runKey === node.runKey);
    if (new Set(owners.map(owner => owner.key)).size === 1) attachLeaf(node.key, groups.get(flowGroupKey("invocation", owners[0]!.key))!);
  }
  for (const anchor of model.nodes.filter(node => node.kind === "group" && node.runKey)) {
    const group = insert(anchor, "cowork", "native", "원본 cowork 객체와 명시된 멤버 관계입니다. 화면 묶음·관리형 child Run·peer와 구별합니다.");
    const run = actualRuns.find(run => run.runKey === anchor.runKey && run.sourceId === anchor.sourceId);
    const runGroup = run ? groups.get(flowGroupKey("run", run.key)) : undefined;
    if (runGroup) { runGroup.memberKeys = runGroup.memberKeys.filter(key => key !== anchor.key); group.parentKey = runGroup.key; }
    for (const edge of model.edges.filter(edge => edge.from === anchor.key && edge.kind === "cowork")) {
      const member = nodes.get(edge.to);
      const owners = model.edges.filter(candidate => candidate.to === edge.to && candidate.kind === "cowork");
      if (member?.kind === "member" && member.runKey === anchor.runKey && member.sourceId === anchor.sourceId && owners.length === 1) attachLeaf(member.key, group);
    }
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
      const runs = model.edges.filter(edge => edge.from === task.key && edge.kind === "task-binding")
        .map(edge => nodes.get(edge.to)).filter((run): run is MissionNode => !!run && run.kind === "run" && !!run.runKey);
      if (!runs.length) continue;
      const group = insert(task, "task", "binding", "원본 Task와 명시적으로 연결된 고유 Run입니다. Run 종료와 업무 수용을 구분합니다.");
      for (const run of runs) {
        const owners = model.edges.filter(edge => edge.to === run.key && edge.kind === "task-binding");
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
