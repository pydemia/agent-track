import { useContext, useState } from "react";
import type { RunView, SourceView } from "../../../packages/contracts/index.ts";
import type { MissionNode } from "../../../packages/projection/mission-flow.ts";
import { runWorkTitle } from "../../../packages/projection/work-content-flow.ts";
import { GroupWorkspaceContext } from "./group-workspace-context.ts";
import { useRunContent } from "./useRunContent.ts";
import { WorkContentPanel } from "./WorkContentPanel.tsx";
import { TaskContent } from "./TaskContent.tsx";

function RunReader({ actor, run, node, onUnauthorized }: { actor: string; run: RunView; node: MissionNode; onUnauthorized: (reason: string) => void }) {
  const read = useRunContent(actor, run, onUnauthorized);
  return <WorkContentPanel run={run} read={read} node={node} />;
}

export function RunWorkContent({ run }: { run: RunView }) {
  const context = useContext(GroupWorkspaceContext);
  if (!context?.actor || !context.onUnauthorized) return null;
  return <StandaloneRunReader key={JSON.stringify([context.actor, run.key])} actor={context.actor} run={run} onUnauthorized={context.onUnauthorized} />;
}
function StandaloneRunReader({ actor, run, onUnauthorized }: { actor: string; run: RunView; onUnauthorized: (reason: string) => void }) {
  const read = useRunContent(actor, run, onUnauthorized);
  return <WorkContentPanel run={run} read={read} />;
}

/** Only explicit Task/Execution/role/attempt membership is eligible; never a session-wide fallback. */
export function relatedContentRuns(node: MissionNode, runs: RunView[]): RunView[] {
  return runs.filter(run => {
    if (node.runKey) return run.key === node.runKey;
    if (node.assistantAttemptRef) return JSON.stringify(run.assistantAttempt) === JSON.stringify(node.assistantAttemptRef);
    if (node.taskRef) return run.binding?.projectSourceId === node.taskRef.sourceId && run.binding.projectId === node.taskRef.projectId && run.binding.taskId === node.taskRef.taskId;
    const execution = node.assistantExecutionRef, attempt = run.assistantAttempt;
    return !!execution && !!attempt && attempt.assistantSourceId === execution.sourceId && attempt.executionId === execution.executionId &&
      (node.kind !== "assistant-role" || attempt.roleId === node.id);
  }).sort((a, b) => (a.assistantAttempt?.ordinal ?? 0) - (b.assistantAttempt?.ordinal ?? 0) || a.key.localeCompare(b.key));
}

export function NodeWorkContent({ node, runs, sources }: { node: MissionNode; runs: RunView[]; sources?: SourceView[] }) {
  const context = useContext(GroupWorkspaceContext);
  const [selected, setSelected] = useState("");
  const eligible = relatedContentRuns(node, runs);
  const run = eligible.find(item => item.key === selected) ?? (eligible.length === 1 ? eligible[0] : undefined);
  if (!context?.actor || !context.onUnauthorized) return null;
  return <section aria-label="업무의 실행 시도 내용">
    {sources && node.taskRef && <TaskContent sources={sources} task={node.taskRef} title={node.label} onUnauthorized={context.onUnauthorized} autoOpen />}
    {eligible.length > 1 && <><h4>어떤 실행 시도를 읽을까요?</h4><div className="flow-neighbours">{eligible.map(item => <button type="button" className="flow-list-choice" key={item.key} aria-pressed={item.key === run?.key} onClick={() => setSelected(item.key)}>
      <strong>{runWorkTitle(item)}</strong><span>{item.assistantAttempt ? `시도 ${item.assistantAttempt.ordinal}` : "실행"} · {item.status}</span>
    </button>)}</div></>}
    {run ? <RunReader key={JSON.stringify([context.actor, node.key, run.key])} actor={context.actor} run={run} node={node} onUnauthorized={context.onUnauthorized} />
      : <p className="graph-legend">{eligible.length ? "시도를 선택하면 실행 당시 요청·응답·실패 원인을 여기서 읽을 수 있습니다." : "현재 조회 범위에 이 업무의 본문을 읽을 수 있는 실행 시도 연결이 없습니다."}</p>}
  </section>;
}
