import type { WorkContent } from "../contracts/work-content.ts";
import type { RunView } from "../contracts/index.ts";
import type { MissionFlow, MissionNode } from "./mission-flow.ts";

export function readableTitle(text: string, fallback: string, limit = 86): string {
  return text.split(/\r?\n/).map(line => line.replace(/^\s*(?:#{1,6}|[-*>])\s*/, "").trim()).find(line => line)?.slice(0, limit) || fallback;
}
export function runWorkTitle(run: RunView): string {
  return run.binding?.taskTitle || (run.title && !/^[0-9a-f-]{20,}$/i.test(run.title) ? run.title : "내용을 확인할 업무 실행");
}

/** Request/result edges are exact; reported plan order never becomes a dependency. */
export function withWorkContent(base: MissionFlow, run: RunView, content: WorkContent | null): MissionFlow {
  if (!content) return base;
  const root = base.nodes.find(node => node.kind === "run" && node.runKey === run.key);
  if (!root) return base;
  const nodes = base.nodes.map(node => node.key === root.key ? { ...node,
    label: `${run.assistantAttempt ? `시도 ${run.assistantAttempt.ordinal} · ` : ""}${run.binding?.taskTitle || content.title}`,
    description: content.purpose ? readableTitle(content.purpose.text, "업무 요청", 150) : "선택한 업무 실행" } : node);
  const edges = [...base.edges];
  const add = (kind: string, id: string, label: string, description: string, status: string): MissionNode => {
    const node: MissionNode = { key: JSON.stringify(["work-content", run.key, kind, id]), kind, id, sourceId: run.sourceId,
      runKey: run.key, label, description, status, details: [], sequences: [] };
    nodes.push(node); return node;
  };
  const edge = (from: MissionNode, to: MissionNode, kind: string, label: string, detail: string) => edges.push({
    key: JSON.stringify(["work-content", from.key, to.key, kind]), sourceId: run.sourceId, from: from.key, to: to.key, kind, label, detail, sequences: [] });
  if (content.purpose) {
    const request = add("work-request", "request", readableTitle(content.purpose.text, "업무 목적·요청"), "왜 이 작업을 요청했는지 확인", "observed");
    edge(request, root, "work-request", "업무 요청", "이 실행 시도에 고정된 원본 요청입니다.");
  }
  let previous: MissionNode | null = null;
  for (const step of content.steps.slice(0, 40)) {
    const node = add("work-step", step.id, step.title, step.detail ? readableTitle(step.detail.text, "보고된 수행 작업", 150) : "원본에서 보고한 세부 작업", step.status);
    edge(root, node, "work-plan", "수행 작업", "원본 역할 또는 계획의 명시된 작업입니다. 업무 수용을 뜻하지 않습니다.");
    if (previous && content.coverage === "local-session-turn") edge(previous, node, "reported-order", "계획 순서", "보고된 계획의 나열 순서입니다. 선행 의존 관계로 해석하지 않습니다.");
    previous = node;
  }
  if (content.result) {
    const result = add("work-response", "response", readableTitle(content.result.text, "작업 결과·응답"), "실제 응답을 Track에서 읽기", "observed");
    edge(root, result, "work-response", "응답", "이 실행 시도에서 읽은 실제 응답입니다. 다른 시도의 결과를 붙이지 않습니다.");
  }
  if (content.failure) {
    const failure = add("work-failure", "failure", content.failure.message ? readableTitle(content.failure.message.text, "실패 원인") : `실패 · ${content.failure.code}`, content.failure.code, "failed");
    edge(root, failure, "work-failure", "실패 원인", "원본 실행이 제공한 오류입니다. 코드만 있는 경우 상세 원인을 추정하지 않습니다.");
  }
  return { ...base, nodes, edges, incomplete: base.incomplete || content.incomplete || content.steps.length > 40 };
}
