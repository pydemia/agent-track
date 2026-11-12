import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SourceView } from "../../../packages/contracts/index.ts";
import type { AssistantExecutionView, AssistantExecutionListView } from "../../../packages/contracts/assistant-view.ts";
import { AssistantWebError, fetchAssistantExecutions } from "./assistant-client.ts";

export interface AssistantWindow {
  sourceId: string;
  pages: AssistantExecutionListView[];
  status: "loading" | "ready" | "unavailable" | "failure";
  error: string;
}
export function assistantMatches(view: AssistantExecutionView, filters: { source: string; project: string; status: string; q: string }): boolean {
  return (!filters.source || view.sourceId === filters.source) && (!filters.project || view.currentTask?.projectKey === filters.project) &&
    (!filters.status || view.native.state === filters.status) && (!filters.q ||
      `${view.native.id} ${view.native.instructionId} ${view.currentTask?.task.title ?? ""} ${view.sourceLabel} ${view.native.roles.map(role => `${role.label} ${role.teamLabel} ${role.agentLabel}`).join(" ")}`.toLocaleLowerCase().includes(filters.q.toLocaleLowerCase()));
}
export function useAssistantExecutions(user: string | null, sources: SourceView[],
  onUnauthorized: (reason: string) => void, onObserved: () => void) {
  const eligible = sources.filter(source => source.kind === "assistant" && source.state !== "unsupported");
  const scope = JSON.stringify([user, eligible.map(source => [source.id, source.state]).sort(),
    sources.filter(source => source.kind === "projects").map(source => [source.id, source.state,
      [...(source.authorizedProjectIds ?? [])].sort()]).sort()]);
  const [state, setState] = useState<{ scope: string; windows: AssistantWindow[] }>({ scope: "", windows: [] });
  const [limits, setLimits] = useState<{ scope: string; pages: Record<string, number> }>({ scope: "", pages: {} });
  const [refreshVersion, setRefreshVersion] = useState(0);
  const unauthorized = useRef(onUnauthorized); unauthorized.current = onUnauthorized;
  const observed = useRef(onObserved); observed.current = onObserved;
  const limitsKey = JSON.stringify(limits.scope === scope ? limits.pages : {});
  const refresh = useCallback(() => setRefreshVersion(value => value + 1), []);
  const invalidateSource = useCallback((sourceId: string) => setState(previous => ({ scope,
    windows: (previous.scope === scope ? previous.windows : []).map(window => window.sourceId === sourceId
      ? { sourceId, pages: [], status: "unavailable", error: "현재 상세 조회 권한을 확인하지 못해 이 출처의 실행 정보를 지웠습니다." } : window),
  })), [scope]);
  const loadMore = useCallback((sourceId: string) => setLimits(previous => ({ scope,
    pages: { ...(previous.scope === scope ? previous.pages : {}),
      [sourceId]: Math.min(4, (previous.scope === scope ? previous.pages[sourceId] ?? 1 : 1) + 1) },
  })), [scope]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pageLimits: Record<string, number> = JSON.parse(limitsKey);
    const targets = eligible.map(source => ({ id: source.id, connected: source.state === "connected" }));
    const record = (window: AssistantWindow) => {
      if (controller.signal.aborted) return;
      setState(previous => ({ scope, windows: [...(previous.scope === scope ? previous.windows : [])
        .filter(item => item.sourceId !== window.sourceId), window].sort((a, b) => a.sourceId.localeCompare(b.sourceId)) }));
    };
    async function load() {
      if (!user || controller.signal.aborted) return;
      for (const target of targets) {
        if (controller.signal.aborted) return;
        setState(previous => ({ scope, windows: (previous.scope === scope ? previous.windows : [])
          .map(window => window.sourceId === target.id ? { ...window, status: "loading", error: "" } : window) }));
        try {
          const pages: AssistantExecutionListView[] = [];
          let cursor: string | null = null;
          const seen = new Set<string>();
          const ids = new Set<string>();
          for (let index = 0; index < (pageLimits[target.id] ?? 1); index++) {
            const page = await fetchAssistantExecutions(target.id, cursor, controller.signal);
            for (const execution of page.executions) {
              if (ids.has(execution.native.id)) throw new Error("Conflicting Assistant window");
              ids.add(execution.native.id);
            }
            pages.push(page);
            if (!page.hasMore) break;
            if (page.cursor === null || seen.has(page.cursor)) throw new Error("Repeated Assistant cursor");
            seen.add(page.cursor); cursor = page.cursor;
          }
          record({ sourceId: target.id, pages, status: "ready", error: "" });
          if (!controller.signal.aborted && !target.connected) observed.current();
        } catch (error) {
          if (controller.signal.aborted) return;
          record({ sourceId: target.id, pages: [], status: error instanceof AssistantWebError && error.kind === "unavailable" ? "unavailable" : "failure",
            error: "Assistant 원본의 현재 조회 범위와 연결을 확인하지 못해 이전 실행 정보도 지웠습니다." });
          if (error instanceof AssistantWebError && error.kind === "unauthorized") {
            unauthorized.current("로그인이 만료되어 Assistant 실행 정보를 지웠습니다."); return;
          }
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void load(), 15_000);
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [scope, limitsKey, refreshVersion]);

  const windows = state.scope === scope ? state.windows : [];
  const executions = useMemo(() => windows.flatMap(window => window.pages.flatMap(page => page.executions)).filter(view => {
    if (!sources.some(source => source.id === view.sourceId && source.kind === "assistant" && source.state === "connected")) return false;
    const task = view.currentTask;
    return !task || sources.some(source => source.id === task.projectsSourceId && source.kind === "projects" &&
      source.state === "connected" && source.authorizedProjectIds?.includes(task.project.id));
  }), [windows, sources]);
  return { windows, executions, refresh, loadMore, invalidateSource, maxPages: 4 };
}
