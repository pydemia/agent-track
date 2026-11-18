import type { SourceView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView } from "../../../packages/contracts/assistant-view.ts";

/** Registered UI origin only; native service credentials never enter a URL. */
export function assistantExecutionOrigin(sources: readonly SourceView[], execution: AssistantExecutionView): string | null {
  const matches = sources.filter(source => source.id === execution.sourceId);
  const source = matches.length === 1 ? matches[0] : undefined;
  if (source?.kind !== "assistant" || source.state !== "connected" || !source.uiBaseUrl ||
      source.uiBaseUrl.trim() !== source.uiBaseUrl || source.uiBaseUrl.length > 2000) return null;
  if (execution.currentTask) {
    const task = execution.currentTask;
    const projects = sources.filter(item => item.id === task.projectsSourceId);
    if (projects.length !== 1 || projects[0]?.kind !== "projects" || projects[0].state !== "connected" ||
        !projects[0].authorizedProjectIds?.includes(task.project.id)) return null;
  }
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  if (!uuid.test(execution.native.id) || !uuid.test(execution.native.instructionId)) return null;
  try {
    const url = new URL(source.uiBaseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    url.hash = `workbench/projects/${execution.native.instructionId}/executions/${execution.native.id}`;
    return url.href;
  } catch { return null; }
}

/** A code is a producer's classification, not the detailed underlying cause. */
export function executionFailureMessage(code: string | null): string {
  switch (code) {
    case "deployment_execution_failed": return "런타임 실행 실패가 보고되었습니다. 세부 오류와 대화는 원본 실행에서 확인하세요.";
    case "deployment_execution_cancelled": return "런타임 실행이 취소되었습니다.";
    case "runtime_task_failed": return "Runtime Task 실패가 보고되었습니다. 상세 원인은 원본 실행에서 확인하세요.";
    default: return code ? "원본에서 오류가 보고되었습니다. 아래 코드는 원본의 분류이며 상세 원인을 뜻하지 않습니다." : "상세 오류 메시지는 현재 Track 읽기 계약에 포함되어 있지 않습니다. 원본 실행에서 확인하세요.";
  }
}
