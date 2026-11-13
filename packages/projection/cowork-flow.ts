import type { EventView, RunView } from "../contracts/index.ts";
import type { CoworkPlan } from "../contracts/cowork.ts";
import type { MissionFlow, MissionNode } from "./mission-flow.ts";
import { coworkMemberKey, missionEntityKey } from "./mission-identity.ts";

const order = (a: string, b: string) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const canonical = (plan: CoworkPlan) => JSON.stringify(plan.members.map(member =>
  [member.memberId, [...new Set(member.dependsOn)].sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

/** Explicit, current-source event metadata only. No names, time or scheduling joins. */
export function withCoworkFlow(base: MissionFlow, runs: RunView[], events: EventView[]): MissionFlow {
  const nodes = new Map(base.nodes.map(node => [node.key, { ...node, details: [...node.details], sequences: [...node.sequences] }]));
  const edges = new Map(base.edges.map(edge => [edge.key, { ...edge, sequences: [...edge.sequences] }]));
  let incomplete = base.incomplete;
  const detail = (node: MissionNode, label: string, value: string) => {
    if (!node.details.some(item => item.label === label && item.value === value)) node.details.push({ label, value });
  };
  for (const run of runs) {
    const root = nodes.get(missionEntityKey(run.sourceId, "run", run.runId));
    if (!root || root.runKey !== run.key) continue;
    const scoped = events.filter(event => event.sourceId === run.sourceId && event.runId === run.runId);
    const entity = (kind: "group" | "member", groupId: string, memberId?: string) => {
      const id = kind === "group" ? groupId : coworkMemberKey(groupId, memberId!);
      const key = missionEntityKey(run.sourceId, kind, id, run.runId);
      const node: MissionNode = nodes.get(key) ?? { key, kind, id, label: memberId ?? groupId, sourceId: run.sourceId,
        runKey: run.key, status: "observed-reference", description: "명시된 협업 계획의 참조; 실행 생명주기는 미관측", details: [], sequences: [] };
      node.coworkRef = { groupId, ...(memberId ? { memberId } : {}) };
      detail(node, "협업 그룹 ID", groupId); if (memberId) detail(node, "멤버 ID", memberId);
      nodes.set(key, node); return node;
    };
    const link = (from: MissionNode, to: MissionNode, kind: string, label: string, evidence: string, sequences: string[]) => {
      const key = JSON.stringify([run.sourceId, from.key, to.key, kind]), previous = edges.get(key);
      edges.set(key, { key, from: from.key, to: to.key, kind, label: previous?.label ?? label,
        detail: previous ? previous.detail : evidence, sourceId: run.sourceId,
        sequences: [...new Set([...(previous?.sequences ?? []), ...sequences])].sort(order) });
    };
    const plans = new Map<string, Array<{ event: EventView; plan: CoworkPlan }>>();
    const invalidGroups = new Set<string>();
    for (const event of scoped) {
      if (event.type !== "cowork.group.started" || !event.data.groupId) continue;
      if (event.data.coworkPlanIssue) {
        const group = entity("group", event.data.groupId);
        detail(group, "협업 계획", event.data.coworkPlanIssue === "unsupported" ? "원본 metadata 버전 미지원" : "원본 metadata 형식·소속·조회 한도 확인 필요");
        invalidGroups.add(event.data.groupId); incomplete = true;
      }
      if (!event.data.coworkPlan) continue;
      const values = plans.get(event.data.groupId) ?? [];
      values.push({ event, plan: event.data.coworkPlan }); plans.set(event.data.groupId, values);
    }
    for (const [groupId, values] of plans) {
      const group = entity("group", groupId);
      const declared = new Set(values.flatMap(value => value.plan.members.map(member => member.memberId)));
      if (scoped.some(event => event.type.startsWith("cowork.member.") && event.data.groupId === groupId &&
          event.data.memberId && !declared.has(event.data.memberId))) {
        invalidGroups.add(groupId);
        detail(group, "협업 계획", "계획 밖 멤버의 원본 이벤트 관측 · 계획과 실행 근거 불일치");
      }
      if (invalidGroups.has(groupId) || new Set(values.map(value => canonical(value.plan))).size !== 1) {
        detail(group, "협업 계획", "서로 다른 계획 근거 충돌 · 계획 관계 미표시"); incomplete = true; continue;
      }
      const sequences = values.map(value => value.event.sequence).sort(order);
      link(root, group, "event-reference", "협업 계획 근거", "이 Run의 명시된 협업 계획", sequences);
      const plan = values[0]!.plan;
      for (const member of plan.members) {
        const node = entity("member", groupId, member.memberId);
        detail(node, "계획 근거", sequences.join(", "));
        link(group, node, "cowork", "협업 멤버", "버전 1 계획의 명시 멤버 소속", sequences);
      }
      for (const member of plan.members) for (const prerequisite of new Set(member.dependsOn)) {
        link(entity("member", groupId, prerequisite), entity("member", groupId, member.memberId), "cowork-dependency",
          "멤버 선행", "원본 dependsOn · 선행 멤버 → 후속 멤버; 업무 수용과 별도", sequences);
      }
    }
    const memberships = new Map<string, EventView[]>();
    for (const event of scoped) {
      if (event.type !== "agent.invocation.started" || !event.data.invocationId || !event.data.groupId || !event.data.memberId) continue;
      const values = memberships.get(event.data.invocationId) ?? []; values.push(event); memberships.set(event.data.invocationId, values);
    }
    for (const [invocationId, evidence] of memberships) {
      const invocation = nodes.get(missionEntityKey(run.sourceId, "invocation", invocationId, run.runId));
      if (!invocation) continue;
      const refs = new Set(evidence.map(event => coworkMemberKey(event.data.groupId!, event.data.memberId!)));
      if (refs.size !== 1) { detail(invocation, "협업 소속", "서로 다른 그룹·멤버 참조 충돌 · 소속 연결 미표시"); incomplete = true; continue; }
      const { groupId, memberId } = evidence[0]!.data;
      const declared = plans.get(groupId!);
      if (declared?.length && declared.every(value => !value.plan.members.some(member => member.memberId === memberId))) {
        detail(invocation, "협업 소속", "계획에 없는 멤버 참조 · 소속 연결 미표시"); incomplete = true; continue;
      }
      const group = entity("group", groupId!), member = entity("member", groupId!, memberId!);
      invocation.coworkRef = { groupId: groupId!, memberId: memberId! };
      detail(invocation, "협업 그룹 ID", groupId!); detail(invocation, "멤버 ID", memberId!);
      const sequences = evidence.map(event => event.sequence);
      link(root, group, "event-reference", "협업 소속 근거", "이 Run의 명시된 협업 호출 소속", sequences);
      link(group, member, "cowork", "협업 멤버", "호출 시작 이벤트의 명시 그룹·멤버 ID", sequences);
      link(member, invocation, "cowork-invocation", "멤버 실행", "호출 시작 이벤트의 명시 groupId·memberId·invocationId", sequences);
    }
  }
  return { ...base, nodes: [...nodes.values()], edges: [...edges.values()], incomplete };
}
