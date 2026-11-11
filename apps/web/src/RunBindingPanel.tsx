import { useEffect, useRef, useState } from "react";
import type { BindingRequest, BindingView, ProjectMetadata, ProjectTaskMetadata, ProjectTaskPage, RunView, SourceView } from "../../../packages/contracts/index.ts";

interface ProjectOption extends ProjectMetadata { sourceId: string; sourceLabel: string }
const projectKey = (sourceId: string, projectId: string) => `${sourceId}/${projectId}`;

export function RunBindingPanel({ run, sources, onUnauthorized, onSaved }: {
  run: RunView; sources: SourceView[]; onUnauthorized: (reason: string) => void; onSaved: () => Promise<void>;
}) {
  const [view, setView] = useState<BindingView | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [project, setProject] = useState("");
  const [tasks, setTasks] = useState<ProjectTaskMetadata[]>([]);
  const [task, setTask] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [asOf, setAsOf] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [pending, setPending] = useState<BindingRequest | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const taskRequests = useRef<AbortController | null>(null);
  const canWrite = run.capabilities.includes("binding.write");
  const stamp = JSON.stringify(sources.filter((source) => source.kind === "projects").map((source) => [source.id, source.state, source.authorizedProjectIds]));
  const allowed = new Set(sources.filter((source) => source.kind === "projects" && source.state === "connected")
    .flatMap((source) => (source.authorizedProjectIds ?? []).map((id) => projectKey(source.id, id))));
  const visibleProjects = projects.filter((item) => allowed.has(projectKey(item.sourceId, item.id)));
  const chosenProject = visibleProjects.find((item) => projectKey(item.sourceId, item.id) === project);
  const chosenTask = chosenProject ? tasks.find((item) => item.id === task && item.projectId === chosenProject.id) : undefined;
  const history = view?.history.filter((item) => allowed.has(projectKey(item.binding.projectSourceId, item.binding.projectId))) ?? [];

  function unauthorized(response: Response) {
    if (response.status !== 401 && response.status !== 403) return false;
    onUnauthorized("실행 연결 권한이 해제되어 실행 데이터를 지웠습니다."); return true;
  }

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setView(null); setProjects([]);
    void (async () => {
      try {
        const response = await fetch(`/api/runs/${run.key}/binding`, { signal: controller.signal });
        if (unauthorized(response)) return;
        if (!response.ok) throw new Error();
        const result = await response.json() as BindingView;
        const catalogResponse = await fetch("/api/projects/catalog", { signal: controller.signal });
        if (unauthorized(catalogResponse)) return;
        if (!catalogResponse.ok) throw new Error();
        const catalog = await catalogResponse.json() as { sources: Array<{ id: string; label: string; state: string; projects: ProjectMetadata[] }> };
        if (controller.signal.aborted) return;
        setView(result); setProjects(catalog.sources.filter((source) => source.state === "connected")
          .flatMap((source) => source.projects.map((item) => ({ ...item, sourceId: source.id, sourceLabel: source.label }))));
      } catch { if (!controller.signal.aborted) setError("연결 이력을 읽지 못했습니다. 원본 접근과 연결을 확인한 뒤 다시 조회해 주세요."); }
    })();
    return () => controller.abort();
  }, [run.key, stamp, refresh, onUnauthorized]);

  useEffect(() => {
    const selected = projects.find((item) => projectKey(item.sourceId, item.id) === project && allowed.has(project));
    const controller = new AbortController();
    taskRequests.current = controller;
    setTasks([]); setTask(""); setNext(null); setAsOf("");
    if (!selected) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/projects/${selected.sourceId}/${selected.id}/tasks`, { signal: controller.signal });
        if (unauthorized(response)) return;
        if (!response.ok) throw new Error();
        const page = await response.json() as ProjectTaskPage;
        if (controller.signal.aborted) return;
        setTasks(page.tasks); setNext(page.nextCursor); setAsOf(page.snapshot);
      } catch { if (!controller.signal.aborted) setError("원본 업무를 읽지 못했습니다. 다시 조회해 주세요."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [project, projects, stamp, onUnauthorized]);

  async function more() {
    if (!chosenProject || !next || loading || busy || pending || !taskRequests.current) return;
    const controller = taskRequests.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${chosenProject.sourceId}/${chosenProject.id}/tasks?cursor=${encodeURIComponent(next)}`, { signal: controller.signal });
      if (unauthorized(response)) return;
      if (!response.ok) throw new Error();
      const page = await response.json() as ProjectTaskPage;
      if (controller.signal.aborted) return;
      if (page.snapshot !== asOf) throw new Error();
      setTasks((old) => [...old, ...page.tasks.filter((item) => !old.some((entry) => entry.id === item.id))]); setNext(page.nextCursor);
    } catch { if (!controller.signal.aborted) { setTasks([]); setError("업무 목록이 변경됐거나 접근할 수 없습니다. 다시 조회해 주세요."); } }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  async function save() {
    if (busy || !canWrite || !view || !lifetime.current) return;
    const input = pending ?? (chosenTask && chosenProject ? { id: crypto.randomUUID(), runKey: run.key,
      expectedVersion: view.version, projectSourceId: chosenProject.sourceId, projectId: chosenProject.id,
      taskId: chosenTask.id, taskRevision: chosenTask.revision } : null);
    if (!input) return;
    const controller = lifetime.current;
    setPending(input); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/bindings", { method: "POST", headers: { "Content-Type": "application/json" },
        signal: controller.signal, body: JSON.stringify(input) });
      if (unauthorized(response)) return;
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status < 500) setPending(null);
        if (response.status === 409) { setRefresh((value) => value + 1); setError("업무 revision이나 연결 이력이 바뀌었습니다. 최신 목록에서 다시 선택해 주세요."); }
        else setError(response.status >= 500 ? "저장 결과를 확인하지 못했습니다. 같은 요청 ID로 확인·재시도할 수 있습니다." : "연결을 저장하지 못했습니다. 원본 접근을 확인해 주세요.");
        return;
      }
      setPending(null); setMessage("이 Run의 업무 연결을 기록했습니다. 원본 업무 상태와 실행 상태는 각각 유지됩니다.");
      setRefresh((value) => value + 1); await onSaved();
    } catch { if (!controller.signal.aborted) setError("응답을 확인하지 못했습니다. 같은 요청 ID로 확인·재시도할 수 있습니다."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }

  return <section className="run-binding"><h3>원본 업무 연결</h3><p>이 Run에만 연결하고 당시 업무 revision을 보존합니다. 업무 배정·완료·수용은 별도입니다.</p>
    <details><summary>연결 이력 {view ? `${history.length}건` : error ? "조회 필요" : "조회 중"}</summary>{history.length ? <ol className="binding-history">{history.map((item) => <li key={item.version}><strong>{item.binding.taskTitle ?? "프로젝트 연결"}</strong><small>{item.binding.projectTitle} · revision {item.binding.taskRevision ?? "미지정"}</small><small>{new Date(item.recordedAt).toLocaleString("ko-KR")} · 연결 version {item.version}</small></li>)}</ol> : <p>{view ? "현재 접근 가능한 연결 이력이 없습니다." : "현재 연결 이력을 확인해야 합니다."}</p>}{view?.incomplete && <small>최근50개 이력입니다.</small>}</details>
    {canWrite ? <><label>연결할 프로젝트<select aria-label="연결할 프로젝트" value={chosenProject ? project : ""} disabled={busy || !!pending} onChange={(event) => { setProject(event.target.value); setError(""); }}><option value="">프로젝트 선택</option>{visibleProjects.map((item) => <option key={projectKey(item.sourceId, item.id)} value={projectKey(item.sourceId, item.id)}>{item.title} · {item.sourceLabel}</option>)}</select></label>
      <label>연결할 원본 업무<select aria-label="연결할 원본 업무" value={chosenTask ? task : ""} disabled={!chosenProject || loading || busy || !!pending} onChange={(event) => setTask(event.target.value)}><option value="">{loading ? "조회 중…" : "업무 선택"}</option>{(chosenProject ? tasks.filter((item) => item.projectId === chosenProject.id) : []).map((item) => <option key={item.id} value={item.id}>{item.title} · revision {item.revision}</option>)}</select></label>
      {next && <button className="text-button" disabled={loading || busy || !!pending} onClick={() => void more()}>원본 업무 더 불러오기</button>}
      <button className="button-secondary" disabled={busy || !view || (!pending && !chosenTask)} onClick={() => void save()}>{busy ? "연결 기록 중…" : pending ? "같은 요청 확인·재시도" : "이 Run에 업무 연결"}</button></> : <small>현재 출처·계정에서는 업무 연결을 지원하지 않습니다.</small>}
    <button className="text-button" disabled={busy || !!pending} onClick={() => { setError(""); setRefresh((value) => value + 1); }}>연결·업무 다시 조회</button>
    {error && <p className="command-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
