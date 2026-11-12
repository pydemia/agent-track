import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { ProjectsCatalog } from "./ProjectsCatalog.tsx";
import { RunBindingPanel } from "./RunBindingPanel.tsx";
import { RunApprovals } from "./RunApprovals.tsx";
import { RunTrace } from "./RunTrace.tsx";
import { SnapshotOrder } from "../../../packages/projection/snapshot-order.ts";
import { ArtifactEvidencePanel } from "./ArtifactEvidencePanel.tsx";
import { FileEvidencePanel } from "./FileEvidencePanel.tsx";
import { MissionOverview } from "./MissionOverview.tsx";
import "./mission-flow.css";
import { ActivityTrail } from "./ActivityTrail.tsx";
import { RunControls } from "./RunControls.tsx";
import { removeDeniedTaskContext, removeDeniedTaskQuery, type TaskMapContext } from "./task-map-context.ts";
import type { EventView, RelationView, RunView, Snapshot, SourceView } from "../../../packages/contracts/index.ts";
import { useAssistantExecutions, assistantMatches } from "./useAssistantExecutions.ts";
import type { AssistantSelection } from "./AssistantWorkspace.tsx";

const LazyMissionFlow = lazy(() => import("./MissionFlow.tsx").then((module) => ({ default: module.MissionFlow })));
const LazyTaskDependencyMap = lazy(() => import("./TaskDependencyMap.tsx").then((module) => ({ default: module.TaskDependencyMap })));
const LazyAssistantWorkspace = lazy(() => import("./AssistantWorkspace.tsx").then(module => ({ default: module.AssistantWorkspace })));

type Tab = "track" | "trail" | "trace" | "map";
type Health = "checking" | "ok" | "unavailable";
type Filters = { project: string; source: string; status: string; q: string };

const tabs: { id: Tab; label: string; title: string }[] = [
  { id: "track", label: "Track", title: "업무 실행 관리" },
  { id: "trail", label: "Trail", title: "업무 경과" },
  { id: "trace", label: "Trace", title: "실행 분석" },
  { id: "map", label: "Map", title: "업무·협업 지도" },
];
const relationNames: Record<RelationView["kind"], string> = {
  invocation: "에이전트 호출",
  cowork: "협업 작업",
  "managed-child": "관리형 자식 실행",
  peer: "독립 peer 세션",
  dependency: "의존 관계",
  artifact: "산출물 관계",
};
const statusNames: Record<string, string> = {
  queued: "대기", leasing: "할당 중", running: "실행 중", waiting_for_permission: "권한 대기",
  cancelling: "취소 중", succeeded: "성공 종료", failed: "실패 종료", cancelled: "취소 종료",
  expired: "만료", interrupted: "중단", unknown: "상태 미확인",
  registering: "Assistant 등록 중", completed: "Assistant 완료 관측", publishing: "게시 처리 중", linking: "연결 처리 중", reconciliation_required: "확인 필요",
};
const metadataKeys = ["invocationId", "parentInvocationId", "groupId", "memberId", "childRunId", "peerSessionId", "callId", "tool", "path", "artifactId", "permissionId", "expiresAt", "durationMs", "redacted"] as const;

function readUrl() {
  const params = new URLSearchParams(location.search);
  const tab = params.get("view");
  return {
    tab: tabs.some((item) => item.id === tab) ? tab as Tab : "track" as Tab,
    selected: params.get("run") ?? "",
    taskMap: params.get("taskSource") && params.get("taskProject") ? {
      sourceId: params.get("taskSource")!, projectId: params.get("taskProject")!, ...(params.get("task") ? { taskId: params.get("task")! } : {}),
    } as TaskMapContext : null,
    filters: {
      project: params.get("project") ?? "",
      source: params.get("source") ?? "",
      status: params.get("status") ?? "",
      q: params.get("q") ?? "",
    },
  };
}
function writeUrl(tab: Tab, selected: string, filters: Filters, replace = false, taskMap: TaskMapContext | null = null) {
  const params = new URLSearchParams();
  if (tab !== "track") params.set("view", tab);
  if (selected) params.set("run", selected);
  if (taskMap) { params.set("taskSource", taskMap.sourceId); params.set("taskProject", taskMap.projectId); if (taskMap.taskId) params.set("task", taskMap.taskId); }
  for (const key of ["project", "source", "status", "q"] as const) if (filters[key]) params.set(key, filters[key]);
  const query = params.toString();
  history[replace ? "replaceState" : "pushState"]({}, "", `${location.pathname}${query ? `?${query}` : ""}`);
}
function timestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function checkedSnapshot(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Snapshot>;
  return typeof item.user === "string" && typeof item.viewEpoch === "string" && typeof item.viewVersion === "string" &&
    Array.isArray(item.runs) && Array.isArray(item.sources) && Array.isArray(item.relations);
}
function originUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value, location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}
function workspaceName(path: string | null) {
  if (!path) return "저장소 미확인";
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
function DisplayState({ run }: { run: RunView }) {
  return <span className={`state ${run.status === "failed" || run.status === "interrupted" ? "bad" : run.status === "waiting_for_permission" ? "warn" : ""}`}>
    <i aria-hidden="true" />{statusNames[run.status] ?? run.status}
  </span>;
}
function SourceState({ state }: { state: SourceView["state"] }) {
  const labels = { connected: "연결됨", disconnected: "연결 끊김", forbidden: "접근 제한", unsupported: "미지원" };
  return <span className={`source-state ${state}`}>{labels[state]}</span>;
}

export function App() {
  const initial = useRef(readUrl());
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pageError, setPageError] = useState("");
  const [streamState, setStreamState] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const [health, setHealth] = useState<Health>("checking");
  const [tab, setTab] = useState<Tab>(initial.current.tab);
  const [selectedKey, setSelectedKey] = useState(initial.current.selected);
  const [assistantSelection, setAssistantSelection] = useState<AssistantSelection | null>(null);
  const [taskMap, setTaskMap] = useState<TaskMapContext | null>(initial.current.taskMap);
  const [filters, setFilters] = useState<Filters>(initial.current.filters);
  const [events, setEvents] = useState<EventView[]>([]);
  const [eventsError, setEventsError] = useState("");
  const [nextCursor, setNextCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsRefresh, setEventsRefresh] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mapMode, setMapMode] = useState<"relations" | "paths">("relations");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => matchMedia("(max-width: 720px)").matches);
  const sidebarToggle = useRef<HTMLButtonElement>(null);
  const sidebarClose = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const source = useRef<EventSource | null>(null);
  const snapshotOrder = useRef(new SnapshotOrder());
  const snapshotGeneration = useRef(0);
  const snapshotRequest = useRef<AbortController | null>(null);
  const eventGeneration = useRef(0);
  const eventRunKey = useRef("");
  const eventHighWater = useRef("");
  const eventNextCursor = useRef<string | null>(null);
  const eventHasMore = useRef(false);
  const eventInFlight = useRef(false);
  const pendingTail = useRef(false);
  const eventController = useRef<AbortController | null>(null);
  const handledEventsRefresh = useRef(0);
  const run = useMemo(() => snapshot?.runs.find((item) => item.key === selectedKey) ?? null, [snapshot, selectedKey]);

  useEffect(() => {
    const media = matchMedia("(max-width: 720px)");
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const clearPrivateData = useCallback((reason: string) => {
    snapshotGeneration.current += 1;
    snapshotRequest.current?.abort();
    eventGeneration.current += 1;
    eventController.current?.abort();
    eventController.current = null;
    eventInFlight.current = false;
    pendingTail.current = false;
    eventRunKey.current = "";
    eventHighWater.current = "";
    eventNextCursor.current = null;
    eventHasMore.current = false;
    setSnapshot(null);
    setEvents([]);
    setEventsError("");
    setNextCursor("");
    setHasMore(false);
    setLoadingEvents(false);
    setSelectedKey("");
    setAssistantSelection(null);
    setTaskMap(null);
    setPageError(reason);
    setStreamState("disconnected");
    const params = new URLSearchParams(location.search);
    params.delete("run");
    for (const key of ["taskSource", "taskProject", "task"]) params.delete(key);
    const query = params.toString();
    history.replaceState({}, "", `${location.pathname}${query ? `?${query}` : ""}`);
    source.current?.close();
    source.current = null;
  }, []);

  const loadSnapshot = useCallback(async () => {
    snapshotRequest.current?.abort();
    const controller = new AbortController();
    snapshotRequest.current = controller;
    const generation = snapshotGeneration.current;
    const current = () => !controller.signal.aborted && generation === snapshotGeneration.current;
    try {
      const response = await fetch("/api/snapshot", { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        clearPrivateData(response.status === 401 ? "로그인이 만료되어 실행 데이터를 지웠습니다." : "실행 목록 접근 권한이 없어 데이터를 지웠습니다.");
        return;
      }
      if (!response.ok) throw new Error(`스냅샷 조회 실패 (${response.status})`);
      const result: unknown = await response.json();
      if (!current()) return;
      if (!checkedSnapshot(result)) throw new Error("스냅샷 응답 형식이 올바르지 않습니다.");
      if (!snapshotOrder.current.accept(result)) return;
      setSnapshot(result);
      setHealth("ok");
      setPageError("");
      setSelectedKey((current) => current && result.runs.some((item) => item.key === current) ? current : "");
    } catch (error) {
      if (current()) { setHealth("unavailable"); setPageError(error instanceof Error ? error.message : "스냅샷을 불러오지 못했습니다."); }
    }
  }, [clearPrivateData]);

  const connectStream = useCallback(() => {
    source.current?.close();
    setStreamState("connecting");
    const stream = new EventSource("/api/stream", { withCredentials: true });
    source.current = stream;
    stream.addEventListener("open", () => { if (source.current === stream) setStreamState("connected"); });
    stream.addEventListener("snapshot", (event) => {
      if (source.current !== stream) return;
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (checkedSnapshot(value) && snapshotOrder.current.accept(value)) {
          setSnapshot(value);
          setHealth("ok");
          setPageError("");
        }
      } catch { /* A malformed stream frame does not replace the last valid snapshot. */ }
    });
    stream.addEventListener("authorization_revoked", () => {
      if (source.current === stream) clearPrivateData("접근 권한이 해제되어 실행 데이터를 지웠습니다.");
    });
    stream.onerror = () => { if (source.current === stream) { setStreamState("disconnected"); void loadSnapshot(); } };
  }, [clearPrivateData, loadSnapshot]);

  useEffect(() => {
    void loadSnapshot();
    void fetch("/api/health", { credentials: "same-origin", cache: "no-store" })
      .then((response) => setHealth(response.ok ? "ok" : "unavailable"))
      .catch(() => setHealth("unavailable"));
    connectStream();
    return () => { source.current?.close(); source.current = null; snapshotRequest.current?.abort(); };
  }, [connectStream, loadSnapshot]);

  useEffect(() => {
    const onPopState = () => {
      const next = readUrl();
      if (next.selected !== selectedKey) {
        eventGeneration.current += 1; eventController.current?.abort(); eventController.current = null;
        eventInFlight.current = false; eventRunKey.current = ""; eventNextCursor.current = null;
        setEvents([]); setEventsError(""); setNextCursor(""); setHasMore(false); setLoadingEvents(false);
      }
      setTab(next.tab); setSelectedKey(next.selected); setFilters(next.filters); setTaskMap(next.taskMap);
    };
    addEventListener("popstate", onPopState);
    return () => removeEventListener("popstate", onPopState);
  }, [selectedKey]);

  useEffect(() => {
    if (!snapshot?.user) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`agent-track-sidebar:${snapshot.user}`) ?? "null") as { width?: unknown; collapsed?: unknown } | null;
      if (typeof saved?.width === "number" && saved.width >= 180 && saved.width <= 360) setSidebarWidth(saved.width);
      if (typeof saved?.collapsed === "boolean") setSidebarCollapsed(saved.collapsed);
    } catch { /* The defaults remain usable when browser storage is unavailable. */ }
  }, [snapshot?.user]);

  const setLocation = (next: { tab?: Tab; selected?: string; filters?: Filters; taskMap?: TaskMapContext | null }, replace = false) => {
    const nextTab = next.tab ?? tab;
    const nextSelected = next.selected ?? selectedKey;
    const nextFilters = next.filters ?? filters;
    const nextTaskMap = next.taskMap !== undefined ? next.taskMap : next.selected !== undefined || next.filters !== undefined ? null : taskMap;
    if (nextSelected !== selectedKey) {
      eventGeneration.current += 1; eventController.current?.abort(); eventController.current = null;
      eventInFlight.current = false; eventRunKey.current = ""; eventNextCursor.current = null;
      eventHasMore.current = false; pendingTail.current = false;
      setEvents([]); setEventsError(""); setNextCursor(""); setHasMore(false); setLoadingEvents(false);
    }
    setTab(nextTab); setSelectedKey(nextSelected); setFilters(nextFilters); setTaskMap(nextTaskMap);
    writeUrl(nextTab, nextSelected, nextFilters, replace, nextTaskMap);
  };

  const clearTaskMapScope = useCallback((sourceId: string, projectId: string) => {
    setTaskMap((current) => removeDeniedTaskContext(current, sourceId, projectId));
    const query = removeDeniedTaskQuery(location.search, sourceId, projectId);
    if (query === null) return;
    history.replaceState({}, "", `${location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  useEffect(() => {
    if (!snapshot || !taskMap) return;
    const allowed = snapshot.sources.some((source) => source.id === taskMap.sourceId && source.kind === "projects" && source.state === "connected" && source.authorizedProjectIds?.includes(taskMap.projectId));
    if (!allowed) { setTaskMap(null); writeUrl(tab, selectedKey, filters, true, null); }
  }, [snapshot, taskMap, tab, selectedKey, filters]);

  const requestEventsPage = useCallback(async (runKey: string, cursor: string | null, generation: number, replace: boolean) => {
    if (eventInFlight.current || generation !== eventGeneration.current) {
      if (!replace && generation === eventGeneration.current) pendingTail.current = true;
      return;
    }
    const controller = new AbortController();
    eventController.current = controller;
    eventInFlight.current = true;
    setLoadingEvents(true);
    setEventsError("");
    const cursorQuery = cursor === null ? "" : `?after=${encodeURIComponent(cursor)}`;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runKey)}/events${cursorQuery}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (generation !== eventGeneration.current) return;
      if (response.status === 401 || response.status === 403) {
        clearPrivateData(response.status === 401 ? "로그인이 만료되어 실행 데이터를 지웠습니다." : "이벤트 접근 권한이 없어 실행 데이터를 지웠습니다.");
        return;
      }
      if (!response.ok) throw new Error(`이벤트 조회 실패 (${response.status})`);
      const page = await response.json() as { events: EventView[]; nextCursor: string; hasMore: boolean };
      if (!Array.isArray(page.events) || !/^(0|[1-9][0-9]*)$/.test(page.nextCursor) || typeof page.hasMore !== "boolean") throw new Error("이벤트 응답 형식이 올바르지 않습니다.");
      if (generation !== eventGeneration.current) return;
      eventNextCursor.current = page.nextCursor;
      eventHasMore.current = page.hasMore;
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setEvents((current) => {
        if (replace) return page.events;
        const existing = new Set(current.map((item) => item.key));
        return [...current, ...page.events.filter((item) => !existing.has(item.key))];
      });
    } catch (error) {
      if (!controller.signal.aborted && generation === eventGeneration.current) setEventsError(error instanceof Error ? error.message : "이벤트를 불러오지 못했습니다.");
    } finally {
      if (generation === eventGeneration.current) {
        eventInFlight.current = false;
        eventController.current = null;
        setLoadingEvents(false);
        if (pendingTail.current && eventNextCursor.current !== null) {
          pendingTail.current = false;
          void requestEventsPage(runKey, eventNextCursor.current, generation, false);
        }
      }
    }
  }, [clearPrivateData]);

  useEffect(() => {
    if (!run) {
      if (eventRunKey.current) {
        eventGeneration.current += 1;
        eventController.current?.abort();
        eventController.current = null;
        eventInFlight.current = false;
        eventRunKey.current = "";
        eventHighWater.current = "";
        eventNextCursor.current = null;
        eventHasMore.current = false;
        pendingTail.current = false;
      }
      setEvents([]); setEventsError(""); setNextCursor(""); setHasMore(false); setLoadingEvents(false);
      return;
    }
    if (eventRunKey.current !== run.key) {
      eventController.current?.abort();
      eventInFlight.current = false;
      pendingTail.current = false;
      eventGeneration.current += 1;
      const generation = eventGeneration.current;
      eventRunKey.current = run.key;
      eventHighWater.current = run.highWater;
      eventNextCursor.current = null;
      eventHasMore.current = false;
      setEvents([]); setEventsError(""); setNextCursor(""); setHasMore(false);
      void requestEventsPage(run.key, null, generation, true);
      return;
    }
    if (handledEventsRefresh.current !== eventsRefresh) {
      handledEventsRefresh.current = eventsRefresh;
      void requestEventsPage(run.key, eventNextCursor.current, eventGeneration.current, eventNextCursor.current === null);
      return;
    }
    if (eventHighWater.current !== run.highWater) {
      eventHighWater.current = run.highWater;
      if (eventNextCursor.current === null) pendingTail.current = true;
      else void requestEventsPage(run.key, eventNextCursor.current, eventGeneration.current, false);
    }
  }, [run?.key, run?.highWater, requestEventsPage, eventsRefresh]);

  useEffect(() => () => eventController.current?.abort(), []);

  const loadMoreEvents = () => {
    if (!run || !eventHasMore.current || eventNextCursor.current === null || eventInFlight.current) return;
    void requestEventsPage(run.key, eventNextCursor.current, eventGeneration.current, false);
  };

  const accessibleRuns = useMemo(() => snapshot?.runs.filter((item) => item.sourceState !== "forbidden") ?? [], [snapshot]);
  const assistant = useAssistantExecutions(snapshot?.user ?? null, snapshot?.sources ?? [], clearPrivateData, () => { void loadSnapshot(); });
  const visibleAssistantCount = assistant.executions.filter(view => assistantMatches(view, filters)).length;
  const assistantSourceSelected = snapshot?.sources.some(source => source.id === filters.source && source.kind === "assistant" && source.state !== "unsupported");
  const unavailableSource = snapshot?.sources.find((source) => source.id === filters.source && source.state !== "connected");
  const projectOptions = useMemo(() => {
    const bindingMap = new Map<string, string>();
    const workspaceMap = new Map<string, string>();
    for (const run of accessibleRuns) {
      if (run.binding && run.projectKey) bindingMap.set(run.projectKey, run.binding.projectTitle);
      if (!run.binding && run.workspaceKey) workspaceMap.set(run.workspaceKey, workspaceName(run.workspaceId));
    }
    for (const view of assistant.executions) if (view.currentTask) bindingMap.set(view.currentTask.projectKey, view.currentTask.project.title);
    const bindings = [...bindingMap].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    const workspaces = [...workspaceMap].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
    return { bindings, workspaces };
  }, [accessibleRuns, assistant.executions]);
  const visibleRuns = useMemo(() => accessibleRuns.filter((item) => {
    const text = `${item.title} ${item.runId} ${item.sessionId} ${item.sourceLabel} ${item.binding?.projectTitle ?? ""} ${item.binding?.taskTitle ?? ""} ${workspaceName(item.workspaceId)}`.toLocaleLowerCase();
    const projectMatch = !filters.project
      || (item.projectKey === filters.project)
      || (!item.binding && item.workspaceKey === filters.project);
    return projectMatch
      && (!filters.source || item.sourceId === filters.source)
      && (!filters.status || item.status === filters.status)
      && (!filters.q || text.includes(filters.q.toLocaleLowerCase()));
  }).sort((a, b) => b.observedAt.localeCompare(a.observedAt)), [accessibleRuns, filters]);
  const accessibleRunKeys = useMemo(() => new Set(accessibleRuns.map((item) => item.key)), [accessibleRuns]);
  const accessibleRelations = useMemo(() => snapshot?.relations.filter((item) => accessibleRunKeys.has(item.runKey)) ?? [], [snapshot, accessibleRunKeys]);
  const related = useMemo(() => accessibleRelations.filter((item) => item.runKey === selectedKey), [accessibleRelations, selectedKey]);
  const unavailable = !snapshot && Boolean(pageError);

  const saveSidebarWidth = (width: number) => {
    const next = Math.max(180, Math.min(360, width));
    setSidebarWidth(next);
    if (snapshot?.user) {
      try { localStorage.setItem(`agent-track-sidebar:${snapshot.user}`, JSON.stringify({ width: next, collapsed: sidebarCollapsed })); } catch { /* Keep the current in-memory preference. */ }
    }
  };
  const toggleSidebar = () => {
    if (isMobile) setSidebarOpen((value) => !value);
    else {
      setSidebarCollapsed((value) => {
        const next = !value;
        if (snapshot?.user) {
          try { localStorage.setItem(`agent-track-sidebar:${snapshot.user}`, JSON.stringify({ width: sidebarWidth, collapsed: next })); } catch { /* Keep the current in-memory preference. */ }
        }
        return next;
      });
    }
  };
  const closeMobileSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() => sidebarToggle.current?.focus());
  };
  useEffect(() => {
    if (!sidebarOpen) return;
    requestAnimationFrame(() => sidebarClose.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMobileSidebar(); return; }
      if (event.key !== "Tab" || !sidebarRef.current) return;
      const focusable = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'))
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) { event.preventDefault(); sidebarRef.current.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

  const renderMeta = (event: EventView) => {
    const entries = metadataKeys.flatMap((key) => {
      const value = event.data[key];
      if (value === undefined || value === null || value === false || value === "") return [];
      return [[key, String(value)] as const];
    });
    return entries.length ? <dl className="event-meta">{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl> : <span className="muted">허용된 추가 메타데이터 없음</span>;
  };

  const selectedProjectLabel = filters.project.startsWith("project:")
    ? projectOptions.bindings.find((project) => project.key === filters.project)?.label ?? "프로젝트 미확인"
    : filters.project.startsWith("workspace:")
      ? `업무 미연결 · ${projectOptions.workspaces.find((workspace) => workspace.key === filters.project)?.label ?? "저장소 미확인"}`
      : "전체 프로젝트";
  const sidebarExpanded = isMobile ? sidebarOpen : !sidebarCollapsed;

  return <div className="app" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <header className="topbar">
      <button className="sidebar-toggle" ref={sidebarToggle} aria-controls="context-sidebar" aria-label={sidebarExpanded ? "문맥 사이드바 닫기" : "문맥 사이드바 열기"} aria-expanded={sidebarExpanded} title={sidebarExpanded ? "사이드바 접기" : "사이드바 펼치기"} onClick={toggleSidebar}>{sidebarExpanded ? "‹" : "☰"}</button>
      <a className="brand" href="/" aria-label="Agent Track 홈"><span className="brand-mark">A</span><span>Agent <b>Track</b></span></a>
      <div className="header-caption">업무 · 세션 · Agent 실행</div>
      <div className="connection" aria-live="polite"><span className={`connection-dot ${streamState}`} />
        {streamState === "connected" ? "실시간 연결" : streamState === "connecting" ? "연결 확인 중" : "실시간 연결 끊김"}
        <span className="health-label"> · API {health === "ok" ? "정상" : health === "checking" ? "확인 중" : "응답 없음"}</span>
      </div>
      <a className="logout" href="/oauth2/sign_out">로그아웃</a>
    </header>
    <div className={`layout ${sidebarOpen ? "drawer-open" : ""} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside id="context-sidebar" ref={sidebarRef} tabIndex={-1} className="sidebar" aria-label="연결 문맥" aria-labelledby="sidebar-title" role={sidebarOpen ? "dialog" : undefined} aria-modal={sidebarOpen || undefined}>
        <div className="sidebar-head"><div><span className="overline">WORKSPACE</span><strong id="sidebar-title">실행 문맥</strong></div><button className="close-sidebar" ref={sidebarClose} onClick={closeMobileSidebar} aria-label="사이드바 닫기">×</button></div>
        <div className="context-block"><span className="context-label">사용자</span><strong className="user-name">{snapshot?.user ?? (pageError ? "연결 확인 필요" : "확인 중")}</strong></div>
        <div className="context-block"><span className="context-label">프로젝트 / 저장소</span><strong>{selectedProjectLabel}</strong><small>Run {visibleRuns.length}개 · Assistant 실행 {visibleAssistantCount}개</small></div>
        <div className="context-block source-context"><span className="context-label">관측 출처</span>
          {snapshot?.sources.length ? snapshot.sources.map((item) => <div className="source-row" key={item.id}><span>{item.label}</span><SourceState state={item.state} /></div>) : <p className="muted">아직 연결된 출처가 없습니다.</p>}
        </div>
        {run && <div className="context-block selected-context"><span className="context-label">선택한 실행</span><strong>{run.title || run.runId}</strong><small>{run.sourceLabel} · {run.device}</small>{originUrl(run.sourceUrl) ? <a className="source-link" href={originUrl(run.sourceUrl)!} target="_blank" rel="noreferrer">원본 세션 열기 ↗</a> : <span className="source-link unsupported-link">원본 세션 링크 미지원</span>}<small>Run 전용 딥링크는 지원되지 않습니다.</small></div>}
        <label className="width-control">사이드바 너비 <input type="range" min="180" max="360" step="4" value={sidebarWidth} onChange={(event) => saveSidebarWidth(Number(event.target.value))} aria-label="사이드바 너비 조절" /><span>{sidebarWidth}px</span></label>
        <div className="sidebar-footer">원본 관측만 표시합니다.<br />대화 원문을 저장하거나 표시하지 않습니다.</div>
      </aside>
      {sidebarOpen && <button className="drawer-scrim" aria-label="사이드바 닫기" onClick={closeMobileSidebar} />}
      <main className="main">
        <div className="page-heading"><div><div className="breadcrumb">Agent Track <span>/</span> {tabs.find((item) => item.id === tab)?.title}</div><h1>{tabs.find((item) => item.id === tab)?.title}</h1><p className="lead">실제 관측 데이터의 범위와 연결 상태를 함께 확인합니다.</p></div>
          <div className="snapshot-stamp"><span className="overline">SNAPSHOT</span><strong>{snapshot ? timestamp(snapshot.generatedAt) : "—"}</strong><small>revision {snapshot?.revision ?? "—"}</small></div></div>

        {streamState === "disconnected" && <div className="notice warning" role="status"><span>{snapshot ? "실시간 연결이 끊겼습니다. 마지막으로 받은 스냅샷을 표시합니다." : "실시간 연결이 끊겼습니다. 연결 복구와 접근 확인 후 데이터를 다시 조회합니다."}</span><button onClick={connectStream}>다시 연결</button></div>}
        {pageError && <div className="notice error" role="alert"><span>{pageError}{snapshot ? " 마지막 정상 스냅샷은 유지됩니다." : " 데이터 없이 화면을 표시하고 있습니다."}</span><button onClick={() => void loadSnapshot()}>다시 불러오기</button></div>}
        {snapshot && (snapshot.sources.some((item) => item.state !== "connected") || snapshot.runs.some((item) => item.stale || item.incomplete)) && <div className="notice warning" role="status"><div><span>일부 출처가 연결되지 않았거나 관측이 오래되었거나 불완전합니다. 빈 결과를 완전한 기록으로 해석하지 마세요.</span><details className="source-coverage"><summary>출처별 연결·수집 범위</summary><dl>{snapshot.sources.map((source) => <div key={source.id}><dt><strong>{source.label}</strong> <SourceState state={source.state} /></dt><dd>{source.detail}<small>마지막 관측 {source.lastObservedAt ? timestamp(source.lastObservedAt) : "미확인"}</small></dd></div>)}</dl></details></div></div>}

        <div className="toolbar">
          <nav className="tabs" aria-label="실행 관측 화면">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setLocation({ tab: item.id })}>{item.label}</button>)}</nav>
          <div className="toolbar-state"><span>Run {visibleRuns.length}개 · Assistant {visibleAssistantCount}개</span><span className={`live-indicator ${streamState}`}>{streamState === "connected" ? "LIVE" : "PAUSED"}</span></div>
        </div>

        <form className="filters" aria-label="실행 필터" onSubmit={(event) => event.preventDefault()}>
          <label>프로젝트 / 저장소<select aria-label="프로젝트 / 저장소" value={filters.project} onChange={(event) => setLocation({ filters: { ...filters, project: event.target.value } }, true)}><option value="">모든 프로젝트와 저장소</option>{projectOptions.bindings.length > 0 && <optgroup label="Projects 프로젝트">{projectOptions.bindings.map((project) => <option key={project.key} value={project.key}>{project.label}</option>)}</optgroup>}{projectOptions.workspaces.length > 0 && <optgroup label="업무 미연결 저장소">{projectOptions.workspaces.map((workspace) => <option key={workspace.key} value={workspace.key}>{workspace.label}</option>)}</optgroup>}</select></label>
          <label>출처<select aria-label="출처" value={filters.source} onChange={(event) => setLocation({ filters: { ...filters, source: event.target.value } }, true)}><option value="">모든 출처</option>{snapshot?.sources.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
          <label>상태<select aria-label="상태" value={filters.status} onChange={(event) => setLocation({ filters: { ...filters, status: event.target.value } }, true)}><option value="">모든 상태</option>{Object.entries(statusNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="search-label">검색<input aria-label="검색" type="search" value={filters.q} placeholder="실행·업무·출처 검색" onChange={(event) => setLocation({ filters: { ...filters, q: event.target.value } }, true)} /></label>
        </form>

        {tab === "track" && snapshot && <ProjectsCatalog key={snapshot.user} sources={snapshot.sources} runs={accessibleRuns} onSelect={(key) => setLocation({ selected: key })} onMapTask={(sourceId, projectId, taskId) => setLocation({ tab: "map", taskMap: { sourceId, projectId, taskId } })} onAssigned={(key) => { void loadSnapshot().then(() => setLocation({ selected: key, tab: "map" })); }} onUnauthorized={clearPrivateData} />}
        {snapshot && !(tab === "map" && taskMap) && snapshot.sources.some(source => source.kind === "assistant" && source.state !== "unsupported") && <Suspense fallback={<p role="status">Assistant 원본 실행 화면을 불러오는 중…</p>}>
          <LazyAssistantWorkspace key={snapshot.user} mode={tab} sources={snapshot.sources} collection={assistant} selection={assistantSelection} onSelect={setAssistantSelection} filters={filters}
            onTaskMap={(sourceId, projectId, taskId) => setLocation({ tab: "map", taskMap: { sourceId, projectId, taskId } })} onUnauthorized={clearPrivateData} />
        </Suspense>}
        {tab === "map" && snapshot && taskMap && <section className="primary-content" aria-label="Projects 업무 의존 관계 Map"><button className="text-button" onClick={() => setLocation({ taskMap: null })}>실행 중심 Map으로 돌아가기</button><Suspense fallback={<p role="status">업무 의존 관계 지도를 불러오는 중…</p>}><LazyTaskDependencyMap key={`${snapshot.user}:${taskMap.sourceId}:${taskMap.projectId}`} sourceId={taskMap.sourceId} projectId={taskMap.projectId} {...(taskMap.taskId ? { focusTaskId: taskMap.taskId } : {})} sources={snapshot.sources} runs={accessibleRuns} assistantExecutions={assistant.executions} onSelectAssistant={(selection) => { setAssistantSelection(selection); setLocation({ tab: "trace", selected: "", taskMap: null, filters: { ...filters, source: selection.sourceId } }); }} onSelectRun={(key) => setLocation({ selected: key, taskMap: null })} onUnauthorized={clearPrivateData} onScopeUnavailable={clearTaskMapScope} /></Suspense></section>}
        {unavailable ? <section className="empty-state"><span className="empty-mark">!</span><h2>실행 데이터를 불러올 수 없습니다</h2><p>API 연결과 로그인 상태를 확인한 뒤 다시 시도해 주세요.</p><button className="button-primary" onClick={() => void loadSnapshot()}>다시 불러오기</button></section>
          : !snapshot ? <section className="loading-state" role="status">실제 실행 스냅샷을 불러오는 중…</section>
          : tab === "map" && taskMap ? null
          : assistantSourceSelected ? null
          : accessibleRuns.length === 0 ? <section className="empty-state"><span className="empty-mark">∅</span><h2>표시할 수 있는 Demian·로그 Run이 없습니다</h2><p>관측된 실행이 없거나 출처 접근을 확인하지 못해 실행 내용을 숨겼습니다. 지원 범위가 제한될 수 있습니다.</p><div className="empty-sources">{snapshot.sources.length ? snapshot.sources.map((item) => <div key={item.id}><strong>{item.label}</strong><SourceState state={item.state} /><small>{item.detail}</small></div>) : <span>연결된 출처가 없습니다.</span>}</div></section>
          : visibleRuns.length === 0 ? <section className="empty-state compact"><h2>{unavailableSource ? "선택한 출처의 실행을 표시할 수 없습니다" : "조건에 맞는 Run이 없습니다"}</h2><p>{unavailableSource?.detail ?? "프로젝트·출처·상태 필터나 검색어를 조정해 보세요."}</p><button className="text-button" onClick={() => setLocation({ filters: { project: "", source: "", status: "", q: "" } }, true)}>필터 초기화</button></section>
          : <div className={`content-grid ${tab === "map" || tab === "trace" ? "map-content-grid" : ""}`}><section className="primary-content" aria-label={tabs.find((item) => item.id === tab)?.title}>
              {tab === "track" && <><MissionOverview runs={visibleRuns} relations={accessibleRelations} selected={selectedKey} onSelect={(key) => setLocation({ selected: key })} onMap={(key) => setLocation({ tab: "map", selected: key })} onTaskMap={(sourceId, projectId, taskId) => setLocation({ tab: "map", taskMap: { sourceId, projectId, taskId } })} /><details className="flow-raw-evidence"><summary>전체 실행 목록 · {visibleRuns.length}개 Run</summary><TrackView runs={visibleRuns} selected={selectedKey} onSelect={(key) => setLocation({ selected: key })} /></details></>}
              {tab !== "track" && run && <><p className="graph-legend">정규 실행 근거 {events.length}건{loadingEvents ? " · 조회 중…" : ""}{hasMore ? " · 추가 근거 있음" : ""}</p>{eventsError && <p className="inline-error" role="alert">{eventsError}<button className="text-button" onClick={() => setEventsRefresh((value) => value + 1)}>실행 근거 다시 조회</button></p>}{hasMore && <button className="button-secondary" disabled={loadingEvents} onClick={loadMoreEvents}>흐름의 실행 근거 더 불러오기</button>}</>}
              {tab === "map" && <MapView runs={visibleRuns} relations={accessibleRelations} events={events} hasMore={hasMore} mode={mapMode} onMode={setMapMode} selected={run} onSelect={(key) => setLocation({ selected: key })} onUnauthorized={clearPrivateData} />}
              {tab === "trail" && <>{run && <><ActivityTrail key={`trail:${run.key}`} run={run} events={events} hasMore={hasMore} onUnauthorized={clearPrivateData} onTrace={() => setLocation({ tab: "trace" })} /><FileEvidencePanel key={`files:${run.key}`} run={run} onUnauthorized={clearPrivateData} /><ArtifactEvidencePanel key={run.key} run={run} onUnauthorized={clearPrivateData} /></>}<details className="flow-raw-evidence"><summary>정규 이벤트 근거 목록</summary><EventViewPanel title="Trail · 관측 이력" run={run} events={events} loading={loadingEvents} error={eventsError} hasMore={hasMore} onMore={loadMoreEvents} onRetry={() => setEventsRefresh((value) => value + 1)} renderMeta={renderMeta} /></details></>}
              {tab === "trace" && <>{run && <><MissionFlow key={`trace:${run.key}`} run={run} runs={accessibleRuns} relations={accessibleRelations} events={events} mode="execution" hasMore={hasMore} onSelectRun={(key) => setLocation({ selected: key })} onUnauthorized={clearPrivateData} /><details className="flow-raw-evidence"><summary>호출 구간 표와 단계별 근거</summary><RunTrace run={run} events={events} hasMore={hasMore} /></details></>}<details className="flow-raw-evidence"><summary>정규 이벤트 근거 목록</summary><EventViewPanel title="Trace · 실행 근거" run={run} events={events} loading={loadingEvents} error={eventsError} hasMore={hasMore} onMore={loadMoreEvents} onRetry={() => setEventsRefresh((value) => value + 1)} renderMeta={renderMeta} /></details></>}
            </section>
            {run && (tab === "map" || tab === "trace" ? <details className="flow-run-controls"><summary>선택한 Run의 실행 제어와 원본 상세</summary><RunInspector onUnauthorized={clearPrivateData} onSaved={loadSnapshot} sources={snapshot.sources} run={run} relations={related} events={events} source={snapshot.sources.find((item) => item.id === run.sourceId) ?? null} /></details> : <RunInspector onUnauthorized={clearPrivateData} onSaved={loadSnapshot} sources={snapshot.sources} run={run} relations={related} events={events} source={snapshot.sources.find((item) => item.id === run.sourceId) ?? null} />)}
          </div>}
        <footer className="page-footer">상태, 관계, 경로는 수집된 근거만 반영합니다. 실행 종료·에이전트 보고·검증·Projects 수용은 각각 별도 정보입니다.</footer>
      </main>
    </div>
  </div>;
}

function MissionFlow(props: ComponentProps<typeof LazyMissionFlow>) {
  return <Suspense fallback={<p role="status">업무·Agent 흐름 화면을 불러오는 중…</p>}><LazyMissionFlow {...props} /></Suspense>;
}

function TrackView({ runs, selected, onSelect }: { runs: RunView[]; selected: string; onSelect: (key: string) => void }) {
  return <div className="table-wrap"><table><caption className="sr-only">관측된 에이전트 실행 목록</caption><thead><tr><th scope="col">실행</th><th scope="col">프로젝트 · 업무</th><th scope="col">상태</th><th scope="col">출처</th><th scope="col">관측 시각</th></tr></thead><tbody>{runs.map((run) => <tr className={run.key === selected ? "selected-row" : ""} key={run.key}>
    <td><button className="run-select" onClick={() => onSelect(run.key)} aria-pressed={run.key === selected}><strong>{run.title || "제목 없는 실행"}</strong><small>{run.runId}</small><Freshness run={run} /></button></td>
    <td>{run.binding ? <><span>{run.binding.projectTitle}</span><small>{run.binding.taskTitle ?? "업무 연결 정보 없음"}</small></> : <span className="muted">{run.workspaceId ? `업무 미연결 · ${workspaceName(run.workspaceId)}` : "업무 미연결"}</span>}</td>
    <td><DisplayState run={run} /></td><td><span>{run.sourceLabel}</span><small>{run.device}</small></td><td>{timestamp(run.observedAt)}</td>
  </tr>)}</tbody></table></div>;
}
function Freshness({ run }: { run: RunView }) { return run.stale || run.incomplete ? <small className="freshness">{run.stale ? "오래된 관측" : "관측 불완전"}{run.stale && run.incomplete ? " · 관측 불완전" : ""}</small> : null; }

function MapView({ runs, relations, events, hasMore, mode, onMode, selected, onSelect, onUnauthorized }: { runs: RunView[]; relations: RelationView[]; events: EventView[]; hasMore: boolean; mode: "relations" | "paths"; onMode: (mode: "relations" | "paths") => void; selected: RunView | null; onSelect: (key: string) => void; onUnauthorized: (reason: string) => void }) {
  const selectedRelations = selected ? relations.filter((item) => item.runKey === selected.key) : relations;
  const paths = selected ? events.flatMap((event) => event.data.path ? [{ path: event.data.path, event }] : []) : [];
  return <div className="map-view">{selected ? <MissionFlow key={`map:${selected.key}`} run={selected} runs={runs} relations={relations} events={events} hasMore={hasMore} onSelectRun={onSelect} onUnauthorized={onUnauthorized} /> : <p className="empty-inline">실행을 선택하면 업무·소속·관측 관계를 지도로 확인할 수 있습니다.</p>}<details className="flow-run-picker"><summary>다른 실행 선택 · {runs.length}개 Run</summary>
    <ol className="execution-list">{runs.map((run) => <li key={run.key}><button className={`execution-row ${run.key === selected?.key ? "chosen" : ""}`} onClick={() => onSelect(run.key)} aria-pressed={run.key === selected?.key}><span className="execution-index">{run.key === selected?.key ? "●" : "○"}</span><span className="execution-copy"><strong>{run.title || run.runId}</strong><small>{run.sourceLabel} · {run.device} · {run.runId}</small></span><DisplayState run={run} /></button></li>)}</ol>
    </details><details className="flow-raw-evidence"><summary>관계·파일 경로의 원본 근거 목록</summary><section className="relation-section"><div className="map-switch" role="group" aria-label="Map 표시 방식"><button aria-pressed={mode === "relations"} onClick={() => onMode("relations")}>실행 관계</button><button aria-pressed={mode === "paths"} onClick={() => onMode("paths")}>코드 활동 · 관측 경로</button></div>
      {mode === "relations" ? <><div className="section-heading"><div><span className="overline">EVIDENCE LINKS</span><h2>관측된 관계</h2></div><span>관계 종류를 구분해 표시</span></div>
        {selectedRelations.length ? <div className="relation-list" aria-label="실행 관계 목록">{selectedRelations.map((relation) => <article className="relation-row" key={relation.key}><span className={`relation-tag ${relation.kind}`}>{relationNames[relation.kind]}</span><span className="relation-endpoints"><code>{relation.from}</code><span aria-hidden="true">→</span><code>{relation.to}</code></span><small>증거 seq {relation.evidenceSequence} · {timestamp(relation.observedAt)}</small></article>)}</div> : <p className="empty-inline">이 실행에 연결된 관계 관측이 없습니다. 누락된 관계 정보는 관계가 없다는 뜻이 아닙니다.</p>}</>
        : <><div className="section-heading"><div><span className="overline">PATHS FROM EVENT METADATA</span><h2>이벤트에 등장한 경로</h2></div><span>diff 또는 변경 여부를 뜻하지 않음</span></div>
          {paths.length ? <div className="relation-list" aria-label="실행 이벤트에서 관측된 파일 경로">{paths.map(({ path, event }) => <article className="path-row" key={`${event.key}:${path}`}><code>{path}</code><small>{event.type} · seq {event.sequence} · {event.data.tool ?? "도구 미확인"}</small></article>)}</div> : <p className="empty-inline">선택한 실행 이벤트에서 경로 메타데이터가 관측되지 않았습니다.</p>}</>}
    </section></details>
  </div>;
}

function EventViewPanel({ title, run, events, loading, error, hasMore, onMore, onRetry, renderMeta }: { title: string; run: RunView | null; events: EventView[]; loading: boolean; error: string; hasMore: boolean; onMore: () => void; onRetry: () => void; renderMeta: (event: EventView) => ReactNode }) {
  if (!run) return <section className="empty-inline select-prompt">실행을 선택하면 해당 실행의 관측 데이터가 표시됩니다.</section>;
  return <section className="events-panel"><div className="section-heading"><div><span className="overline">{title.startsWith("Trail") ? "CHRONOLOGICAL OBSERVATIONS" : "RUN EVIDENCE"}</span><h2>{title}</h2></div><small>{run.title || run.runId}</small></div>
    {run.incomplete && <p className="inline-warning">이 실행의 이벤트 기록이 불완전합니다.</p>}
    {loading && !events.length && <p className="loading-state">관측 데이터를 불러오는 중…</p>}
    {error && <div className="inline-error" role="alert">{error}<button onClick={onRetry}>다시 시도</button></div>}
    {!loading && !error && events.length === 0 && <p className="empty-inline">이 실행에서 확인된 이벤트가 없습니다. 이벤트가 없는 것과 기록을 읽을 수 없는 상태를 구분해 주세요.</p>}
    {!!events.length && <ol className="event-list">{events.map((event) => <li key={event.key}><div className="event-marker" aria-hidden="true" /><div className="event-content"><div className="event-title"><strong>{event.type}</strong><time>{timestamp(event.occurredAt)}</time></div><small>sequence {event.sequence}</small>{renderMeta(event)}</div></li>)}</ol>}
    {hasMore && <button className="button-secondary load-more" onClick={onMore} disabled={loading}>{loading ? "불러오는 중…" : "이벤트 더 불러오기"}</button>}
    <p className="privacy-note">이벤트 본문은 표시하지 않습니다. 허용된 메타데이터 필드만 표시합니다.</p>
  </section>;
}

function RunInspector({ run, relations, events, source, sources, onUnauthorized, onSaved }: { onUnauthorized: (reason: string) => void; onSaved: () => Promise<void>; sources: SourceView[]; run: RunView; relations: RelationView[]; events: EventView[]; source: SourceView | null }) {
  const reportEvents = events.filter((item) => /report|result|handoff/i.test(item.type));
  const verifyEvents = events.filter((item) => /verif|test|check/i.test(item.type));
  const sourceHref = originUrl(run.sourceUrl);
  return <aside className="inspector" aria-label="선택한 실행 상세"><div className="inspector-title"><span className="overline">RUN DETAILS</span><h2>{run.title || "제목 없는 실행"}</h2><DisplayState run={run} /><Freshness run={run} /></div>
    <dl className="detail-list"><dt>Run ID</dt><dd>{run.runId}</dd><dt>세션 ID</dt><dd>{run.sessionId}</dd><dt>출처</dt><dd>{run.sourceLabel}</dd><dt>장치</dt><dd>{run.device}</dd><dt>프로젝트 / 저장소</dt><dd>{run.binding ? `${run.binding.projectTitle} / ${run.binding.taskTitle ?? "업무 미지정"}` : run.workspaceId ? `업무 미연결 · ${workspaceName(run.workspaceId)}` : "Projects 업무 미연결"}</dd><dt>시작</dt><dd>{timestamp(run.startedAt)}</dd><dt>종료</dt><dd>{timestamp(run.completedAt)}</dd><dt>마지막 관측</dt><dd>{timestamp(run.observedAt)}</dd><dt>관계 증거</dt><dd>{relations.length}건</dd></dl>
    <RunBindingPanel key={run.key} run={run} sources={sources} onUnauthorized={onUnauthorized} onSaved={onSaved} />
    <section className="evidence-group"><h3>에이전트 보고</h3><p>{reportEvents.length ? `${reportEvents.length}개 관련 이벤트 관측` : "별도 보고 정보 없음"}</p><small>보고 본문은 표시하지 않습니다.</small></section>
    <section className="evidence-group"><h3>검증</h3><p>{verifyEvents.length ? `${verifyEvents.length}개 검증 관련 이벤트 관측` : "검증 근거 없음"}</p><small>실행 종료 상태와 검증 결과는 별도입니다.</small></section>
    <section className="evidence-group acceptance"><h3>Projects 수용</h3><p>알 수 없음</p><small>수용 데이터 연결 근거가 제공되지 않았습니다.</small></section>
    <section className="capabilities"><h3>기능 범위</h3><SourceState state={source?.state ?? run.sourceState} /><p>{source?.detail ?? "출처 설명을 사용할 수 없습니다."}</p>
      <RunControls key={run.key} run={run} onUnauthorized={onUnauthorized} />
      <RunApprovals key={`approvals:${run.key}`} run={run} onUnauthorized={onUnauthorized} />
    </section>
    {source?.capabilities.length ? <p className="source-capabilities">출처 기능: {source.capabilities.join(" · ")}</p> : <p className="source-capabilities">출처 기능 정보가 없습니다.</p>}
    {sourceHref ? <><a className="origin-button" href={sourceHref} target="_blank" rel="noreferrer">원본 세션 열기 ↗</a><small className="run-link-note">원본 세션으로 이동합니다. Run 전용 딥링크는 미지원입니다.</small></> : <p className="unsupported-link">이 출처는 원본 세션 딥링크를 제공하지 않습니다.</p>}
  </aside>;
}
