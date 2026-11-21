import type { ConversationEntry, RunConversationView } from "../contracts/conversation.ts";
import type { RunView } from "../contracts/index.ts";
import type { MissionFlow, MissionNode } from "./mission-flow.ts";
import { readableTitle } from "./work-content-flow.ts";
import type { FlowGroupSummary } from "./flow-groups.ts";

export function conversationMatches(entry: ConversationEntry, node?: Pick<MissionNode, "kind" | "id" | "callId" | "invocationId">): boolean {
  if (node?.kind === "tool") return !!node.callId && entry.callId === node.callId &&
    (node.invocationId ? entry.observation?.invocationId === node.invocationId : entry.observation === null);
  if (node?.kind === "invocation") return entry.observation?.invocationId === node.id;
  return true;
}

export function originalToolInput(entries: ConversationEntry[]): Record<string, unknown> | null {
  // Never combine incomplete chunks or different calls into one inferred request.
  const requests = entries.filter(entry => entry.kind === "tool-call" && entry.contentSource === "original" && entry.offset === 0 && entry.end === entry.total);
  if (requests.length !== 1) return null;
  try {
    const input: unknown = JSON.parse(requests[0]!.text);
    return input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  } catch { return null; }
}

export function toolWorkTitle(tool: string | null, entries: ConversationEntry[], fallback = "도구 호출"): string {
  const input = originalToolInput(entries);
  const path = typeof input?.path === "string" ? input.path.replace(/\\/g, "/").split("/").at(-1) : undefined;
  if (tool === "read_file" && path) return `문서 읽기 · ${path.slice(0, 100)}`;
  if (tool === "delegate_agent") return typeof input?.agent === "string" ? `검토 위임 · ${input.agent.slice(0, 80)}` : "하위 Agent에 작업 위임";
  return tool || fallback;
}

/** Display projection only; original event payload, identifiers and states stay intact. */
export function withConversationLabels(base: MissionFlow, run: RunView, view: RunConversationView | null): MissionFlow {
  const page = view?.state === "connected" && view.runKey === run.key && view.sourceId === run.sourceId &&
    view.runId === run.runId && view.sessionId === run.sessionId && view.page?.run.workspaceId === run.workspaceId ? view.page : null;
  const entries = page?.entries ?? [];
  return { ...base, nodes: base.nodes.map(node => {
    if (node.runKey !== run.key || node.sourceId !== run.sourceId) return node;
    if (node.kind === "invocation") {
      const scoped = entries.filter(entry => conversationMatches(entry, node));
      const names = new Set(scoped.flatMap(entry => entry.observation?.agent ? [entry.observation.agent] : []));
      const agent = names.size === 1 ? [...names][0] : undefined;
      return { ...node, label: agent || "Agent · 이름 미제공", description: agent ? `${agent}에 귀속된 작업과 대화` : "호출 식별자는 근거에서 확인할 수 있습니다." };
    }
    if (node.kind === "tool") {
      const scoped = entries.filter(entry => conversationMatches(entry, node));
      const names = new Set(scoped.flatMap(entry => entry.tool ? [entry.tool] : []));
      const tool = names.size === 1 ? [...names][0]! : node.details.find(item => item.label === "도구")?.value ?? node.label;
      const input = originalToolInput(scoped);
      return { ...node, label: toolWorkTitle(tool, scoped, "도구 · 이름 미제공"),
        ...(typeof input?.task === "string" ? { description: readableTitle(input.task, "위임한 작업", 150) }
          : typeof input?.path === "string" ? { description: input.path.slice(0, 180) } : {}) };
    }
    return node;
  }) };
}

/** Map expresses organization; Trace retains execution. No synthetic dependency edges. */
export function readingFlow(base: MissionFlow, mode: "mission" | "execution", technical: boolean): MissionFlow {
  if (technical) return base;
  const technicalKinds = new Set(["model-request", "native-turn", "native-item", "event", "lifecycle", "session-relation-receipt"]);
  const executionKinds = new Set(["tool", "permission", "work-request", "work-step", "work-response", "work-failure"]);
  const nodes = base.nodes.filter(node => !technicalKinds.has(node.kind) && (mode === "execution" || !executionKinds.has(node.kind)));
  const keys = new Set(nodes.map(node => node.key));
  return { ...base, nodes, edges: base.edges.filter(edge => keys.has(edge.from) && keys.has(edge.to)) };
}

/** Internal navigation renders only the current bundle. Boundary evidence stays in the inspector. */
export function focusedFlow<T extends { key: string }, E extends { from: string; to: string }>(nodes: T[], edges: E[],
  parents: ReadonlyMap<string, string>, groups: FlowGroupSummary[], focus: string | null, targets: string[] = []): { nodes: T[]; edges: E[] } {
  if (!focus) return { nodes, edges };
  const byKey = new Map(groups.map(group => [group.key, group]));
  const group = byKey.get(focus);
  if (!group) return { nodes, edges };
  const inside = (key: string) => {
    const seen = new Set<string>();
    for (let current: string | undefined = key; current && !seen.has(current); current = parents.get(current) ?? byKey.get(current)?.parentKey) {
      if (current === focus) return true;
      seen.add(current);
    }
    return false;
  };
  // A boundary-edge reveal must retain both original endpoints instead of hiding one.
  if (targets.some(key => !inside(key))) return { nodes, edges };
  const visible = nodes.filter(node => inside(node.key)), keys = new Set(visible.map(node => node.key));
  return { nodes: visible, edges: edges.filter(edge => keys.has(edge.from) && keys.has(edge.to)) };
}
