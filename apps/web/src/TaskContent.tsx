import { useEffect, useState } from "react";
import type { SourceView } from "../../../packages/contracts/index.ts";
import { ProjectsTaskLink } from "./ProjectsTaskLink.tsx";
import type { ProjectTaskRef } from "./project-task-origin.ts";
import { fetchTaskContent, type TaskContent as Content } from "./task-content-client.ts";
import { PrivateReadError } from "./private-json.ts";
import "./task-content.css";

export function TaskContent({ sources, task, title, revision, onUnauthorized, autoOpen = false }: {
  sources: SourceView[]; task: ProjectTaskRef; title?: string; revision?: string;
  onUnauthorized: (reason: string) => void;
  autoOpen?: boolean;
}) {
  const matches = sources.filter(source => source.id === task.sourceId);
  const source = matches.length === 1 ? matches[0] : undefined;
  const allowed = source?.kind === "projects" && source.state === "connected" && source.authorizedProjectIds?.includes(task.projectId);
  const stamp = JSON.stringify([task, revision, source?.id, source?.state, source?.authorizedProjectIds, source?.uiBaseUrl]);
  return <section className="task-content" aria-label="연결된 업무 내용">
    <strong>{title || "연결된 Projects 업무"}</strong>
    <ProjectsTaskLink sources={sources} task={task} />
    {allowed ? <TaskContentRead key={stamp} task={task} onUnauthorized={onUnauthorized} autoOpen={autoOpen} />
      : <p className="graph-legend">현재 원본 업무 접근을 확인할 수 없어 설명을 표시하지 않습니다.</p>}
  </section>;
}

function TaskContentRead({ task, onUnauthorized, autoOpen }: { task: ProjectTaskRef; onUnauthorized: (reason: string) => void; autoOpen: boolean }) {
  const [open, setOpen] = useState(autoOpen), [retry, setRetry] = useState(0);
  const [content, setContent] = useState<Content | null>(null), [error, setError] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      setContent(null); setError(false); setBusy(true);
      try {
        const value = await fetchTaskContent(task, controller.signal);
        if (!controller.signal.aborted) setContent(value);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setContent(null); setError(true);
          if (reason instanceof PrivateReadError && reason.kind === "unauthorized") onUnauthorized("로그인이 만료되어 업무 본문을 지웠습니다.");
        }
      } finally {
        if (!controller.signal.aborted) { setBusy(false); timer = setTimeout(() => void load(), 15_000); }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, retry, task.sourceId, task.projectId, task.taskId, onUnauthorized]);
  return <>
    <button type="button" className="text-button" aria-expanded={open} onClick={() => { setContent(null); setError(false); setOpen(value => !value); }}>{open ? "업무 내용 닫기" : "업무 설명·수용 기준 보기"}</button>
    {open && <div className="task-content-body">
      {busy && <p role="status">현재 원본 업무를 읽는 중…</p>}
      {error && <p role="alert">원본 내용을 확인하지 못했습니다. 이전 본문은 지웠습니다. <button type="button" onClick={() => setRetry(value => value + 1)}>다시 조회</button></p>}
      {content && <><h4>{content.task.title}</h4><small>현재 원본 상태 {content.task.state} · revision {content.task.revision}</small>
        {!content.complete && <p className="inline-warning">조회 한도까지의 부분 본문입니다. 아래 내용이 전체 설명은 아닙니다.</p>}
        <h5>업무 설명</h5><p className="task-content-text">{content.body || "원본에 업무 설명이 없습니다."}</p><h5>수용 기준</h5>
        {content.acceptanceCriteria.length ? <ul>{content.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul> : <p>원본에 수용 기준이 없습니다.</p>}
        <details><summary>업무 식별자</summary><dl><dt>Project</dt><dd>{task.projectId}</dd><dt>Task</dt><dd>{task.taskId}</dd></dl></details>
      </>}
    </div>}
  </>;
}
