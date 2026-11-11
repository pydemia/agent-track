import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TaskCreatePanel } from "./TaskCreatePanel.tsx";
import { TaskAssignmentPanel } from "./TaskAssignmentPanel.tsx";
import type { ProjectMetadata, ProjectTaskMetadata, ProjectTaskPage, RunView, SourceView } from "../../../packages/contracts/index.ts";

interface CatalogSource { id: string; label: string; state: SourceView["state"]; detail: string; projects: ProjectMetadata[] }
interface TaskGroup { sourceId: string; sourceLabel: string; project: ProjectMetadata; tasks: ProjectTaskMetadata[]; total: number; nextCursor: string | null; snapshot: string }
const states: Record<string, string> = { todo: "할 일", in_progress: "진행", in_review: "검토", done: "원본 완료", cancelled: "원본 취소", unknown: "알 수 없음" };
const keyFor = (sourceId: string, projectId: string) => `${sourceId}/${projectId}`;

export function ProjectsCatalog({ sources, runs, onSelect, onAssigned, onUnauthorized }: { sources: SourceView[]; runs: RunView[]; onSelect: (key: string) => void; onAssigned: (key: string) => void; onUnauthorized: (reason: string) => void }) {
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [assignment, setAssignment] = useState<{ sourceId: string; projectId: string; taskId: string } | null>(null);
  const taskCreated = useCallback(() => setRefresh((value) => value + 1), []);
  const requestSignal = useRef<AbortSignal | null>(null);
  const grants = useMemo(() => new Set(sources.filter((source) => source.kind === "projects" && source.state === "connected")
    .flatMap((source) => (source.authorizedProjectIds ?? []).map((id) => keyFor(source.id, id)))), [sources]);
  const stamp = JSON.stringify([...grants].sort());
  const visible = groups.filter((group) => grants.has(keyFor(group.sourceId, group.project.id)));
  const effectiveScope = visible.some((group) => keyFor(group.sourceId, group.project.id) === scope) ? scope : "";
  const chosen = visible.filter((group) => !effectiveScope || effectiveScope === keyFor(group.sourceId, group.project.id));
  const assignmentGroup = chosen.find((group) => group.sourceId === assignment?.sourceId && group.project.id === assignment.projectId);
  const assignmentTask = assignmentGroup?.tasks.find((task) => task.id === assignment?.taskId);

  useEffect(() => {
    const controller = new AbortController();
    requestSignal.current = controller.signal;
    let timer: ReturnType<typeof setTimeout>;
    async function get<T>(url: string): Promise<T> {
      const response = await fetch(url, { signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        onUnauthorized("업무 조회 권한이 해제되어 실행 데이터를 지웠습니다."); throw new Error("Access revoked");
      }
      if (!response.ok) throw new Error("Project metadata unavailable");
      return response.json() as Promise<T>;
    }
    async function load() {
      setLoading(true);
      try {
        const catalog = await get<{ sources: CatalogSource[] }>("/api/projects/catalog");
        const next: TaskGroup[] = [];
        // Bounded pages, sequential reads keep native ACL checks and source paging explicit.
        for (const source of catalog.sources.filter((item) => item.state === "connected")) {
          for (const project of source.projects) {
            const page = await get<ProjectTaskPage>(`/api/projects/${source.id}/${project.id}/tasks`);
            if (page.tasks.some((task) => task.projectId !== project.id)) throw new Error("Project identity mismatch");
            next.push({ sourceId: source.id, sourceLabel: source.label, project, tasks: page.tasks, total: page.total, nextCursor: page.nextCursor, snapshot: page.snapshot });
          }
        }
        if (controller.signal.aborted) return;
        setGroups((old) => next.map((group) => {
          const previous = old.find((item) => item.sourceId === group.sourceId && item.project.id === group.project.id && item.snapshot === group.snapshot);
          return previous && previous.tasks.length > group.tasks.length ? { ...group, tasks: previous.tasks, nextCursor: previous.nextCursor } : group;
        })); setError("");
      } catch {
        if (!controller.signal.aborted) { setError("원본 업무를 확인하지 못했습니다. 접근 범위와 연결을 다시 확인해 주세요."); }
      } finally {
        if (!controller.signal.aborted) { setLoading(false); timer = setTimeout(() => void load(), 15_000); }
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [stamp, refresh, onUnauthorized]);

  async function more(group: TaskGroup) {
    const signal = requestSignal.current;
    if (!group.nextCursor || loading || !signal || signal.aborted) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${group.sourceId}/${group.project.id}/tasks?cursor=${encodeURIComponent(group.nextCursor)}`, { signal });
      if (signal.aborted) return;
      if (response.status === 401 || response.status === 403) { onUnauthorized("업무 조회 권한이 해제되어 실행 데이터를 지웠습니다."); return; }
      if (!response.ok) throw new Error("Task page unavailable");
      const page = await response.json() as ProjectTaskPage;
      if (signal.aborted) return;
      if (page.snapshot !== group.snapshot || page.tasks.some((task) => task.projectId !== group.project.id)) throw new Error("Task page changed");
      setGroups((old) => old.map((item) => item === group
        ? { ...item, tasks: [...item.tasks, ...page.tasks.filter((task) => !item.tasks.some((oldTask) => oldTask.id === task.id))], nextCursor: page.nextCursor } : item));
    } catch { if (!signal.aborted) { setError("업무 목록이 바뀌었거나 접근할 수 없습니다. 처음부터 다시 조회해 주세요."); } }
    finally { if (!signal.aborted) setLoading(false); }
  }

  return <details className="projects-catalog"><summary>Projects 원본 업무 <small>{!sources.some((source) => source.kind === "projects" && source.state === "connected") ? "원본 접근 확인 필요" : loading && !visible.length ? "조회 중" : `${visible.length}개 프로젝트 · ${visible.reduce((sum, group) => sum + group.total, 0)}개 업무`}</small></summary>
    <p className="graph-legend">원본 ID·revision·업무 상태를 조회합니다. 실행 종료와 Projects 완료·수용은 별도입니다. 본문은 내용 검토를 열었을 때만 조회하며 Track 원장에 저장하지 않습니다.</p>
    <div className="project-task-filter"><label>원본 업무 범위 <select aria-label="원본 업무 범위" value={visible.some((group) => keyFor(group.sourceId, group.project.id) === scope) ? scope : ""} onChange={(event) => setScope(event.target.value)}><option value="">모든 허용 프로젝트</option>{visible.map((group) => <option key={keyFor(group.sourceId, group.project.id)} value={keyFor(group.sourceId, group.project.id)}>{group.project.title}</option>)}</select></label><button className="text-button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>다시 조회</button></div>
    {effectiveScope && chosen.map((group) => <TaskCreatePanel key={keyFor(group.sourceId, group.project.id)} sourceId={group.sourceId} projectId={group.project.id} projectTitle={group.project.title} onUnauthorized={onUnauthorized} onCreated={taskCreated} />)}
    {!effectiveScope && <p className="graph-legend">새 업무를 만들려면 원본 업무 범위에서 프로젝트를 선택하세요.</p>}
    {error ? <p className="inline-error" role="alert">{error}</p> : !visible.length ? <p className="empty-inline">현재 조회 가능한 원본 업무가 없습니다. 미연결·권한·조회 중인 상태를 업무 없음과 구분해 주세요.</p>
      : <div className="project-task-scroll" role="region" aria-label="Projects 원본 업무 목록 스크롤" tabIndex={0}><div className="table-wrap"><table><caption className="sr-only">Projects의 현재 업무와 명시적으로 연결된 Run</caption><thead><tr><th scope="col">원본 업무 · revision</th><th scope="col">프로젝트</th><th scope="col">원본 상태</th><th scope="col">연결된 Run</th><th scope="col">실행 배정</th></tr></thead><tbody>{chosen.flatMap((group) => group.tasks.map((task) => {
        const related = runs.filter((run) => run.binding?.projectSourceId === group.sourceId && run.binding.projectId === group.project.id && run.binding.taskId === task.id);
        return <tr key={`${group.sourceId}/${task.id}`}><td><strong>{task.title}</strong><small>revision {task.revision} · {task.id}</small></td><td>{group.project.title}<small>{group.sourceLabel}</small></td><td>{states[task.state] ?? "알 수 없음"}<small>수용 정보 별도</small></td><td>{related.length ? related.map((run) => <button className="text-button" key={run.key} onClick={() => onSelect(run.key)}>{run.title || run.runId}</button>) : <span className="muted">현재 관측에서 미연결</span>}</td><td><button className="text-button" onClick={() => setAssignment({ sourceId: group.sourceId, projectId: group.project.id, taskId: task.id })}>내용 검토·실행 배정</button></td></tr>;
      }))}</tbody></table></div></div>}
    {chosen.filter((group) => group.nextCursor).map((group) => <button className="text-button" key={keyFor(group.sourceId, group.project.id)} disabled={loading} onClick={() => void more(group)}>{group.project.title} · 업무 더 불러오기</button>)}
    {assignmentGroup && assignmentTask && <><button className="text-button" onClick={() => setAssignment(null)}>업무 검토 닫기</button><TaskAssignmentPanel key={`${assignmentGroup.sourceId}/${assignmentTask.id}`} sourceId={assignmentGroup.sourceId} projectId={assignmentGroup.project.id} projectTitle={assignmentGroup.project.title} task={assignmentTask} onUnauthorized={onUnauthorized} onAssigned={onAssigned} /></>}
  </details>;
}
