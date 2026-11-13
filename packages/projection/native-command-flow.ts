import type { RunView } from "../contracts/index.ts";
import { nativeCommandLinkSchema, type NativeCommandObservation } from "../contracts/native-command-observation.ts";
import type { MissionNode, MissionEdge } from "./mission-flow.ts";

const identity = (run: RunView) => JSON.stringify([run.sourceId, run.runId]);
const commandIdentity = (run: RunView, receipt: NativeCommandObservation) => JSON.stringify([run.sourceId, run.sessionId, receipt.commandId]);
const edgeKinds = new Set(["native-command-retry", "native-command-resume", "native-command-continue"]);
const detailLabels = new Set(["원본 명령 ID", "원본 명령 종류", "원본 접수 시각", "선행 Run", "원본 논리 root",
  "후속 관계 근거", "접수 의미", "후속 관계 조회"]);
const readable = (run: RunView) => run.sourceState === "connected" && !run.stale &&
  (!run.binding || run.binding.sourceId === run.sourceId && run.binding.runId === run.runId);

/** Current, unambiguous endpoints only. Task binding is not inferred from an edge. */
export function nativeCommandPairs(runs: RunView[]): Array<{ from: RunView; to: RunView; receipt: NativeCommandObservation }> {
  const unique = (run: RunView) => runs.filter(candidate => candidate.key === run.key || identity(candidate) === identity(run)).length === 1;
  const candidates = runs.flatMap(run => {
    const link = nativeCommandLinkSchema.safeParse(run.nativeCommandLink);
    return unique(run) && readable(run) && link.success && link.data.state === "observed" &&
      link.data.receipt.targetRunId === run.runId && link.data.receipt.sessionId === run.sessionId ? [{ run, receipt: link.data.receipt }] : [];
  });
  return candidates.flatMap(({ run, receipt }) => {
    if (candidates.filter(candidate => commandIdentity(candidate.run, candidate.receipt) === commandIdentity(run, receipt)).length !== 1) return [];
    const parents = runs.filter(parent => parent.sourceId === run.sourceId && parent.runId === receipt.sourceRunId);
    const from = parents.length === 1 ? parents[0] : undefined;
    if (!from || !unique(from) || !readable(from) || from.sessionId !== run.sessionId || from.workspaceId !== run.workspaceId) return [];
    const root = runs.find(root => root.sourceId === run.sourceId && root.runId === receipt.rootRunId && root.sessionId === run.sessionId &&
      root.workspaceId === run.workspaceId && unique(root) && readable(root));
    return [{ from, to: run, receipt: { ...receipt, rootRunId: root?.runId ?? null } }];
  }).sort((a, b) => commandIdentity(a.to, a.receipt).localeCompare(commandIdentity(b.to, b.receipt)));
}

/** Native receipt admission remains distinct from coordinator intent and Run success. */
export function withNativeCommandFlow<T extends { nodes: MissionNode[]; edges: MissionEdge[]; incomplete: boolean }>(base: T, runs: RunView[]): T {
  const hadDerived = base.edges.some(edge => edgeKinds.has(edge.kind)) || base.nodes.some(node => node.nativeCommandRef);
  if (!hadDerived && !runs.some(run => run.nativeCommandLink)) return base;
  const nodes = base.nodes.map(node => {
    if (!node.nativeCommandRef && !node.details.some(detail => detail.label === "후속 관계 조회")) return node;
    const { nativeCommandRef: _ref, ...rest } = node;
    return { ...rest, details: node.details.filter(detail => !detailLabels.has(detail.label)) };
  });
  const edges = hadDerived ? base.edges.filter(edge => !edgeKinds.has(edge.kind)) : [...base.edges];
  const pairs = nativeCommandPairs(runs);
  let incomplete = base.incomplete;
  const actual = (run: RunView) => nodes.filter(node => node.kind === "run" && node.runKey === run.key &&
    node.id === run.runId && node.sourceId === run.sourceId && node.status !== "unobserved");
  const output = nodes.map(node => {
    if (node.kind !== "run" || !node.runKey || node.status === "unobserved") return node;
    const matching = runs.filter(run => run.key === node.runKey && run.sourceId === node.sourceId && run.runId === node.id);
    const run = matching.length === 1 ? matching[0] : undefined;
    if (!run?.nativeCommandLink) return node;
    const pair = pairs.find(pair => pair.to.key === run.key);
    if (!pair || actual(pair.to).length !== 1) {
      incomplete = true;
      return { ...node, details: [...node.details, { label: "후속 관계 조회", value: "현재 인가된 전후 Run과 원본 접수 근거를 함께 확인하지 못했습니다." }] };
    }
    const receipt = pair.receipt;
    const name = receipt.kind === "retry" ? "재시도 접수" : receipt.kind === "resume" ? "재개 접수" : "새 입력 접수";
    const details = [...node.details, { label: "원본 명령 ID", value: receipt.commandId }, { label: "원본 명령 종류", value: receipt.kind },
      { label: "원본 접수 시각", value: receipt.acceptedAt }, { label: "선행 Run", value: receipt.sourceRunId },
      { label: "원본 논리 root", value: receipt.rootRunId ?? "현재 인가된 범위에서 미확인" },
      { label: "후속 관계 근거", value: `${receipt.provenance} · ${receipt.relation}` },
      { label: "접수 의미", value: "원본 명령 접수만 확인한 상태입니다. Run 성공·Projects 수용은 별도입니다." }];
    const parent = actual(pair.from);
    if (parent.length === 1) edges.push({ key: JSON.stringify([run.sourceId, "native-command", run.sessionId, receipt.commandId]),
      sourceId: run.sourceId, from: parent[0]!.key, to: node.key, kind: `native-command-${receipt.kind}`, label: name, sequences: [],
      detail: `명령 ${receipt.commandId} · ${receipt.provenance} · ${receipt.relation}\n${receipt.sourceRunId} → ${receipt.targetRunId}\n원본 접수 ${receipt.acceptedAt}. 실행 성공·업무 수용은 별도이며 Task 선행 의존성을 뜻하지 않습니다.` });
    else { details.push({ label: "후속 관계 조회", value: "선행 Run은 현재 보기 범위 밖입니다. 해당 Run의 단계는 그 실행에서 확인해 주세요." }); incomplete = true; }
    if (!receipt.rootRunId) incomplete = true;
    return { ...node, nativeCommandRef: receipt, details };
  });
  return { ...base, nodes: output, edges: edges.sort((a, b) => a.key.localeCompare(b.key)), incomplete };
}
