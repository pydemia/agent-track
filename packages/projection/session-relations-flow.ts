import type { RunView } from "../contracts/index.ts";
import type { SessionRelation, SessionRelationsEvidence } from "../contracts/session-relations.ts";
import { missionEntityKey, missionFlow, type MissionFlow, type MissionNode, type MissionEdge } from "./mission-flow.ts";
import { flowGroupKey, type FlowGroupDefinition } from "./flow-groups.ts";

const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const edgeLabels: Record<string, string> = {
  "managed-child": "관리형 child 호출", "peer-processing": "peer 처리",
  "relation-evidence": "영수증 근거", reference: "문맥 참조", ownership: "소속 참조",
};
// Compare values rather than insertion order, including duplicate Run snapshots.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object") {
    return JSON.stringify(Object.entries(value).sort(([a], [b]) => compare(a, b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Project authorized local receipts; neither receipt status nor time is causality. */
export function withSessionRelations(
  model: MissionFlow, selected: RunView, runs: RunView[],
  evidence: SessionRelationsEvidence[],
): MissionFlow {
  const result = structuredClone(model);
  const scoped = evidence.filter(page => page.runKey === selected.key &&
    page.sourceId === selected.sourceId && page.sessionId === selected.sessionId);
  const nodes = new Map(result.nodes.map(node => [node.key, node]));
  const edges = new Map(result.edges.map(edge => [edge.key, edge]));
  const omitted = new Set<string>();
  // A receipt window is never a complete session history, even without a cursor.
  result.incomplete ||= scoped.length > 0;
  if (selected.sourceState !== "connected" || selected.stale) return result;
  const deniedKinds = new Set(scoped.filter(page => page.state !== "connected").map(page => page.kind));
  const receipts = new Map<string, Map<string, { row: SessionRelation; pages: SessionRelationsEvidence[] }>>();
  for (const page of scoped) {
    if (page.state !== "connected" || deniedKinds.has(page.kind)) continue;
    const kind = page.kind === "managed-children" ? "managed-child" : "peer-processing";
    if (page.coverage !== (kind === "managed-child" ? "managed-child-receipts" : "peer-processing-receipts")) continue;
    for (const row of page.relations) {
      if (row.sessionId !== selected.sessionId || row.kind !== kind) continue;
      const identity = JSON.stringify([page.sourceId, row.sessionId, row.kind, row.operationId]);
      const variants = receipts.get(identity) ?? new Map();
      const signature = canonical(row);
      const entry = variants.get(signature) ?? { row, pages: [] };
      entry.pages.push(page);
      variants.set(signature, entry); receipts.set(identity, variants);
    }
  }
  for (const [identity, variants] of [...receipts].sort(([a], [b]) => compare(a, b))) {
    // Contradictions are omitted in their entirety, independent of arrival order.
    if (variants.size !== 1) continue;
    const { row, pages } = variants.values().next().value!;
    const candidates = runs.filter(run => run.sourceId === selected.sourceId && run.runId === row.runId);
    if (!candidates.length || new Set(candidates.map(canonical)).size !== 1) continue;
    const target = candidates[0]!;
    if (target.sessionId !== row.sessionId || target.sourceState !== "connected" || target.stale) continue;
    const source = selected.sourceId;
    const runKey = missionEntityKey(source, "run", target.runId);
    const existing = nodes.get(runKey);
    // Never reinterpret an existing reference as an actual Run.
    if (existing && (existing.kind !== "run" || existing.runKey !== target.key)) continue;
    const actualRun = existing ?? missionFlow(target, [], [], [], { mode: "execution" }).nodes[0]!;
    const bundle: MissionNode[] = [actualRun];
    const links: MissionEdge[] = [];
    const reference = (kind: string, id: string, label: string, status = "observed-reference", owner?: RunView): MissionNode => {
      const node: MissionNode = { key: missionEntityKey(source, kind, id, owner?.runId),
        kind, id, label, status, sourceId: source, description: "세션 관계 receipt의 메타데이터 참조",
        ...(owner ? { runKey: owner.key } : {}), details: [{ label: "Source ID", value: source }, { label: "Session ID", value: row.sessionId }], sequences: [] };
      bundle.push(node); return node;
    };
    const link = (from: MissionNode, to: MissionNode, kind: string, detail: string): void => {
      links.push({ key: JSON.stringify([source, from.key, to.key, kind, ...(["reference", "ownership"].includes(kind) ? [] : [identity])]),
        from: from.key, to: to.key, kind, label: edgeLabels[kind] ?? kind, detail, sourceId: source, sequences: [] });
    };
    // Only reuse an observed base Session; execution-only views stay session-free.
    const session = result.nodes.find(node => node.kind === "session" &&
      node.sourceId === target.sourceId && node.id === target.sessionId && node.status === "observed");
    if (session && ![...edges.values()].some(edge => edge.from === session.key &&
      edge.to === actualRun.key && edge.kind === "ownership")) {
      link(session, actualRun, "ownership", "현재 RunView.sessionId에 명시된 세션 소속");
    }
    const receipt = reference("session-relation-receipt", identity, `영수증 · ${row.operationId}`);
    receipt.description = "원본 처리 영수증의 ID와 조회 당시 Run 상태입니다. 업무 수용·검증 결과와 별도입니다.";
    receipt.details = [
      { label: "Source ID", value: source },
      { label: "Operation ID", value: row.operationId },
      { label: "Receipt status", value: row.status },
      { label: "Session ID", value: row.sessionId },
      { label: "Run ID", value: row.runId },
      ...[...new Set(pages.map(page => page.detail))].sort(compare).map(value => ({ label: "Receipt detail", value })),
      ...[...new Set(pages.map(page => page.observedAt))].sort(compare).map(value => ({ label: "Receipt observed at", value })),
    ];
    const receiptDetail = receipt.details.map(item => `${item.label}: ${item.value}`).join("\n");
    if (row.kind === "managed-child") {
      const parent = reference("managed-parent-reference", JSON.stringify([row.sessionId, row.parentInvocationId]),
        `부모 호출 참조 ${row.parentInvocationId}`, "unknown");
      parent.details = [{ label: "Source ID", value: source }, { label: "Session ID", value: row.sessionId },
        { label: "Parent invocation ID", value: row.parentInvocationId }, { label: "Parent Run ID", value: "unknown" }];
      parent.description = "원본에 부모 Run ID가 없어 특정 Run의 호출과 합치지 않은 참조입니다.";
      const child = reference("invocation", row.childInvocationId, `호출 ${row.childInvocationId}`, "observed-reference", target);
      child.details.push({ label: "Run ID", value: row.runId }, { label: "Child invocation ID", value: row.childInvocationId });
      link(parent, child, "managed-child", receiptDetail);
      link(actualRun, child, "ownership", "명시된 child Run의 invocation 참조; 생명주기 미관측");
      link(receipt, child, "relation-evidence", receiptDetail);
    } else {
      const connection = reference("peer-connection", JSON.stringify([row.sessionId, row.connectionId]), `연결 ${row.connectionId}`);
      const conversation = reference("peer-conversation", JSON.stringify([row.sessionId, row.connectionId, row.conversationId]), `대화 ${row.conversationId}`);
      const message = reference("peer-message", JSON.stringify([row.sessionId, row.connectionId, row.conversationId, row.messageId]), `메시지 ${row.messageId}`);
      connection.description = "로컬 처리 connection 참조입니다. 원격 Session이나 전체 peer 목록을 뜻하지 않습니다.";
      conversation.description = "같은 로컬 connection의 처리 대화 참조입니다. 대화 원문은 수집하지 않습니다.";
      message.description = "처리된 메시지의 식별자 참조입니다. 메시지 본문은 수집하지 않습니다.";
      connection.details.push({ label: "Connection ID", value: row.connectionId });
      conversation.details.push({ label: "Connection ID", value: row.connectionId }, { label: "Conversation ID", value: row.conversationId });
      message.details.push({ label: "Connection ID", value: row.connectionId }, { label: "Conversation ID", value: row.conversationId }, { label: "Message ID", value: row.messageId });
      link(connection, conversation, "reference", "로컬 처리 대화 문맥");
      link(conversation, message, "reference", "로컬 처리 메시지 문맥");
      link(message, actualRun, "peer-processing", receiptDetail);
      link(receipt, message, "relation-evidence", receiptDetail);
    }
    const additions = bundle.filter(node => !nodes.has(node.key));
    // Admit complete receipt bundles so the cap cannot leave misleading fragments.
    // An already oversized base is preserved; this projection never grows it.
    if (nodes.size + additions.length > 240) {
      for (const node of additions) omitted.add(node.key);
      continue;
    }
    for (const node of additions) { nodes.set(node.key, node); omitted.delete(node.key); }
    for (const edge of links) if (!edges.has(edge.key)) edges.set(edge.key, edge);
  }
  const baseKeys = new Set(result.nodes.map(node => node.key));
  result.nodes.push(...[...nodes.values()].filter(node => !baseKeys.has(node.key)).sort((a, b) => compare(a.key, b.key)));
  const baseEdges = new Set(result.edges.map(edge => edge.key));
  result.edges.push(...[...edges.values()].filter(edge => !baseEdges.has(edge.key)).sort((a, b) => compare(a.key, b.key)));
  result.edges = result.edges.filter(edge => nodes.has(edge.from) && nodes.has(edge.to));
  result.hiddenNodes += omitted.size;
  return result;
}

/** Local processing context groups never contain the actual processing Runs. */
export function sessionRelationGroups(model: { nodes: MissionNode[]; edges: MissionEdge[] }): FlowGroupDefinition[] {
  const nodes = new Map(model.nodes.map(node => [node.key, node]));
  const groups: FlowGroupDefinition[] = [];
  const childNodes = (parent: MissionNode, kind: string) => model.edges.filter(edge => edge.from === parent.key && edge.kind === "reference" && edge.sourceId === parent.sourceId)
    .map(edge => nodes.get(edge.to)).filter((node): node is MissionNode => !!node && node.kind === kind && node.sourceId === parent.sourceId &&
      new Set(model.edges.filter(edge => edge.to === node.key && edge.kind === "reference").map(edge => edge.from)).size === 1);
  for (const connection of model.nodes.filter(node => node.kind === "peer-connection")) {
    const parent: FlowGroupDefinition = { key: flowGroupKey("peer-connection-context", connection.key), kind: "peer-connection-context",
      label: `peer 처리 연결 · ${connection.label}`, sourceId: connection.sourceId, basis: "native", memberKeys: [connection.key],
      description: "처리 영수증의 로컬 connection 참조입니다. 전체 원격 peer나 원격 Session을 발견한 결과가 아닙니다." };
    for (const conversation of childNodes(connection, "peer-conversation")) {
      const messages = childNodes(conversation, "peer-message");
      const messageKeys = new Set(messages.map(node => node.key));
      const receipts = model.nodes.filter(node => node.kind === "session-relation-receipt" && node.sourceId === connection.sourceId &&
        model.edges.some(edge => edge.from === node.key && edge.kind === "relation-evidence" && messageKeys.has(edge.to)) &&
        model.edges.filter(edge => edge.from === node.key && edge.kind === "relation-evidence").length === 1);
      groups.push({ key: flowGroupKey("peer-conversation-context", conversation.key), kind: "peer-conversation-context",
        label: `peer 처리 대화 · ${conversation.label}`, sourceId: conversation.sourceId, basis: "native", parentKey: parent.key,
        memberKeys: [conversation.key, ...messages.map(node => node.key), ...receipts.map(node => node.key)],
        description: "같은 로컬 connection·conversation tuple의 처리 메시지·영수증입니다. 실제 Run은 바깥에 두고 처리 관계로 연결합니다." });
    }
    groups.push(parent);
  }
  return groups.sort((a, b) => compare(a.key, b.key));
}
